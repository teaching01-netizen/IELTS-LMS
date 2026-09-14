import { createServer, type Server } from "node:http";
import type { Hocuspocus } from "@hocuspocus/server";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { signServiceRequest } from "../authToken.js";
import { CONTROL_PATHS, LifecycleController, type CoeditConnectionContext } from "../lifecycleControl.js";
import type { CoeditCommit, CoeditPersistence } from "../persistence.js";

const SERVICE_SECRET = "s".repeat(40);
const NOW_SECONDS = 1_700_000_010;
const DOCUMENT_NAME = "coedit:v1:11111111-2222-3333-4444-555555555555";
const OTHER_DOCUMENT = "coedit:v1:99999999-8888-7777-6666-555555555555";

class FakeConnection {
  readOnly = false;
  socketId = "socket-1";
  closed = false;
  close(event?: { code?: number; reason?: string }): void {
    this.closed = true;
    this.lastClose = event ?? null;
  }
  lastClose: { code?: number; reason?: string } | null = null;
}

class FakeDocument extends Y.Doc {
  readonly connections = new Map<FakeConnection, { clients: Set<number> }>();
  readonly stateless: string[] = [];
  broadcastStateless(payload: string): void {
    this.stateless.push(payload);
  }
  constructor() {
    super();
    this.connections.set(new FakeConnection(), { clients: new Set([1]) });
  }
  getConnections(): FakeConnection[] {
    return [...this.connections.keys()];
  }
  getConnectionsCount(): number {
    return this.connections.size;
  }
}

class FakeHocuspocus {
  readonly documents = new Map<string, FakeDocument>();
  readonly closedRooms: string[] = [];
  add(name: string): FakeDocument {
    const document = new FakeDocument();
    this.documents.set(name, document);
    return document;
  }
  closeConnections(name?: string): void {
    this.closedRooms.push(name ?? "*");
    for (const [key, document] of this.documents) {
      if (name && key !== name) continue;
      for (const connection of document.getConnections()) connection.close();
    }
  }
}

interface Harness {
  url: string;
  controller: LifecycleController;
  hocuspocus: FakeHocuspocus;
  stores: string[];
  forgotten: string[];
}

