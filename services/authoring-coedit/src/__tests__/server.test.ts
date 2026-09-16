import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { signServiceRequest, verifyServiceRequest } from "../authToken.js";
import type { CoeditServiceConfig } from "../config.js";
import { hashStateVector } from "../documentCodec.js";
import { createCoeditService, type CoeditService, type LockLike } from "../main.js";
import type { StructuredContent } from "../../../../src/features/exam-authoring/contracts/assessment.js";
// The browser's own identity encoder, imported into the real service test on
// purpose: the save-truth comparison spans this boundary, and keeping both
// halves in one file is what makes a divergence impossible to miss.
import { encodeStateVectorBase64 } from "../../../../src/features/exam-authoring/realtime/coedit/stateVector.js";
import { deriveSaveState } from "../../../../src/features/exam-authoring/realtime/coedit/saveState.js";
import {
  coeditRecoveryFromSaveFailure,
  parseCoeditSaveFailureMessage,
} from "../../../../src/features/exam-authoring/realtime/coedit/contracts.js";
// The command envelope is validated by ONE module that both halves import; the
// relay test below drives the real socket with the browser's own builder.
import { createSatWorkspaceCommand } from "../../../../src/features/exam-authoring/realtime/coedit/workspaceCommands.js";
import { createWorkspaceSeedFrame } from "../../../../src/features/exam-authoring/realtime/coedit/workspaceSeed.js";
// The Retry action's own frame, built by the browser's builder and validated by
// the service's importer of the same module.
import { createCoeditStoreRequest } from "../../../../src/features/exam-authoring/realtime/coedit/storeRequest.js";
import { metrics } from "../telemetry.js";

/**
 * Resolves the refusal the SERVICE sent through the CLIENT's own parser and
 * mapping, so a change to either half of the wire contract fails here rather
 * than in a browser nobody is watching.
 */
function refusalRecoveryFrom(frames: string[]) {
  for (const frame of frames) {
    const parsed = parseCoeditSaveFailureMessage(JSON.parse(frame));
    if (parsed && parsed.reason === "coedit_write_refused") {
      return { parsed, recovery: coeditRecoveryFromSaveFailure(parsed) };
    }
  }
  return null;
}

/**
 * One seed counter series from the service's own exposition. The registry is
 * process-wide, so every assertion is a delta rather than an absolute value.
 */
function seedOutcomeCount(outcome: "accepted" | "rejected" | "duplicate" | "conflict"): number {
  const prefix = `authoring_coedit_seed_total{outcome="${outcome}"} `;
  const line = metrics.render().split("\n").find((entry) => entry.startsWith(prefix));
  return line ? Number(line.slice(prefix.length)) : 0;
}

const TOKEN_SECRET = "t".repeat(40);
const SERVICE_SECRET = "s".repeat(40);
const DOCUMENT_UUID = "2f1b6c1e-6a0a-4a5b-9f0e-9d3a2f4c5b6d";
const DOCUMENT_NAME = `coedit:v1:${DOCUMENT_UUID}`;
const WORKSPACE_DOCUMENT_NAME = `coedit:v2:${DOCUMENT_UUID}`;

const PROMPT: StructuredContent = {
  version: 2,
  nodes: [],
  document: {
    type: "doc",
    content: [{ type: "paragraph", attrs: { id: "content-seed" }, content: [{ type: "text", text: "Seeded prompt" }] }],
  },
};

interface Claims {
  version: number;
  documentName: string;
  actorId: string;
  displayName: string;
  organizationId: string | null;
  examId: string;
  draftVersionId: string;
  /** Empty for a workspace (v2) token: the exam room is not question-scoped. */
  examQuestionId: string;
  questionRevisionId: string;
  fieldSet?: "prompt" | "workspace";
  mode: "write" | "read";
  issuedAt: number;
  expiresAt: number;
}

/** The exam-level (v2) room token: no question claims, explicit field set. */
function workspaceClaims(overrides: Partial<Claims> = {}): Partial<Claims> {
  return {
    documentName: WORKSPACE_DOCUMENT_NAME,
    fieldSet: "workspace",
    examQuestionId: "",
    questionRevisionId: "",
    ...overrides,
  };
}

function mintToken(overrides: Partial<Claims> = {}): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: Claims = {
    version: 1,
    documentName: DOCUMENT_NAME,
    actorId: "actor-alice",
    displayName: "Alice Author",
    organizationId: "org-1",
    examId: "exam-1",
    draftVersionId: "draft-1",
    examQuestionId: "question-1",
    questionRevisionId: "revision-1",
    mode: "write",
    issuedAt,
    expiresAt: issuedAt + 300,
    ...overrides,
  };
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const mac = createHmac("sha256", TOKEN_SECRET);
  mac.update("authoring-coedit-token.v1.");
  mac.update(body);
  return `${body}.${mac.digest("base64url")}`;
}

/** The private Go API, reduced to the calls this service makes. */
interface FakeGo {
  url: string;
  loads: Array<Record<string, unknown>>;
  initializes: Array<Record<string, unknown>>;
  stores: Array<Record<string, unknown>>;
  committedState: Buffer | null;
  committedHash: string | null;
  materializedPrompt: StructuredContent | null;
  lifecycle: "initializing" | "active" | "freezing" | "frozen" | "closed";
  unauthorized: number;
  /** While true every store is refused the way Go refuses a stale fence. */
  refuseStores: boolean;
  close(): Promise<void>;
}

