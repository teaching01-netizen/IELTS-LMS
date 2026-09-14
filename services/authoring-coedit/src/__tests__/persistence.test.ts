import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { signServiceRequest, verifyServiceRequest } from "../authToken.js";
import { seedYDocFromPrompt, encodeStateAsUpdate, currentStateHash } from "../documentCodec.js";
import { GoAuthoringClient } from "../goAuthoringClient.js";
import { CoeditPersistence, type CoeditAckPayload } from "../persistence.js";
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

function storeOk(stateHash: string, questionRevision = 5) {
  return {
    documentName: DOCUMENT_NAME,
    stateHash,
    questionRevision,
    materializedRevision: questionRevision,
    committed: true,
    duplicate: false,
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

describe("CoeditPersistence.store", () => {
  it("sends the previous committed hash and broadcasts a stateless acknowledgement", async () => {
    const go = harness((_path, body) => ({ json: storeOk(String(body["stateHash"]), 6) }));
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
    expect(commit.materializedRevision).toBe(6);
    expect(acks).toHaveLength(1);
    expect(acks[0]?.payload.type).toBe("coedit.ack");
    expect(acks[0]?.payload.stateHash).toBe(commit.stateHash);
    expect(acks[0]?.payload.questionRevision).toBe(6);
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
    });
    expect(persistence.lastCommit(DOCUMENT_NAME)).toBeNull();
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