const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function harness(
  overrides: { ready?: boolean; shuttingDown?: boolean; freezeLeaseSeconds?: number } = {},
): Promise<Harness> {
  const hocuspocus = new FakeHocuspocus();
  const stores: string[] = [];
  const forgotten: string[] = [];
  const commits = new Map<string, CoeditCommit>();
  const persistence = {
    lastCommit: (name: string) => commits.get(name) ?? null,
    store: async ({ documentName }: { documentName: string }) => {
      stores.push(documentName);
      const commit: CoeditCommit = {
        stateHash: `hash-${stores.length}`,
        questionRevision: 7,
        materializedRevision: 7,
        acknowledgedAt: 0,
      };
      commits.set(documentName, commit);
      return commit;
    },
    forget: (name: string) => {
      forgotten.push(name);
      commits.delete(name);
    },
  } as unknown as CoeditPersistence;

  const controller = new LifecycleController({
    serviceSecret: SERVICE_SECRET,
    hocuspocus: hocuspocus as unknown as Hocuspocus<CoeditConnectionContext>,
    persistence,
    isReady: () => overrides.ready ?? true,
    isShuttingDown: () => overrides.shuttingDown ?? false,
    allowedOrigin: "",
    now: () => NOW_SECONDS * 1000,
    ...(overrides.freezeLeaseSeconds === undefined
      ? {}
      : { freezeLeaseSeconds: overrides.freezeLeaseSeconds }),
  });

  const server = createServer((req, res) => {
    void controller.handle(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, controller, hocuspocus, stores, forgotten };
}

async function control(
  harnessed: Harness,
  path: string,
  body: unknown,
  options: { sign?: boolean; timestampOffsetSeconds?: number } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.sign !== false) {
    const { timestamp, signature } = signServiceRequest(
      SERVICE_SECRET,
      "POST",
      path,
      payload,
      NOW_SECONDS + (options.timestampOffsetSeconds ?? 0),
    );
    headers["x-coedit-timestamp"] = timestamp;
    headers["x-coedit-signature"] = signature;
  }
  const response = await fetch(`${harnessed.url}${path}`, {
    method: "POST",
    headers,
    ...(payload ? { body: payload } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

describe("control surface", () => {
  it("reports readiness only while the service can own the lock", async () => {
    const ready = await harness();
    const notReady = await harness({ ready: false });
    const shuttingDown = await harness({ ready: true, shuttingDown: true });

    expect((await fetch(`${ready.url}/readyz`)).status).toBe(200);
    expect((await fetch(`${notReady.url}/readyz`)).status).toBe(503);
    expect((await fetch(`${shuttingDown.url}/readyz`)).status).toBe(503);
  });

  it("exposes metrics with closed label vocabularies and no document identity", async () => {
    const harnessed = await harness();
    harnessed.hocuspocus.add(DOCUMENT_NAME);
    await control(harnessed, CONTROL_PATHS.freeze, { documentNames: [DOCUMENT_NAME] });

    const response = await fetch(`${harnessed.url}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('# TYPE authoring_coedit_freeze_total counter');
    expect(body).toContain('authoring_coedit_freeze_total{outcome="accepted"} 1');
    // Content-free: no document name, id, or hash may become a label value.
    expect(body).not.toContain(DOCUMENT_NAME);
    expect(body).not.toContain("hash-1");
  });

  it("rejects an unsigned or expired control call", async () => {
    const harnessed = await harness();
    const unsigned = await control(
      harnessed,
      CONTROL_PATHS.freeze,
      { documentNames: [DOCUMENT_NAME] },
      { sign: false },
    );
    expect(unsigned.status).toBe(403);
    const expired = await control(
      harnessed,
      CONTROL_PATHS.freeze,
      { documentNames: [DOCUMENT_NAME] },
      { timestampOffsetSeconds: 600 },
    );
    expect(expired.status).toBe(403);
  });

  it("rejects a document name outside the frozen vocabulary", async () => {
    const harnessed = await harness();
    const response = await control(harnessed, CONTROL_PATHS.freeze, { documentNames: ["exam:1"] });
    expect(response.status).toBe(422);
  });
});

describe("freeze", () => {
  it("makes rooms read-only, flushes, and returns a manifest of committed hashes", async () => {
    const harnessed = await harness();
    const document = harnessed.hocuspocus.add(DOCUMENT_NAME);

    const response = await control(harnessed, CONTROL_PATHS.freeze, { documentNames: [DOCUMENT_NAME] });

    expect(response.status).toBe(200);
    expect(harnessed.stores).toEqual([DOCUMENT_NAME]);
    expect(document.getConnections().every((connection) => connection.readOnly)).toBe(true);
    expect(JSON.parse(document.stateless[0] ?? "{}")).toEqual({
      type: "coedit.lifecycle",
      documentName: DOCUMENT_NAME,
      phase: "freezing",
      reason: "publish",
    });
    const manifest = response.body["manifest"] as Array<Record<string, unknown>>;
    expect(manifest).toHaveLength(1);
    expect(manifest[0]?.["stateHash"]).toBe("hash-1");
    expect(manifest[0]?.["questionRevision"]).toBe(7);
    expect(typeof response.body["freezeToken"]).toBe("string");
  });

  it("unfreezes on the explicit token before the lease expires", async () => {
    const harnessed = await harness();
    const document = harnessed.hocuspocus.add(DOCUMENT_NAME);
    const frozen = await control(harnessed, CONTROL_PATHS.freeze, { documentNames: [DOCUMENT_NAME] });
    const freezeToken = frozen.body["freezeToken"] as string;

    const unfrozen = await control(harnessed, CONTROL_PATHS.unfreeze, { freezeToken });

    expect(unfrozen.status).toBe(200);
    expect(harnessed.controller.isFrozen(DOCUMENT_NAME)).toBe(false);
    expect(document.getConnections().every((connection) => connection.readOnly)).toBe(false);
    expect(JSON.parse(document.stateless.at(-1) ?? "{}")).toEqual({
      type: "coedit.lifecycle",
      documentName: DOCUMENT_NAME,
      phase: "active",
      reason: "publish",
    });
  });

  it("auto-unfreezes when the lease expires, so a crashed publish cannot brick a draft", async () => {
    const harnessed = await harness({ freezeLeaseSeconds: 0.05 });
    const document = harnessed.hocuspocus.add(DOCUMENT_NAME);
    const frozen = await control(harnessed, CONTROL_PATHS.freeze, { documentNames: [DOCUMENT_NAME] });
    expect(harnessed.controller.isFrozen(DOCUMENT_NAME)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(harnessed.controller.isFrozen(DOCUMENT_NAME)).toBe(false);
    expect(document.getConnections().every((connection) => connection.readOnly)).toBe(false);
    // A decision that arrives after expiry is a no-op, not an error: the lease
    // already released the room.
    const late = await control(harnessed, CONTROL_PATHS.unfreeze, {
      freezeToken: frozen.body["freezeToken"],
    });
    expect(late.status).toBe(200);
  });

  it("keeps the frozen flag raised so the store hook refuses new edits", async () => {
    const harnessed = await harness();
    harnessed.hocuspocus.add(DOCUMENT_NAME);
    await control(harnessed, CONTROL_PATHS.freeze, { documentNames: [DOCUMENT_NAME] });
    expect(harnessed.controller.isFrozen(DOCUMENT_NAME)).toBe(true);
    expect(harnessed.stores).toHaveLength(1);
  });

  it("refuses a freeze with no documents", async () => {
    const harnessed = await harness();
    expect((await control(harnessed, CONTROL_PATHS.freeze, { documentNames: [] })).status).toBe(422);
  });
});

describe("flush and close", () => {
  it("flushes every listed document", async () => {
    const harnessed = await harness();
    harnessed.hocuspocus.add(DOCUMENT_NAME);
    harnessed.hocuspocus.add(OTHER_DOCUMENT);
    const response = await control(harnessed, CONTROL_PATHS.flush, {
      documentNames: [DOCUMENT_NAME, OTHER_DOCUMENT],
    });
    expect(response.status).toBe(200);
    expect(harnessed.stores).toEqual([DOCUMENT_NAME, OTHER_DOCUMENT]);
  });

  it("closes rooms with a known reason, forgets them, and drops their sockets", async () => {
    const harnessed = await harness();
    const document = harnessed.hocuspocus.add(DOCUMENT_NAME);
    await control(harnessed, CONTROL_PATHS.freeze, { documentNames: [DOCUMENT_NAME] });

    const response = await control(harnessed, CONTROL_PATHS.close, {
      documentNames: [DOCUMENT_NAME],
      reason: "exam_published",
    });

    expect(response.status).toBe(200);
    expect(harnessed.controller.isClosed(DOCUMENT_NAME)).toBe(true);
    expect(harnessed.controller.isFrozen(DOCUMENT_NAME)).toBe(false);
    expect(harnessed.forgotten).toEqual([DOCUMENT_NAME]);
    expect(document.getConnections().every((connection) => connection.closed)).toBe(true);
    // The reason has to survive the close on the wire: the browser tells a
    // lifecycle close from a dropped socket on exactly this string, and uses it
    // to offer copy/export of the prompt.
    expect(document.getConnections().map((connection) => connection.lastClose?.reason)).toEqual([
      "coedit:exam_published",
    ]);
  });

  it("closes a replaced room with a reason the browser can act on", async () => {
    const harnessed = await harness();
    const document = harnessed.hocuspocus.add(DOCUMENT_NAME);

    await control(harnessed, CONTROL_PATHS.close, {
      documentNames: [DOCUMENT_NAME],
      reason: "draft_replaced",
    });

    expect(document.getConnections().map((connection) => connection.lastClose)).toEqual([
      { code: 1000, reason: "coedit:draft_replaced" },
    ]);
  });

  it("still releases a room the server never loaded", async () => {
    const harnessed = await harness();
    const response = await control(harnessed, CONTROL_PATHS.close, {
      documentNames: [OTHER_DOCUMENT],
      reason: "question_deleted",
    });
    expect(response.status).toBe(200);
    expect(harnessed.hocuspocus.closedRooms).toContain(OTHER_DOCUMENT);
  });

  it("tolerates an unknown close reason without failing the close", async () => {
    const harnessed = await harness();
    harnessed.hocuspocus.add(DOCUMENT_NAME);
    const response = await control(harnessed, CONTROL_PATHS.close, {
      documentNames: [DOCUMENT_NAME],
      reason: "not-a-real-reason",
    });
    expect(response.status).toBe(200);
    expect(harnessed.controller.isClosed(DOCUMENT_NAME)).toBe(true);
    // The wire vocabulary stays closed even for an unmapped reason.
    expect(
      harnessed.hocuspocus.documents
        .get(DOCUMENT_NAME)
        ?.getConnections()
        .map((connection) => connection.lastClose?.reason),
    ).toEqual(["coedit:other"]);
  });

  it("freezes and flushes every open room for shutdown", async () => {
    const harnessed = await harness();
    const first = harnessed.hocuspocus.add(DOCUMENT_NAME);
    harnessed.hocuspocus.add(OTHER_DOCUMENT);

    harnessed.controller.freezeAllForShutdown();
    const result = await harnessed.controller.flushAllForShutdown();

    expect(result).toEqual({ flushed: 2, failed: 0 });
    expect(harnessed.stores).toEqual([DOCUMENT_NAME, OTHER_DOCUMENT]);
    expect(first.getConnections().every((connection) => connection.readOnly)).toBe(true);
  });
});

describe("unknown routes", () => {
  it("rejects an unsigned GET on an unknown path with a method error", async () => {
    const harnessed = await harness();
    const response = await fetch(`${harnessed.url}/control/unknown`);
    expect(response.status).toBe(405);
  });

  it("rejects an unknown signed control path", async () => {
    const harnessed = await harness();
    const response = await control(harnessed, "/control/unknown", {});
    expect(response.status).toBe(404);
  });
});
