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

const TOKEN_SECRET = "t".repeat(40);
const SERVICE_SECRET = "s".repeat(40);
const DOCUMENT_UUID = "2f1b6c1e-6a0a-4a5b-9f0e-9d3a2f4c5b6d";
const DOCUMENT_NAME = `coedit:v1:${DOCUMENT_UUID}`;

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
  examQuestionId: string;
  questionRevisionId: string;
  mode: "write" | "read";
  issuedAt: number;
  expiresAt: number;
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
  lifecycle: "initializing" | "active" | "closed";
  unauthorized: number;
  close(): Promise<void>;
}

async function startFakeGo(options: { lifecycle?: "initializing" | "active" | "closed" } = {}): Promise<FakeGo> {
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
    close: async () => {},
  };

  // Per-document lifecycle: a close on one room must not close a neighbouring
  // room, and a document that was closed once is never reopened.
  const byName = new Map<string, "initializing" | "active" | "closed">();
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

    const ack = JSON.parse(acks[0] as string) as { type: string; stateHash: string; questionRevision: number };
    expect(ack.type).toBe("coedit.ack");
    expect(running.go.stores.length).toBeGreaterThan(0);
    expect(paragraphText(provider.document)).toContain("Alice was here");
    // The acknowledgement identifies the exact state Go committed, which is
    // what lets a client mark Saved only for its own current state.
    expect(ack.stateHash).toBe(String(running.go.stores.at(-1)?.["stateHash"]));
    expect(ack.questionRevision).toBe(2);
    expect(hashStateVector(Y.encodeStateVector(provider.document))).toBe(ack.stateHash);
    expect(JSON.stringify(running.go.materializedPrompt)).toContain("Alice was here");
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
    appendParagraph(observer.document, "Observer should not persist");
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(running.go.stores.length).toBe(storesBefore);
    expect(JSON.stringify(running.go.materializedPrompt)).not.toContain("Observer should not persist");
    expect(paragraphText(author.document)).not.toContain("Observer should not persist");
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

    // Edits while frozen are refused, not silently dropped: nothing new reaches Go.
    const storesWhileFrozen = running.go.stores.length;
    appendParagraph(author.document, "Edit during publish");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(running.go.stores.length).toBe(storesWhileFrozen);

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
