import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { signServiceRequest, verifyServiceRequest } from "../authToken.js";
import {
  RICH_ROOT_PREFIX,
  contentSignature,
  seedYDocFromPrompt,
  encodeStateAsUpdate,
  encodeStateVector,
  currentStateHash,
  promptSchema,
  toBase64,
} from "../documentCodec.js";
import { GoAuthoringClient } from "../goAuthoringClient.js";
import { CoeditPersistence, type CoeditAckPayload } from "../persistence.js";
import { documentFromStructuredContent } from "../richTextSchema.js";
import { metrics } from "../telemetry.js";
import { prosemirrorJSONToYXmlFragment } from "y-prosemirror";
import type { StructuredContent } from "../../../../src/features/exam-authoring/contracts/assessment.js";

const DOCUMENT_NAME = "coedit:v1:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SERVICE_SECRET = "s".repeat(40);

const PROMPT: StructuredContent = {
  version: 2,
  nodes: [],
  document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Seeded prompt" }] }] },
};

interface RecordedCall {
  path: string;
  body: Record<string, unknown>;
}

interface GoHarness {
  client: GoAuthoringClient;
  calls: RecordedCall[];
  callsTo(path: string): RecordedCall[];
}

/**
 * A fake Go private API.
 *
 * It verifies the service signature on every call, so a client that stops
 * signing — or signs the wrong path — fails the test rather than the
 * production deployment.
 */