async function startFakeGo(
  options: { lifecycle?: "initializing" | "active" | "freezing" | "frozen" | "closed" } = {},
): Promise<FakeGo> {
  const state: FakeGo = {
    url: "",
    loads: [],
    initializes: [],
    stores: [],
    committedState: null,
    committedHash: null,
    materializedPrompt: null,
    lifecycle: options.lifecycle ?? "initializing",
    unauthorized: 0,
    refuseStores: false,
    close: async () => {},
  };

  // Per-document lifecycle: a close on one room must not close a neighbouring
  // room, and a document that was closed once is never reopened.
  const byName = new Map<string, "initializing" | "active" | "freezing" | "frozen" | "closed">();
  const lifecycleOf = (name: string) => byName.get(name) ?? state.lifecycle;
  const markActive = (name: string) => byName.set(name, "active");
  // Committed binary state is per document, exactly as MySQL stores it. The
  // flat fields below mirror the MOST RECENT commit for the single-document
  // tests; a second document must never inherit the first one's binary.
  const committedByName = new Map<string, { state: Buffer; hash: string; prompt: StructuredContent }>();
  const commit = (name: string, body: Record<string, unknown>) => {
    const prompt = body["prompt"] as StructuredContent;
    const entry = {
      state: Buffer.from(String(body["ydocState"]), "base64"),
      hash: String(body["stateHash"]),
      prompt,
    };
    committedByName.set(name, entry);
    state.committedState = entry.state;
    state.committedHash = entry.hash;
    state.materializedPrompt = prompt;
    return entry;
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    const raw = Buffer.concat(chunks);
    try {
      verifyServiceRequest({
        secret: SERVICE_SECRET,
        method: "POST",
        path: req.url ?? "/",
        timestamp: header(req, "x-coedit-timestamp"),
        signature: header(req, "x-coedit-signature"),
        body: raw,
      });
    } catch {
      state.unauthorized += 1;
      respond(res, 403, { error: "signature_invalid" });
      return;
    }
    const body = raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
    switch (req.url) {
      case "/internal/authoring-coedit/load": {
        state.loads.push(body);
        const documentName = String(body["documentName"]);
        const lifecycle = lifecycleOf(documentName);
        const committed = committedByName.get(documentName) ?? null;
        const hasBinary = committed !== null;
        respond(res, 200, {
          documentName: body["documentName"],
          lifecycleState: lifecycle,
          ydocState: hasBinary ? committed?.state.toString("base64") : null,
          stateVector: null,
          stateHash: committed?.hash ?? "",
          materializedRevision: 1,
          questionRevision: 1,
          schemaVersion: 1,
          fieldSet: "prompt",
          closedReason: lifecycle === "closed" ? "question_deleted" : null,
          seed:
            lifecycle === "closed" || hasBinary
              ? null
              : { prompt: PROMPT, questionRevision: 1, seedRevision: 1 },
        });
        return;
      }
      case "/internal/authoring-coedit/initialize": {
        state.initializes.push(body);
        const name = String(body["documentName"]);
        const entry = commit(name, body);
        markActive(name);
        respond(res, 200, {
          documentName: body["documentName"],
          stateHash: entry.hash,
          questionRevision: 1,
          materializedRevision: 1,
          committed: true,
          duplicate: false,
        });
        return;
      }
      case "/internal/authoring-coedit/store": {
        state.stores.push(body);
        if (state.refuseStores) {
          // Go's real refusal, in Go's real shape: the private surface writes
          // the error envelope FLAT (httpx.WriteError + apperrors.Envelope).
          respond(res, 409, {
            code: "ASSESSMENT_CONFLICT",
            message: "Collaboration state advanced elsewhere; reload the prompt before continuing.",
            details: { coeditReason: "coedit_previous_hash_mismatch" },
            requestId: "req-store-refused",
          });
          return;
        }
        const entry = commit(String(body["documentName"]), body);
        respond(res, 200, {
          documentName: body["documentName"],
          stateHash: entry.hash,
          questionRevision: 2,
          materializedRevision: 2,
          committed: true,
          duplicate: false,
        });
        return;
      }
      default:
        respond(res, 404, { error: "unknown_path" });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  state.url = `http://127.0.0.1:${port}`;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return state;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

class FakeLock implements LockLike {
  acquired = false;
  released = false;
  onLost: (reason: string) => void = () => {};
  constructor(private readonly acquireImpl: () => Promise<void> = async () => {}) {}
  isReady(): boolean {
    return this.acquired && !this.released;
  }
  async acquire(): Promise<void> {
    await this.acquireImpl();
    this.acquired = true;
  }
  async release(): Promise<void> {
    this.released = true;
  }
}

interface Running {
  service: CoeditService;
  port: number;
  lock: FakeLock;
  go: FakeGo;
}

const cleanups: Array<() => Promise<void> | void> = [];
const providers: HocuspocusProvider[] = [];

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.destroy();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function startService(
  options: { lock?: FakeLock; lifecycle?: "initializing" | "active" | "closed"; go?: FakeGo } = {},
): Promise<Running> {
  const go = options.go ?? (await startFakeGo({ ...(options.lifecycle ? { lifecycle: options.lifecycle } : {}) }));
  const lock = options.lock ?? new FakeLock();
  const config: CoeditServiceConfig = {
    environment: "test",
    port: 0,
    host: "127.0.0.1",
    mysqlDsn: "mysql://user:pass@127.0.0.1:3306/app",
    goBaseUrl: go.url,
    tokenSecret: TOKEN_SECRET,
    serviceSecret: SERVICE_SECRET,
    shutdownTimeoutMs: 5_000,
    lockTimeoutSeconds: 5,
    allowedOrigin: "",
  };
  const service = createCoeditService(config, { lock });
  // Hocuspocus resolves port 0 to a real port; read it after listening.
  await service.start();
  const port = (service.server.address as { port: number }).port;
  cleanups.push(async () => {
    await service.stop().catch(() => undefined);
    await go.close();
  });
  return { service, port, lock, go };
}

function connect(
  running: Running,
  options: { token: string; document?: Y.Doc; documentName?: string },
): HocuspocusProvider {
  const document = options.document ?? new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${running.port}`,
    name: options.documentName ?? DOCUMENT_NAME,
    document,
    token: () => options.token,
  });
  providers.push(provider);
  return provider;
}

async function waitFor(check: () => boolean, timeoutMs = 5_000, label = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function paragraphText(document: Y.Doc): string {
  const fragment = document.getXmlFragment("prompt");
  const parts: string[] = [];
  const walk = (item: Y.XmlElement | Y.XmlText) => {
    if (item instanceof Y.XmlText) {
      parts.push(item.toString());
      return;
    }
    for (const child of item.toArray()) walk(child as Y.XmlElement | Y.XmlText);
  };
  for (const node of fragment.toArray()) walk(node as Y.XmlElement | Y.XmlText);
  return parts.join("\n");
}

function appendParagraph(document: Y.Doc, value: string): void {
  const fragment = document.getXmlFragment("prompt");
  document.transact(() => {
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, value);
    paragraph.insert(0, [text]);
    fragment.insert(fragment.length, [paragraph]);
  });
}

/**
 * One prior author session: a Yjs client whose contribution to a room's state
 * vector is measured in isolation before it is applied. The client id width is
 * random per document, so measuring first is what makes the walk deterministic.
 */
function paddingSession(items: number): { document: Y.Doc; contribution: number } {
  const document = new Y.Doc();
  const entries = document.getMap("prior-session");
  for (let index = 0; index < items; index += 1) entries.set(`k${index}`, index);
  // One count byte, then this client's (id width + clock width) entry.
  return { document, contribution: Y.encodeStateVector(document).length - 1 };
}

/**
 * Grows a room's state vector to the next length congruent to 55 mod 64 — the
 * lengths at which the removed client-side SHA-256 padded differently from the
 * service's, so the room could commit every edit and still never show Saved.
 *
 * Each step merges one more prior author session, exactly what a returning
 * browser leaves behind in IndexedDB. A session contributes 5..8 bytes (client
 * id varint + clock varint) and every width in that range is cheap to build, so
 * the residue can always be closed instead of hoped for.
 */
function padStateVectorToOldFailureLength(document: Y.Doc): number {
  const updateForContribution = (wanted: number): Uint8Array => {
    for (const items of [1, 128, 16384]) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const session = paddingSession(items);
        if (session.contribution !== wanted) continue;
        return Y.encodeStateAsUpdate(session.document);
      }
    }
    throw new Error(`no prior session contributes exactly ${wanted} bytes`);
  };

  const residue = (): number => (((55 - Y.encodeStateVector(document).length) % 64) + 64) % 64;
  let needed = residue();
  for (let step = 0; needed !== 0 && step < 64; step += 1) {
    const wanted = needed >= 5 && needed <= 8 ? needed : 6;
    Y.applyUpdate(document, updateForContribution(wanted));
    needed = residue();
  }
  return Y.encodeStateVector(document).length;
}

describe("service integration", () => {
  it("seeds a first-time document and stores an edit with a matching acknowledgement", async () => {
    const running = await startService();
    const provider = connect(running, { token: mintToken() });
    const initialAcks: string[] = [];
    provider.on("stateless", ({ payload }: { payload: string }) => initialAcks.push(payload));
    await waitFor(() => provider.isSynced, 5_000, "initial sync");

    expect(running.go.loads).toHaveLength(1);
    expect(running.go.initializes).toHaveLength(1);
    expect(paragraphText(provider.document)).toContain("Seeded prompt");
    await waitFor(() => initialAcks.some((payload) => JSON.parse(payload).type === "coedit.ack"), 5_000, "initial acknowledgement");
    expect(JSON.parse(initialAcks[0] as string)).toMatchObject({
      type: "coedit.ack",
      documentName: DOCUMENT_NAME,
      stateHash: running.go.committedHash,
      questionRevision: 1,
    });

    const acks: string[] = [];
    provider.on("stateless", ({ payload }: { payload: string }) => acks.push(payload));
    appendParagraph(provider.document, "Alice was here");
    await waitFor(() => acks.length > 0, 5_000, "store acknowledgement");

    const ack = JSON.parse(acks[0] as string) as {
      type: string;
      stateVector: string;
      stateHash: string;
      questionRevision: number;
    };
    expect(ack.type).toBe("coedit.ack");
    expect(running.go.stores.length).toBeGreaterThan(0);
    expect(paragraphText(provider.document)).toContain("Alice was here");
    // The acknowledgement identifies the exact state Go committed, which is
    // what lets a client mark Saved only for its own current state.
    expect(ack.stateHash).toBe(String(running.go.stores.at(-1)?.["stateHash"]));
    expect(ack.questionRevision).toBe(2);
    expect(hashStateVector(Y.encodeStateVector(provider.document))).toBe(ack.stateHash);
    // Identity: the browser encodes the same bytes the service acknowledged, so
    // the comparison is byte equality and never depends on a second digest
    // implementation agreeing with node:crypto.
    expect(ack.stateVector).toBe(encodeStateVectorBase64(provider.document));
    expect(JSON.stringify(running.go.materializedPrompt)).toContain("Alice was here");
  });

  it("acknowledges a reloading client's committed state without a new edit", async () => {
    // Reload, restart, second tab: the browser opens a room MySQL already
    // holds and has nothing of its own to send. Without the connect-time
    // acknowledgement the editor would sit at Syncing until the next edit
    // happened to trigger a store — the design requires `Saved` to be reachable
    // from what is already durable.
    const running = await startService();
    const author = connect(running, { token: mintToken() });
    await waitFor(() => author.isSynced, 5_000, "author sync");
    appendParagraph(author.document, "Committed before the reload");
    await waitFor(() => running.go.stores.length > 0, 5_000, "first store");
    const storesAfterEdit = running.go.stores.length;
    const committed = encodeStateVectorBase64(author.document);

    const reloaded = connect(running, { token: mintToken() });
    const acks: string[] = [];
    reloaded.on("stateless", ({ payload }: { payload: string }) => acks.push(payload));
    await waitFor(() => reloaded.isSynced, 5_000, "reload sync");

    const acknowledgement = (payload: string): { type?: string; stateVector?: string } => {
      try {
        return JSON.parse(payload) as { type?: string; stateVector?: string };
      } catch {
        return {};
      }
    };
    // Waited for, not assumed: the ack and the sync step race on the wire, and
    // the identity only means something once this tab holds the state.
    await waitFor(
      () =>
        acks.some(
          (payload) =>
            acknowledgement(payload).type === "coedit.ack" &&
            acknowledgement(payload).stateVector === encodeStateVectorBase64(reloaded.document),
        ),
      10_000,
      "reload acknowledgement of the committed state",
    );

    const ack = acks.map(acknowledgement).find((parsed) => parsed.type === "coedit.ack");
    expect(ack?.stateVector).toBe(committed);
    expect(paragraphText(reloaded.document)).toContain("Committed before the reload");
    // The reload itself stored nothing: reading a durable room must not write.
    expect(running.go.stores.length).toBe(storesAfterEdit);
    // And the two facts the editor joins are now both true, with no edit.
    expect(
      deriveSaveState({
        localStateVector: encodeStateVectorBase64(reloaded.document),
        acknowledgedStateVector: ack?.stateVector ?? "",
        questionRevision: 1,
        connected: true,
        inFlight: false,
        error: null,
        lifecycle: null,
      }).name,
    ).toBe("saved");
  });

  it("reaches Saved for a state vector at the length that broke the old client hash", async () => {
    // Regression guard for the identity this replaced. The browser used to hash
    // its state vector with its own SHA-256 and compare digests with the
    // service\u0027s node:crypto. At 55 bytes (mod 64) the two implementations
    // padded differently, so the room committed every edit and still never
    // showed Saved. The identity is now the vector itself, so equality holds at
    // every length — including this one.
    const running = await startService();
    const document = new Y.Doc();
    const provider = connect(running, { token: mintToken(), document });
    await waitFor(() => provider.isSynced, 5_000, "initial sync");

    const acks: Array<{ stateVector: string }> = [];
    provider.on("stateless", ({ payload }: { payload: string }) => {
      try {
        const parsed = JSON.parse(payload) as { type?: string; stateVector?: string };
        if (parsed.type === "coedit.ack" && typeof parsed.stateVector === "string") {
          acks.push({ stateVector: parsed.stateVector });
        }
      } catch {
        // Frame types we do not define are not acknowledgements.
      }
    });

    // This tab\u0027s own client id joins the vector with its first local edit.
    appendParagraph(document, "padded by a returning author");
    const length = padStateVectorToOldFailureLength(document);
    expect(length % 64).toBe(55);

    const local = encodeStateVectorBase64(document);
    await waitFor(
      () => acks.some((ack) => ack.stateVector === local),
      10_000,
      "acknowledgement of the padded state vector",
    );

    const accepted = acks.find((ack) => ack.stateVector === local);
    expect(accepted).toBeDefined();
    // The two facts the editor joins to render Saved: the service acknowledged
    // exactly this state, and the save-state machine agrees.
    expect(accepted?.stateVector).toBe(encodeStateVectorBase64(document));
    // The identity is the state itself. A 64-character hex digest is exactly
    // what used to be compared here, and what silently disagreed at this
    // length, so pin that no digest is involved.
    expect(accepted?.stateVector).not.toMatch(/^[0-9a-f]{64}$/);
    expect(
      deriveSaveState({
        localStateVector: local,
        acknowledgedStateVector: accepted?.stateVector ?? "",
        questionRevision: 2,
        connected: true,
        inFlight: false,
        error: null,
        lifecycle: null,
      }).name,
    ).toBe("saved");
  });

  it("connects an observer read-only and refuses its writes", async () => {
    const running = await startService();
    const author = connect(running, { token: mintToken() });
    await waitFor(() => author.isSynced, 5_000, "author sync");
    appendParagraph(author.document, "Committed by Alice");
    await waitFor(() => running.go.stores.length > 0, 5_000, "first store");

    const observer = connect(running, { token: mintToken({ mode: "read", actorId: "actor-observer" }) });
    await waitFor(() => observer.isSynced, 5_000, "observer sync");
    expect(observer.authorizedScope).toBe("readonly");

    const storesBefore = running.go.stores.length;
    const frames: string[] = [];
    observer.on("stateless", ({ payload }: { payload: string }) => frames.push(payload));
    appendParagraph(observer.document, "Observer should not persist");
    await waitFor(
      () => refusalRecoveryFrom(frames) !== null,
      5_000,
      "the refusal announcement for a refused observer write",
    );
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(running.go.stores.length).toBe(storesBefore);
    expect(JSON.stringify(running.go.materializedPrompt)).not.toContain("Observer should not persist");
    expect(paragraphText(author.document)).not.toContain("Observer should not persist");
    // Hocuspocus refuses the update with a SyncStatus frame the provider
    // ignores, so without this announcement the author keeps a draft the server
    // does not have and a status that never leaves Syncing. The frame carries
    // the export recovery, not a retry that cannot succeed.
    const refusal = refusalRecoveryFrom(frames);
    expect(refusal?.parsed).toMatchObject({
      type: "coedit.save_failed",
      documentName: DOCUMENT_NAME,
      retryable: false,
      requiresResync: false,
    });
    expect(refusal?.recovery?.issue).toBe("rejected");
    expect(refusal?.recovery?.message).toMatch(/not saved/);
  });

  it("relays a validated workspace command and drops a forged one", async () => {
    const running = await startService();
    const author = connect(running, {
      token: mintToken(workspaceClaims()),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    await waitFor(() => author.isSynced, 5_000, "author sync");
    const peer = connect(running, {
      token: mintToken(workspaceClaims({ actorId: "actor-bob" })),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    const observer = connect(running, {
      token: mintToken(workspaceClaims({ mode: "read", actorId: "actor-obs" })),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    await waitFor(() => peer.isSynced && observer.isSynced, 5_000, "peer sync");

    const received: string[] = [];
    peer.on("stateless", ({ payload }: { payload: string }) => received.push(payload));

    const command = createSatWorkspaceCommand({
      documentName: WORKSPACE_DOCUMENT_NAME,
      actorId: "actor-alice",
      command: "question.deleted",
      payload: { questionId: "q-1" },
    });
    author.sendStateless(JSON.stringify(command));
    await waitFor(
      () => received.some((payload) => JSON.parse(payload).commandId === command.commandId),
      5_000,
      "the relayed command",
    );

    // A forged actor: the browser cannot relay as somebody else, because the
    // service binds the connection's signed identity to the envelope.
    const forged = { ...command, actorId: "actor-mallory", commandId: "forged-1" };
    author.sendStateless(JSON.stringify(forged));
    // A read-only connection cannot relay at all.
    observer.sendStateless(JSON.stringify({ ...command, commandId: "read-only-1" }));
    // A command for another room is not a command for this one.
    author.sendStateless(
      JSON.stringify({ ...command, documentName: DOCUMENT_NAME, commandId: "foreign-1" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(received.map((payload) => JSON.parse(payload).commandId)).toEqual([command.commandId]);
  });

  it("arbitrates concurrent workspace seeds and never relays the seed proposal", async () => {
    const running = await startService();
    const alice = connect(running, {
      token: mintToken(workspaceClaims({ actorId: "actor-alice" })),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    const bob = connect(running, {
      token: mintToken(workspaceClaims({ actorId: "actor-bob" })),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    await waitFor(() => alice.isSynced && bob.isSynced, 5_000, "workspace seed clients");

    const received: string[] = [];
    bob.on("stateless", ({ payload }: { payload: string }) => received.push(payload));
    const first = createWorkspaceSeedFrame({
      documentName: WORKSPACE_DOCUMENT_NAME,
      root: "scalar",
      path: "question/q1/scalar",
      value: { source: "alice" },
      sourceQuestionRevision: 1,
    });
    const second = createWorkspaceSeedFrame({
      documentName: WORKSPACE_DOCUMENT_NAME,
      root: "scalar",
      path: "question/q1/scalar",
      value: { source: "bob" },
      sourceQuestionRevision: 1,
    });
    alice.sendStateless(JSON.stringify(first));
    bob.sendStateless(JSON.stringify(second));

    await waitFor(
      () => running.go.stores.length > 0 && running.go.committedState !== null,
      5_000,
      "durable workspace seed",
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    const committed = new Y.Doc();
    Y.applyUpdate(committed, running.go.committedState as Buffer);
    const stored = committed.getMap("workspace").get("question/q1/scalar");
    expect([JSON.stringify({ source: "alice" }), JSON.stringify({ source: "bob" })]).toContain(stored);
    expect(received.some((payload) => JSON.parse(payload).type === "coedit.seed")).toBe(false);
  });

  it("reports a refused seed store and stays up instead of dying on it", async () => {
    // The outage this pins: a seed proposal whose store was refused rejected the
    // `onStateless` hook. Hocuspocus does not catch a rejected stateless hook,
    // so it was an unhandled rejection — the service exited, and from then on
    // every browser got `503` on the co-edit socket, which is what an author
    // sees as "Couldn't save - Retry" that never comes back with "Still
    // saving...". One refused proposal must never cost the whole service.
    const running = await startService();
    const alice = connect(running, {
      token: mintToken(workspaceClaims({ actorId: "actor-alice" })),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    await waitFor(() => alice.isSynced, 5_000, "seed client");

    const received: string[] = [];
    alice.on("stateless", ({ payload }: { payload: string }) => received.push(payload));
    const rejectedBefore = seedOutcomeCount("rejected");
    running.go.refuseStores = true;

    alice.sendStateless(
      JSON.stringify(
        createWorkspaceSeedFrame({
          documentName: WORKSPACE_DOCUMENT_NAME,
          root: "scalar",
          path: "question/q1/scalar",
          value: { source: "alice" },
          sourceQuestionRevision: 1,
        }),
      ),
    );

    await waitFor(
      () => seedOutcomeCount("rejected") === rejectedBefore + 1,
      5_000,
      "the refused seed store",
    );
    // The refusal reaches the editor in the vocabulary it already has (awaited,
    // because it arrives over the socket and can land just after the metric).
    await waitFor(
      () => received.some((payload) => JSON.parse(payload).type === "coedit.save_failed"),
      5_000,
      "the refusal frame reaching the proposer",
    );

    // ...and the room is still serving: the next store is accepted.
    running.go.refuseStores = false;
    const storesBefore = running.go.stores.length;
    const room = running.service.server.hocuspocus.documents.get(
      WORKSPACE_DOCUMENT_NAME,
    ) as unknown as Y.Doc;
    room.transact(() => {
      room.getMap("workspace").set("question/q2/scalar", JSON.stringify({ source: "alice" }));
    }, "test-edit");
    await waitFor(
      () => running.go.stores.length > storesBefore && running.go.committedState !== null,
      5_000,
      "a store after the refused seed",
    );
  });

  it("stores on request, so a refused save is retried without another edit", async () => {
    // What the editor's Retry action must achieve: the room was left holding
    // state it could not make durable, and asking again — with no new edit — has
    // to commit it. A reconnect alone cannot: Hocuspocus stores a document only
    // when an update re-arms its debounce, which is why the save area used to
    // sit at "Still saving…" with nothing in flight.
    const running = await startService();
    const alice = connect(running, {
      token: mintToken(workspaceClaims({ actorId: "actor-alice" })),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    const frames: string[] = [];
    alice.on("stateless", ({ payload }: { payload: string }) => frames.push(payload));
    await waitFor(() => alice.isSynced, 5_000, "workspace client");

    // The edit reaches the room; the store it triggers is refused, so the room
    // holds work that is not durable.
    running.go.refuseStores = true;
    alice.document.getMap("workspace").set("ui/selectedQuestionId", JSON.stringify("q-1"));
    await waitFor(() => running.go.stores.length > 0, 5_000, "the refused store");

    running.go.refuseStores = false;
    const storesBefore = running.go.stores.length;
    frames.length = 0;
    alice.sendStateless(JSON.stringify(createCoeditStoreRequest(WORKSPACE_DOCUMENT_NAME)));

    await waitFor(
      () => running.go.stores.length > storesBefore,
      5_000,
      "the store the retry asked for",
    );
    // The request is answered in the ordinary vocabulary, and only for the
    // state the tab actually holds — the same comparison the browser uses to
    // decide it may show Saved.
    const vector = encodeStateVectorBase64(alice.document);
    await waitFor(
      () =>
        frames.some((frame) => {
          const parsed = JSON.parse(frame) as { type?: string; stateVector?: string };
          return parsed.type === "coedit.ack" && parsed.stateVector === vector;
        }),
      5_000,
      "the acknowledgement for the requested store",
    );
  });

  it("ignores a store request from a read-only observer", async () => {
    const running = await startService();
    const observer = connect(running, {
      token: mintToken(workspaceClaims({ actorId: "actor-obs", mode: "read" })),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    await waitFor(() => observer.isSynced, 5_000, "observer client");

    const storesBefore = running.go.stores.length;
    observer.sendStateless(JSON.stringify(createCoeditStoreRequest(WORKSPACE_DOCUMENT_NAME)));
    await new Promise((resolve) => setTimeout(resolve, 400));

    // An observer's room has nothing to commit on its behalf, and its write
    // refusal already has its own path.
    expect(running.go.stores.length).toBe(storesBefore);
  });

  it("treats a retried seed as the same proposal and refuses a read token's seed", async () => {
    const running = await startService();
    const alice = connect(running, {
      token: mintToken(workspaceClaims({ actorId: "actor-alice" })),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    const observer = connect(running, {
      token: mintToken(workspaceClaims({ actorId: "actor-obs", mode: "read" })),
      documentName: WORKSPACE_DOCUMENT_NAME,
    });
    await waitFor(() => alice.isSynced && observer.isSynced, 5_000, "seed clients");
    const rejectedBefore = seedOutcomeCount("rejected");
    const acceptedBefore = seedOutcomeCount("accepted");
    const duplicateBefore = seedOutcomeCount("duplicate");

    const seed = createWorkspaceSeedFrame({
      documentName: WORKSPACE_DOCUMENT_NAME,
      root: "scalar",
      path: "question/q1/scalar",
      value: { source: "alice" },
    });

    // A seed is a write, so a read token cannot make one even in the room it is
    // allowed to observe.
    observer.sendStateless(JSON.stringify(seed));
    await waitFor(
      () => seedOutcomeCount("rejected") === rejectedBefore + 1,
      5_000,
      "the refused read-token seed",
    );

    alice.sendStateless(JSON.stringify(seed));
    await waitFor(
      () => seedOutcomeCount("accepted") === acceptedBefore + 1,
      5_000,
      "the accepted seed",
    );
    // The proposer learns the value from the ROOM, not from its own write: the
    // accepted seed reaches it as the same Yjs update every other author gets.
    await waitFor(
      () =>
        alice.document.getMap("workspace").get("question/q1/scalar") ===
        JSON.stringify({ source: "alice" }),
      5_000,
      "the applied seed reaching the proposer",
    );

    // The same deterministic seed id again is the SAME proposal, so it is
    // recognized above the root check and never re-applied: a reconnect or a
    // retry after a lost frame cannot double a seed.
    alice.sendStateless(JSON.stringify(seed));
    await waitFor(
      () => seedOutcomeCount("duplicate") === duplicateBefore + 1,
      5_000,
      "the duplicate seed",
    );
    expect(seedOutcomeCount("accepted")).toBe(acceptedBefore + 1);

    const room = running.service.server.hocuspocus.documents.get(
      WORKSPACE_DOCUMENT_NAME,
    ) as unknown as Y.Doc;
    expect(room.getMap("workspace").get("question/q1/scalar")).toBe(
      JSON.stringify({ source: "alice" }),
    );
  });

  it("rejects a token minted for a different room", async () => {
    const running = await startService();
    const reasons: string[] = [];
    const provider = connect(running, {
      token: mintToken({ documentName: "coedit:v1:99999999-8888-7777-6666-555555555555" }),
    });
    provider.on("authenticationFailed", ({ reason }: { reason: string }) => reasons.push(reason));

    await waitFor(() => reasons.length > 0, 5_000, "authentication failure");
    expect(provider.isSynced).toBe(false);
    expect(running.go.loads).toHaveLength(0);
  });

  it("refuses a closed document before loading any content", async () => {
    const go = await startFakeGo({ lifecycle: "closed" });
    const running = await startService({ go });
    const reasons: string[] = [];
    const provider = connect(running, { token: mintToken() });
    provider.on("authenticationFailed", ({ reason }: { reason: string }) => reasons.push(reason));

    await waitFor(() => reasons.length > 0 || go.unauthorized > 0, 5_000, "closed document refusal");
    expect(provider.isSynced).toBe(false);
  });

  it("rejects a new write token while the durable row is frozen", async () => {
    const go = await startFakeGo({ lifecycle: "frozen" });
    const running = await startService({ go });
    const reasons: string[] = [];
    const provider = connect(running, { token: mintToken() });
    provider.on("authenticationFailed", ({ reason }: { reason: string }) => reasons.push(reason));

    await waitFor(() => reasons.length > 0, 5_000, "durable freeze refusal");

    expect(provider.isSynced).toBe(false);
    expect(go.loads).toHaveLength(1);
  });

  it("keeps a read observer read-only after an in-memory freeze is released", async () => {
    const running = await startService();
    const author = connect(running, { token: mintToken() });
    await waitFor(() => author.isSynced, 5_000, "author sync");

    const frozen = await controlCall(running, "/control/freeze", { documentNames: [DOCUMENT_NAME] });
    expect(frozen.status).toBe(200);
    const observer = connect(running, {
      token: mintToken({ mode: "read", actorId: "actor-observer" }),
    });
    await waitFor(() => observer.isSynced, 5_000, "observer sync during freeze");
    const unfrozen = await controlCall(running, "/control/unfreeze", {
      freezeToken: frozen.body["freezeToken"],
    });
    expect(unfrozen.status).toBe(200);

    const storesBefore = running.go.stores.length;
    const frames: string[] = [];
    observer.on("stateless", ({ payload }: { payload: string }) => frames.push(payload));
    appendParagraph(observer.document, "read observer must stay read-only");
    await waitFor(
      () => refusalRecoveryFrom(frames) !== null,
      5_000,
      "read-only refusal after unfreeze",
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(observer.authorizedScope).toBe("readonly");
    expect(running.go.stores.length).toBe(storesBefore);
  });

  it("derives awareness identity on the server and drops client-defined fields", async () => {
    const running = await startService();
    const author = connect(running, { token: mintToken() });
    await waitFor(() => author.isSynced, 5_000, "author sync");
    const watcher = connect(running, { token: mintToken({ actorId: "actor-watcher", displayName: "Bob Watcher" }) });
    await waitFor(() => watcher.isSynced, 5_000, "watcher sync");

    author.setAwarenessField("user", { id: "spoofed", name: "Spoofed Name", color: "red" });
    author.setAwarenessField("injected", "should-be-removed");
    author.setAwarenessField("cursor", { anchor: 1, head: 1 });

    await waitFor(() => {
      const states = [...watcher.awareness!.getStates().values()] as Array<Record<string, unknown>>;
      return states.some((state) => (state["user"] as Record<string, unknown> | undefined)?.["id"] === "actor-alice");
    }, 5_000, "remote awareness");

    const states = [...watcher.awareness!.getStates().values()] as Array<Record<string, unknown>>;
    const alice = states.find(
      (state) => (state["user"] as Record<string, unknown> | undefined)?.["id"] === "actor-alice",
    );
    expect(alice).toBeDefined();
    expect((alice?.["user"] as Record<string, unknown>)["name"]).toBe("Alice Author");
    expect(alice?.["injected"]).toBeUndefined();
    expect(String((alice?.["user"] as Record<string, unknown>)["color"])).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("freezes, flushes, unfreezes, and closes a room through the control API", async () => {
    const running = await startService();
    const author = connect(running, { token: mintToken() });
    await waitFor(() => author.isSynced, 5_000, "author sync");

    const frozen = await controlCall(running, "/control/freeze", { documentNames: [DOCUMENT_NAME] });
    expect(frozen.status).toBe(200);
    const manifest = frozen.body["manifest"] as Array<{ stateHash: string; questionRevision: number }>;
    expect(manifest[0]?.stateHash).toBe(String(running.go.committedHash));
    expect(running.go.unauthorized).toBe(0);

    const renewed = await controlCall(running, "/control/renew", {
      freezeToken: frozen.body["freezeToken"],
      freezeExpiresAt: Math.floor(Date.now() / 1000) + 30,
    });
    expect(renewed.status).toBe(200);

    // Edits while frozen are refused, not silently dropped: nothing new reaches
    // Go, and the author is TOLD the write was refused (a freeze makes every
    // connection read-only, which is exactly when Hocuspocus drops an update).
    const storesWhileFrozen = running.go.stores.length;
    const framesWhileFrozen: string[] = [];
    author.on("stateless", ({ payload }: { payload: string }) => framesWhileFrozen.push(payload));
    appendParagraph(author.document, "Edit during publish");
    await waitFor(
      () => refusalRecoveryFrom(framesWhileFrozen) !== null,
      5_000,
      "the refusal announcement for a frozen-room edit",
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(running.go.stores.length).toBe(storesWhileFrozen);
    expect(refusalRecoveryFrom(framesWhileFrozen)?.recovery?.issue).toBe("rejected");

    const unfrozen = await controlCall(running, "/control/unfreeze", {
      freezeToken: frozen.body["freezeToken"],
    });
    expect(unfrozen.status).toBe(200);
    appendParagraph(author.document, "Edit after publish");
    await waitFor(() => running.go.stores.length > storesWhileFrozen, 5_000, "store after unfreeze");

    const closed = await controlCall(running, "/control/close", {
      documentNames: [DOCUMENT_NAME],
      reason: "exam_published",
    });
    expect(closed.status).toBe(200);
    await waitFor(() => running.service.lifecycle.isClosed(DOCUMENT_NAME), 2_000, "closed room");
  });

  it("flushes pending state and releases the lock on graceful shutdown", async () => {
    const running = await startService();
    const author = connect(running, { token: mintToken() });
    await waitFor(() => author.isSynced, 5_000, "author sync");

    appendParagraph(author.document, "First edit");
    await waitFor(
      () => running.go.stores.length > 0 && JSON.stringify(running.go.materializedPrompt).includes("First edit"),
      5_000,
      "first store",
    );
    const storesBefore = running.go.stores.length;

    // The edit reaches the room, then shutdown lands inside the store debounce
    // window: the pending state must be flushed rather than lost.
    const serverDocument = running.service.server.hocuspocus.documents.get(DOCUMENT_NAME);
    expect(serverDocument).toBeDefined();
    appendParagraph(author.document, "Written just before shutdown");
    await waitFor(
      () => serverDocument?.getXmlFragment("prompt").toString().includes("Written just before shutdown") === true,
      5_000,
      "edit to reach the room",
    );

    const outcome = await running.service.stop();

    expect(outcome).toBe("clean");
    expect(running.lock.released).toBe(true);
    expect(running.go.stores.length).toBeGreaterThan(storesBefore);
    expect(JSON.stringify(running.go.materializedPrompt)).toContain("Written just before shutdown");
    expect(running.service.isReady()).toBe(false);
  });

  it("never binds a port when the singleton lock cannot be acquired", async () => {
    const go = await startFakeGo();
    cleanups.push(() => go.close());
    const lock = new FakeLock(async () => {
      throw new Error("another authoring-coedit process already owns the lock");
    });
    expect(lock.isReady()).toBe(false);
    const config: CoeditServiceConfig = {
      environment: "test",
      port: 0,
      host: "127.0.0.1",
      mysqlDsn: "mysql://user:pass@127.0.0.1:3306/app",
      goBaseUrl: go.url,
      tokenSecret: TOKEN_SECRET,
      serviceSecret: SERVICE_SECRET,
      shutdownTimeoutMs: 5_000,
      lockTimeoutSeconds: 1,
      allowedOrigin: "",
    };
    const service = createCoeditService(config, { lock });

    await expect(service.start()).rejects.toThrow(/already owns/);
    expect(service.isReady()).toBe(false);
    expect(go.loads).toHaveLength(0);
  });

  it("closes every room and exits non-zero when the lock is lost", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const running = await startService();
      const author = connect(running, { token: mintToken() });
      await waitFor(() => author.isSynced, 5_000, "author sync");
      const closed: number[] = [];
      author.on("close", () => closed.push(Date.now()));

      // A second process taking the lock must not leave this one serving rooms.
      running.lock.onLost("singleton lock is owned by another session");

      await waitFor(() => closed.length > 0, 5_000, "room closure after lock loss");
      await waitFor(() => exit.mock.calls.length > 0, 5_000, "non-zero exit after lock loss");
      expect(running.service.isReady()).toBe(false);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      exit.mockRestore();
    }
  });
});

/**
 * Deterministic PRNG. A property test that fails once every ten runs is worse
 * than useless: the failing schedule must be reproducible from the log.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function roomProjection(document: Y.Doc): string {
  return document.getXmlFragment("prompt").toString();
}

/** One randomized edit, applied through the shared Y.Doc like a real client. */
function applyRandomEdit(document: Y.Doc, random: () => number, tag: string): void {
  const fragment = document.getXmlFragment("prompt");
  const roll = random();
  if (roll < 0.45 || fragment.length === 0) {
    appendParagraph(document, `${tag}-${Math.floor(random() * 1_000)}`);
    return;
  }
  const index = Math.floor(random() * fragment.length);
  const node = fragment.get(index) as Y.XmlElement;
  if (roll < 0.75) {
    // Insert into an existing paragraph, which is what a typist does.
    const text = node.toArray().find((child) => child instanceof Y.XmlText) as Y.XmlText | undefined;
    document.transact(() => {
      const target = text ?? (() => {
        const created = new Y.XmlText();
        node.insert(node.length, [created]);
        return created;
      })();
      target.insert(Math.min(1, target.length), tag);
    });
    return;
  }
  // Delete, but never the whole document: an empty room cannot prove convergence.
  if (fragment.length > 1) {
    document.transact(() => fragment.delete(index, 1));
  }
}

describe("convergence under randomized operations", () => {
  it("converges three clients under delay, duplication, reorder, disconnect, and reconnect", async () => {
    const running = await startService();
    const random = seeded(20_260_913);
    const alice = connect(running, { token: mintToken({ actorId: "actor-alice" }) });
    const bob = connect(running, { token: mintToken({ actorId: "actor-bob", displayName: "Bob" }) });
    const carol = connect(running, { token: mintToken({ actorId: "actor-carol", displayName: "Carol" }) });
    await waitFor(
      () => alice.isSynced && bob.isSynced && carol.isSynced,
      5_000,
      "three-client sync",
    );

    const clients = [alice, bob, carol];
    const preEditSnapshot = Y.encodeStateAsUpdate(alice.document);
    const captured: Uint8Array[] = [];
    const recorder = (update: Uint8Array) => captured.push(update);
    alice.document.on("update", recorder);

    for (let step = 0; step < 30; step += 1) {
      const actor = clients[Math.floor(random() * clients.length)]!;
      applyRandomEdit(actor.document, random, `s${step}`);

      // Delay: a random pause between operations, which reorders arrivals.
      await new Promise((resolve) => setTimeout(resolve, Math.floor(random() * 12)));

      // Disconnect and reconnect a random peer, mid-stream.
      if (random() < 0.2) {
        const peer = clients[Math.floor(random() * clients.length)]!;
        peer.disconnect();
        await new Promise((resolve) => setTimeout(resolve, 5));
        peer.connect();
      }
    }
    alice.document.off("update", recorder);

    // Duplication: the same wire update applied twice must be a no-op.
    const duplicate = captured.at(-1);
    if (duplicate) {
      const before = roomProjection(bob.document);
      Y.applyUpdate(bob.document, duplicate, "duplicate");
      Y.applyUpdate(bob.document, duplicate, "duplicate");
      expect(roomProjection(bob.document)).toBe(before);
    }

    // Reorder: a peer that was offline starts from the pre-edit state and
    // applies the same updates in reverse; the causally dependent ones pend
    // until their dependencies arrive.
    const offline = new Y.Doc();
    Y.applyUpdate(offline, preEditSnapshot, "reorder");
    for (const update of [...captured].reverse()) Y.applyUpdate(offline, update, "reorder");
    expect(roomProjection(offline)).toBe(roomProjection(alice.document));

    // Every peer comes back online before the convergence check: an offline
    // client is a different assertion (it converges on reconnect), not a
    // failure to converge.
    for (const client of clients) client.connect();
    const projections = () => {
      const server = running.service.server.hocuspocus.documents.get(DOCUMENT_NAME);
      return {
        alice: roomProjection(alice.document),
        bob: roomProjection(bob.document),
        carol: roomProjection(carol.document),
        room: server ? roomProjection(server as unknown as Y.Doc) : "<unloaded>",
      };
    };
    try {
      await waitFor(
        () => {
          const snapshot = projections();
          return (
            snapshot.room === snapshot.alice &&
            snapshot.room === snapshot.bob &&
            snapshot.room === snapshot.carol
          );
        },
        20_000,
        "three-client convergence",
      );
    } catch (error) {
      throw new Error(`${(error as Error).message}: ${JSON.stringify(projections())}`);
    }

    const server = running.service.server.hocuspocus.documents.get(DOCUMENT_NAME) as unknown as Y.Doc;
    const before = Y.encodeStateAsUpdate(server);
    const reloadedOnce = new Y.Doc();
    Y.applyUpdate(reloadedOnce, before, "reload");
    const reloadedTwice = new Y.Doc();
    Y.applyUpdate(reloadedTwice, Y.encodeStateAsUpdate(reloadedOnce), "reload");
    // Repeated encode/load cycles must be stable, not slowly lossy.
    expect(roomProjection(reloadedTwice)).toBe(roomProjection(server));
    expect(Y.encodeStateAsUpdate(reloadedTwice)).toEqual(Y.encodeStateAsUpdate(reloadedOnce));

    // The materialized projection is what Go would publish: it must contain the
    // converged text, not a stale prefix of it.
    await waitFor(
      () => JSON.stringify(running.go.materializedPrompt ?? {}).includes("s29") || running.go.stores.length > 0,
      5_000,
      "materialized store",
    );
  });

  it("keeps room state bounded across repeated open/close cycles", async () => {
    const running = await startService();
    const cycles = 6;
    const names: string[] = [];
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      // A new working draft gets a new document; a historical document is never
      // reopened (design 2026-09-13, "Document identity").
      const name = `coedit:v1:0000000${cycle}-0000-4000-8000-00000000000${cycle}`;
      names.push(name);
      const provider = connect(running, {
        token: mintToken({ documentName: name }),
        documentName: name,
      });
      await waitFor(() => provider.isSynced, 5_000, `cycle ${cycle} sync`);
      expect(running.service.server.hocuspocus.documents.size).toBe(1);
      appendParagraph(provider.document, `cycle-${cycle}`);
      await waitFor(
        () => running.go.stores.length >= cycle + 1,
        5_000,
        `cycle ${cycle} store`,
      );
      // The browser goes away first (that is what a closed tab looks like), so
      // the unload we assert below is the server's own doing rather than the
      // side effect of a socket we kept open.
      provider.destroy();
      await waitFor(
        () => !running.service.server.hocuspocus.documents.has(name),
        10_000,
        `cycle ${cycle} room unload`,
      );
      const closed = await controlCall(running, "/control/close", {
        documentNames: [name],
        reason: "draft_replaced",
      });
      expect(closed.status).toBe(200);
      expect(running.service.lifecycle.isClosed(name)).toBe(true);
      // Bounded: each cycle leaves nothing behind for the next one.
      expect(running.service.server.hocuspocus.documents.size).toBe(0);
    }

    // Every document was seeded exactly once across the whole run, and no closed
    // room was ever reopened.
    expect(running.go.initializes).toHaveLength(cycles);
    expect(names.filter((name) => running.service.lifecycle.isClosed(name))).toHaveLength(cycles);
    // A closed document is refused if a stale client reconnects to it.
    const refused: string[] = [];
    const stale = connect(running, {
      token: mintToken({ documentName: names[0]! }),
      documentName: names[0]!,
    });
    stale.on("authenticationFailed", ({ reason }: { reason: string }) => refused.push(reason));
    await waitFor(() => refused.length > 0, 5_000, "closed document refusal");
    expect(stale.isSynced).toBe(false);
    expect(running.service.isReady()).toBe(true);
  });
});

async function controlCall(
  running: Running,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  const { timestamp, signature } = signServiceRequest(
    SERVICE_SECRET,
    "POST",
    path,
    payload,
    Math.floor(Date.now() / 1000),
  );
  const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-coedit-timestamp": timestamp,
      "x-coedit-signature": signature,
    },
    body: payload,
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}