function harness(
  respond: (path: string, body: Record<string, unknown>) => { status?: number; json: unknown },
): GoHarness {
  const calls: RecordedCall[] = [];
  const client = new GoAuthoringClient({
    baseUrl: "http://go.internal",
    serviceSecret: SERVICE_SECRET,
    now: () => 1_700_000_010_000,
    fetchImpl: (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      expect(() =>
        verifyServiceRequest({
          secret: SERVICE_SECRET,
          method: "POST",
          path: url.pathname,
          timestamp: headers.get("x-coedit-timestamp") ?? undefined,
          signature: headers.get("x-coedit-signature") ?? undefined,
          body: String(init?.body ?? ""),
          now: () => 1_700_000_010_000,
        }),
      ).not.toThrow();
      calls.push({ path: url.pathname, body });
      const outcome = respond(url.pathname, body);
      return new Response(JSON.stringify(outcome.json), {
        status: outcome.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });
  return {
    client,
    calls,
    callsTo: (path: string) => calls.filter((call) => call.path === path),
  };
}

const LOAD_PATH = "/internal/authoring-coedit/load";
const INITIALIZE_PATH = "/internal/authoring-coedit/initialize";
const STORE_PATH = "/internal/authoring-coedit/store";
const REBASE_PATH = "/internal/authoring-coedit/rebase";

function emptyLoad(overrides: Record<string, unknown> = {}) {
  return {
    documentName: DOCUMENT_NAME,
    lifecycleState: "initializing",
    ydocState: null,
    stateVector: null,
    stateHash: "",
    materializedRevision: 3,
    questionRevision: 3,
    schemaVersion: 1,
    fieldSet: "prompt",
    closedReason: null,
    seed: { prompt: PROMPT, questionRevision: 4, seedRevision: 4 },
    ...overrides,
  };
}

function storeOk(
  stateHash: string,
  questionRevision = 5,
  durability: { commitSequence?: string; stateEpoch?: string } = {},
) {
  return {
    documentName: DOCUMENT_NAME,
    stateHash,
    questionRevision,
    materializedRevision: questionRevision,
    committed: true,
    duplicate: false,
    ...durability,
  };
}

describe("CoeditPersistence.load", () => {
  it("seeds a first-time document and commits the seed without a revision bump", async () => {
    const go = harness((path) =>
      path === LOAD_PATH ? { json: emptyLoad() } : { json: storeOk("hash-after-seed", 4) },
    );
    const persistence = new CoeditPersistence(go.client);
    const document = new Y.Doc();

    await persistence.load({ documentName: DOCUMENT_NAME, document, context: { actorId: "actor-1" } });

    expect(go.callsTo(LOAD_PATH)).toHaveLength(1);
    const initialize = go.callsTo(INITIALIZE_PATH);
    expect(initialize).toHaveLength(1);
    expect(initialize[0]?.body["actorId"]).toBe("actor-1");
    expect(initialize[0]?.body["prompt"]).toMatchObject({ version: 2 });
    expect(String(initialize[0]?.body["ydocState"]).length).toBeGreaterThan(0);
    // The seeded document is readable, not empty: an empty fragment must never
    // be rendered as an editable prompt.
    expect(document.getXmlFragment("prompt").length).toBeGreaterThan(0);
    expect(persistence.lastCommit(DOCUMENT_NAME)?.materializedRevision).toBe(4);
  });

  it("returns committed binary state unchanged, without re-seeding", async () => {
    const seeded = seedYDocFromPrompt(PROMPT);
    const binary = encodeStateAsUpdate(seeded);
    const go = harness(() => ({
      json: emptyLoad({
        lifecycleState: "active",
        ydocState: Buffer.from(binary).toString("base64"),
        stateHash: "committed-hash",
        materializedRevision: 9,
        questionRevision: 9,
      }),
    }));
    const persistence = new CoeditPersistence(go.client);
    const document = new Y.Doc();

    await persistence.load({ documentName: DOCUMENT_NAME, document, context: {} });

    expect(go.callsTo(INITIALIZE_PATH)).toHaveLength(0);
    expect(go.callsTo(STORE_PATH)).toHaveLength(0);
    expect(persistence.lastCommit(DOCUMENT_NAME)?.stateHash).toBe("committed-hash");
    // The committed state vector is read from the document that just received
    // the binary, which is what a client compares its own vector against.
    expect(persistence.lastCommit(DOCUMENT_NAME)?.stateVector).toBe(
      toBase64(encodeStateVector(document)),
    );
    expect(document.getXmlFragment("prompt").length).toBeGreaterThan(0);
  });

  it("refuses a closed document", async () => {
    const go = harness(() => ({
      json: emptyLoad({ lifecycleState: "closed", closedReason: "question_deleted", seed: null }),
    }));
    const persistence = new CoeditPersistence(go.client);
    await expect(
      persistence.load({ documentName: DOCUMENT_NAME, document: new Y.Doc(), context: {} }),
    ).rejects.toThrow(/closed/);
  });

  it("refuses to render a prompt when the row has neither state nor seed", async () => {
    const go = harness(() => ({ json: emptyLoad({ lifecycleState: "active", seed: null }) }));
    const persistence = new CoeditPersistence(go.client);
    await expect(
      persistence.load({ documentName: DOCUMENT_NAME, document: new Y.Doc(), context: {} }),
    ).rejects.toThrow(/seed_unresolved/);
  });
});

const WORKSPACE_DOCUMENT_NAME = "coedit:v2:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/**
 * Sessions built the way the browser builds content — through the projection
 * boundary — so the room carries the generated content identities a real
 * editor produces. A room of raw Yjs paragraphs would round-trip differently,
 * and compaction is expected to refuse it rather than rewrite it.
 */
function projectedSession(text: string): Y.Doc {
  return seedYDocFromPrompt({
    version: 2,
    nodes: [],
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  });
}

/** One session that appends a paragraph to a v1 prompt room. */
function appendPromptSessions(document: Y.Doc, sessions: number): void {
  for (let index = 0; index < sessions; index += 1) {
    const session = projectedSession(`session ${index}`);
    Y.applyUpdate(document, encodeStateAsUpdate(session));
    session.destroy();
  }
}

/** One session that writes a distinct workspace scalar, so it earns a vector entry. */
function appendWorkspaceSessions(document: Y.Doc, sessions: number): void {
  for (let index = 0; index < sessions; index += 1) {
    const session = new Y.Doc();
    session.getMap("workspace").set(`session/${index}`, JSON.stringify(index));
    Y.applyUpdate(document, encodeStateAsUpdate(session));
    session.destroy();
  }
}

/** A v2 workspace room with one scalar, one rich root, and session residue. */
function workspaceRoom(sessions: number, rawScalar: unknown): Y.Doc {
  const document = new Y.Doc();
  const root = document.getMap("workspace");
  root.set("question/q1/scalar", JSON.stringify({ questionType: "mcq" }));
  root.set("question/q1/raw", rawScalar);
  prosemirrorJSONToYXmlFragment(
    promptSchema(),
    documentFromStructuredContent(PROMPT),
    document.getXmlFragment(`${RICH_ROOT_PREFIX}question/q1/prompt`),
  );
  appendWorkspaceSessions(document, sessions);
  return document;
}

function compactionCount(outcome: "accepted" | "skipped"): number {
  const match = metrics
    .render()
    .match(new RegExp(`authoring_coedit_compaction_total\\{outcome="${outcome}"\\} (\\d+)`));
  return match ? Number(match[1]) : 0;
}

function committedLoad(document: Y.Doc, documentName = DOCUMENT_NAME) {
  return emptyLoad({
    documentName,
    lifecycleState: "active",
    ydocState: Buffer.from(encodeStateAsUpdate(document)).toString("base64"),
    stateHash: "committed-hash",
    materializedRevision: 9,
    questionRevision: 9,
    stateEpoch: "0",
    commitSequence: "7",
    ...(documentName === DOCUMENT_NAME ? {} : { schemaVersion: 2, fieldSet: "workspace" }),
  });
}

function rebaseOk(body: Record<string, unknown>, stateEpoch = "1") {
  return {
    documentName: body["documentName"],
    stateHash: body["stateHash"],
    questionRevision: 9,
    materializedRevision: 9,
    stateEpoch,
    commitSequence: "8",
    committed: true,
    duplicate: false,
  };
}

/** Big enough that the state vector passes the 2 KiB compaction threshold. */
const RESIDUE_SESSIONS = 400;

describe("CoeditPersistence.load compaction", () => {
  it("rebuilds an accumulated history without changing its content", async () => {
    const prior = seedYDocFromPrompt(PROMPT);
    appendPromptSessions(prior, RESIDUE_SESSIONS);
    expect(encodeStateVector(prior).byteLength).toBeGreaterThan(2 << 10);
    const before = contentSignature(prior);
    const priorBytes = encodeStateAsUpdate(prior).byteLength;

    const go = harness((path, body) =>
      path === LOAD_PATH ? { json: committedLoad(prior) } : { json: rebaseOk(body) },
    );
    const persistence = new CoeditPersistence(go.client);
    const document = new Y.Doc();
    const accepted = compactionCount("accepted");

    await persistence.load({ documentName: DOCUMENT_NAME, document, context: {} });

    expect(compactionCount("accepted")).toBe(accepted + 1);
    // The content is the same by the service's own projection, which is the
    // boundary Go materializes and the browser reads back.
    expect(contentSignature(document)).toBe(before);
    expect(document.getXmlFragment("prompt").length).toBeGreaterThan(0);
    // The vector is the point: it collapses to this rebuild's single author.
    expect(encodeStateVector(document).byteLength).toBeLessThan(16);
    expect(encodeStateAsUpdate(document).byteLength).toBeLessThan(priorBytes);
    // Compaction uses the dedicated durable rebase boundary, not an ordinary
    // store or an in-memory-only replacement.
    expect(go.callsTo(INITIALIZE_PATH)).toHaveLength(0);
    expect(go.callsTo(STORE_PATH)).toHaveLength(0);
    expect(go.callsTo(REBASE_PATH)).toHaveLength(1);
    expect(persistence.lastCommit(DOCUMENT_NAME)?.stateEpoch).toBe("1");
  });

  it("rebuilds a workspace room from its own workspace projection", async () => {
    const prior = workspaceRoom(RESIDUE_SESSIONS, JSON.stringify({ ok: true }));
    expect(encodeStateVector(prior).byteLength).toBeGreaterThan(2 << 10);
    const before = contentSignature(prior);

    const go = harness((path, body) =>
      path === LOAD_PATH
        ? { json: committedLoad(prior, WORKSPACE_DOCUMENT_NAME) }
        : { json: rebaseOk(body) },
    );
    const persistence = new CoeditPersistence(go.client);
    const document = new Y.Doc();

    await persistence.load({ documentName: WORKSPACE_DOCUMENT_NAME, document, context: {} });

    expect(contentSignature(document)).toBe(before);
    expect(encodeStateVector(document).byteLength).toBeLessThan(16);
    // Both halves of a workspace room survive: the scalar map, the rich root.
    expect(document.getMap("workspace").get("question/q1/scalar")).toBe(
      JSON.stringify({ questionType: "mcq" }),
    );
    expect(document.getXmlFragment(`${RICH_ROOT_PREFIX}question/q1/prompt`).length).toBeGreaterThan(0);
    expect(go.callsTo(REBASE_PATH)).toHaveLength(1);
  });

  it("keeps the committed binary when the projection cannot rebuild it exactly", async () => {
    // A scalar the projection deliberately drops (it is not JSON): the browser
    // can still see it, so compaction must refuse rather than rewrite the room
    // without it.
    const prior = workspaceRoom(RESIDUE_SESSIONS, "not json");
    const vectorBytes = encodeStateVector(prior).byteLength;
    const priorBytes = encodeStateAsUpdate(prior).byteLength;
    const go = harness((path) => ({
      json: committedLoad(prior, WORKSPACE_DOCUMENT_NAME),
    }));
    const persistence = new CoeditPersistence(go.client);
    const document = new Y.Doc();
    const skipped = compactionCount("skipped");

    await persistence.load({ documentName: WORKSPACE_DOCUMENT_NAME, document, context: {} });

    expect(compactionCount("skipped")).toBe(skipped + 1);
    expect(document.getMap("workspace").get("question/q1/raw")).toBe("not json");
    expect(encodeStateVector(document).byteLength).toBe(vectorBytes);
    expect(encodeStateAsUpdate(document).byteLength).toBe(priorBytes);
  });

  it("keeps the original binary when durable rebase fails", async () => {
    const prior = seedYDocFromPrompt(PROMPT);
    appendPromptSessions(prior, RESIDUE_SESSIONS);
    const priorVector = encodeStateVector(prior);
    const go = harness((path) =>
      path === LOAD_PATH
        ? { json: committedLoad(prior) }
        : { status: 503, json: { error: { code: "service_unavailable" } } },
    );
    const persistence = new CoeditPersistence(go.client);
    const document = new Y.Doc();

    await persistence.load({ documentName: DOCUMENT_NAME, document, context: {} });

    expect(go.callsTo(REBASE_PATH)).toHaveLength(1);
    expect(encodeStateVector(document)).toEqual(priorVector);
    expect(persistence.lastCommit(DOCUMENT_NAME)?.stateHash).toBe("committed-hash");
  });

  it("leaves a room below the threshold untouched", async () => {
    const prior = seedYDocFromPrompt(PROMPT);
    appendPromptSessions(prior, 3);
    const go = harness(() => ({ json: committedLoad(prior) }));
    const persistence = new CoeditPersistence(go.client);
    const document = new Y.Doc();
    const accepted = compactionCount("accepted");
    const skipped = compactionCount("skipped");

    await persistence.load({ documentName: DOCUMENT_NAME, document, context: {} });

    expect(compactionCount("accepted")).toBe(accepted);
    expect(compactionCount("skipped")).toBe(skipped);
    expect(encodeStateVector(document).byteLength).toBe(encodeStateVector(prior).byteLength);
  });
});

describe("CoeditPersistence.store", () => {
  it("sends the previous committed hash and broadcasts a stateless acknowledgement", async () => {
    // The commit sequence is the ordering fact the browser uses when a
    // materialized revision cannot: two UI-only commits share a revision, so an
    // acknowledgement without the sequence would leave the newer one
    // indistinguishable from the older.
    const go = harness((_path, body) => ({
      json: storeOk(String(body["stateHash"]), 6, { commitSequence: "7", stateEpoch: "3" }),
    }));
    const persistence = new CoeditPersistence(go.client);
    const document = seedYDocFromPrompt(PROMPT);
    const acks: Array<{ name: string; payload: CoeditAckPayload }> = [];
    persistence.setBroadcaster((name, payload) =>
      acks.push({ name, payload: JSON.parse(payload) as CoeditAckPayload }),
    );

    const commit = await persistence.store({
      documentName: DOCUMENT_NAME,
      document,
      context: { actorId: "actor-2" },
    });

    const call = go.callsTo(STORE_PATH)[0];
    expect(call?.body["actorId"]).toBe("actor-2");
    expect(String(call?.body["stateHash"])).toBe(currentStateHash(document));
    expect(commit.stateHash).toBe(currentStateHash(document));
    expect(commit.stateVector).toBe(toBase64(encodeStateVector(document)));
    expect(commit.materializedRevision).toBe(6);
    expect(acks).toHaveLength(1);
    expect(acks[0]?.payload.type).toBe("coedit.ack");
    expect(acks[0]?.payload.stateHash).toBe(commit.stateHash);
    // The acknowledgement carries the state itself, not only its provenance
    // hash: that is the identity the browser compares against.
    expect(acks[0]?.payload.stateVector).toBe(commit.stateVector);
    expect(acks[0]?.payload.questionRevision).toBe(6);
    expect(acks[0]?.payload.materializedRevision).toBe(6);
    expect(acks[0]?.payload.commitSequence).toBe("7");
    expect(acks[0]?.payload.stateEpoch).toBe("3");
  });

  it("never converts a failed store into a saved acknowledgement", async () => {
    const go = harness(() => ({ status: 503, json: { error: { code: "service_unavailable" } } }));
    const persistence = new CoeditPersistence(go.client);
    const acks: string[] = [];
    persistence.setBroadcaster((_name, payload) => acks.push(payload));

    await expect(
      persistence.store({ documentName: DOCUMENT_NAME, document: seedYDocFromPrompt(PROMPT), context: {} }),
    ).rejects.toThrow();
    expect(acks).toHaveLength(1);
    expect(JSON.parse(acks[0] as string)).toEqual({
      type: "coedit.save_failed",
      documentName: DOCUMENT_NAME,
      retryable: true,
      reason: null,
      requiresResync: false,
    });
    expect(persistence.lastCommit(DOCUMENT_NAME)).toBeNull();
  });

  it("does not acknowledge a store when the durable hash is not the current document", async () => {
    const go = harness((_path, body) => ({ json: storeOk("not-the-current-state") }));
    const persistence = new CoeditPersistence(go.client);
    const frames: string[] = [];
    persistence.setBroadcaster((_name, payload) => frames.push(payload));

    await expect(
      persistence.store({ documentName: DOCUMENT_NAME, document: seedYDocFromPrompt(PROMPT), context: {} }),
    ).rejects.toThrow("coedit_commit_state_mismatch");

    expect(persistence.lastCommit(DOCUMENT_NAME)).toBeNull();
    expect(JSON.parse(frames[0] as string)).toMatchObject({
      type: "coedit.save_failed",
      retryable: true,
      reason: null,
      requiresResync: false,
    });
  });

  it("marks a moved-commit refusal as non-retryable and resync-required", async () => {
    // A service restart empties the in-memory commit map, so the next store
    // sends an empty previousStateHash; the row's committed hash moved on and
    // the fence refuses. Retrying verbatim can never satisfy it.
    const go = harness(() => ({
      status: 409,
      json: { error: { code: "ASSESSMENT_CONFLICT", details: { coeditReason: "coedit_previous_hash_mismatch" } } },
    }));
    const persistence = new CoeditPersistence(go.client);
    const acks: string[] = [];
    persistence.setBroadcaster((_name, payload) => acks.push(payload));

    await expect(
      persistence.store({ documentName: DOCUMENT_NAME, document: seedYDocFromPrompt(PROMPT), context: {} }),
    ).rejects.toThrow();
    expect(JSON.parse(acks[0] as string)).toEqual({
      type: "coedit.save_failed",
      documentName: DOCUMENT_NAME,
      retryable: false,
      reason: "coedit_previous_hash_mismatch",
      requiresResync: true,
    });
  });

  it("retries the same document after a failure instead of caching the error", async () => {
    let failNext = true;
    const go = harness((_path, body) => {
      if (failNext) {
        failNext = false;
        return { status: 500, json: { error: { code: "internal" } } };
      }
      return { json: storeOk(String(body["stateHash"])) };
    });
    const persistence = new CoeditPersistence(go.client);
    const document = seedYDocFromPrompt(PROMPT);
    await expect(
      persistence.store({ documentName: DOCUMENT_NAME, document, context: {} }),
    ).rejects.toThrow();
    await expect(
      persistence.store({ documentName: DOCUMENT_NAME, document, context: {} }),
    ).resolves.toBeTruthy();
    expect(go.callsTo(STORE_PATH)).toHaveLength(2);
  });

  it("coalesces concurrent stores for one document", async () => {
    let resolveFetch: (() => void) | null = null;
    const go = harness((_path, body) => {
      resolveFetch?.();
      return { json: storeOk(String(body["stateHash"])) };
    });
    const persistence = new CoeditPersistence(go.client);
    const document = seedYDocFromPrompt(PROMPT);
    const gate = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const first = persistence.store({ documentName: DOCUMENT_NAME, document, context: {} });
    const second = persistence.store({ documentName: DOCUMENT_NAME, document, context: {} });
    await gate;
    await Promise.all([first, second]);
    expect(go.callsTo(STORE_PATH)).toHaveLength(1);
  });

  it("rejects an oversized materialized prompt before calling Go", async () => {
    const go = harness((_path, body) => ({ json: storeOk(String(body["stateHash"])) }));
    const persistence = new CoeditPersistence(go.client);
    const document = seedYDocFromPrompt({
      version: 2,
      nodes: [],
      document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "y".repeat(1_100_000) }] }] },
    });

    await expect(
      persistence.store({ documentName: DOCUMENT_NAME, document, context: {} }),
    ).rejects.toThrow(/size limit/);
    expect(go.callsTo(STORE_PATH)).toHaveLength(0);
  });

  it("announces a size refusal instead of leaving the author with an unsaved draft", async () => {
    // The refusal is raised here, before Go is called, so nothing else can tell
    // the browser: without this frame the local content is simply never durable.
    const go = harness((_path, body) => ({ json: storeOk(String(body["stateHash"])) }));
    const persistence = new CoeditPersistence(go.client);
    const frames: string[] = [];
    persistence.setBroadcaster((_name, payload) => frames.push(payload));
    const document = seedYDocFromPrompt({
      version: 2,
      nodes: [],
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "y".repeat(1_100_000) }] }],
      },
    });

    await expect(
      persistence.store({ documentName: DOCUMENT_NAME, document, context: {} }),
    ).rejects.toThrow(/size limit/);

    expect(JSON.parse(frames[0] as string)).toEqual({
      type: "coedit.save_failed",
      documentName: DOCUMENT_NAME,
      retryable: false,
      reason: "coedit_oversized",
      requiresResync: false,
    });
  });

  it("forgets a closed room's commit record", async () => {
    const go = harness((_path, body) => ({ json: storeOk(String(body["stateHash"])) }));
    const persistence = new CoeditPersistence(go.client);
    const document = seedYDocFromPrompt(PROMPT);
    await persistence.store({ documentName: DOCUMENT_NAME, document, context: {} });
    expect(persistence.lastCommit(DOCUMENT_NAME)).not.toBeNull();
    persistence.forget(DOCUMENT_NAME);
    expect(persistence.lastCommit(DOCUMENT_NAME)).toBeNull();
  });
});
