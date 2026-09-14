import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  OutgoingMessage,
  type Connection,
  type Document,
  type Hocuspocus,
} from "@hocuspocus/server";
import { FREEZE_LEASE_SECONDS } from "./config.js";
import { parseAnyDocumentName } from "./documentIdentity.js";
import {
  SERVICE_SIGNATURE_HEADER,
  SERVICE_TIMESTAMP_HEADER,
  TokenError,
  verifyServiceRequest,
} from "./authToken.js";
import type { CoeditPersistence } from "./persistence.js";
import { log, metrics } from "./telemetry.js";

/**
 * Lifecycle control API.
 *
 * Go drives publish/delete/replacement through these calls. Two invariants
 * make the protocol safe:
 *
 *   1. Every call is HMAC-signed over method + path + timestamp + body hash.
 *   2. A freeze returns a LEASE. If Go never unfreezes and never closes, the
 *      lease expires and the rooms unfreeze automatically, so a crashed
 *      publish cannot leave a draft permanently read-only.
 */
export const CONTROL_PATHS = {
  freeze: "/control/freeze",
  unfreeze: "/control/unfreeze",
  flush: "/control/flush",
  close: "/control/close",
  healthz: "/healthz",
  readyz: "/readyz",
  metrics: "/metrics",
} as const;

export interface LifecycleControllerOptions {
  serviceSecret: string;
  hocuspocus: Hocuspocus<CoeditConnectionContext>;
  persistence: CoeditPersistence;
  isReady: () => boolean;
  isShuttingDown: () => boolean;
  allowedOrigin: string;
  now?: () => number;
  /**
   * Freeze lease length. Production uses FREEZE_LEASE_SECONDS; the seam exists
   * so the expiry path is tested without a 30 second wait.
   */
  freezeLeaseSeconds?: number;
}

export interface CoeditConnectionContext {
  actorId?: string;
  displayName?: string;
  documentName?: string;
  organizationId?: string;
  mode?: "write" | "read";
  [key: string]: unknown;
}

interface Lease {
  documentNames: string[];
  timer: ReturnType<typeof setTimeout>;
}

const MAX_CONTROL_BODY_BYTES = 1 << 20;

export class LifecycleController {
  private readonly options: LifecycleControllerOptions;
  private readonly leases = new Map<string, Lease>();
  /** Documents currently frozen; stores are refused while frozen. */
  private readonly frozen = new Set<string>();
  private readonly closed = new Set<string>();

  constructor(options: LifecycleControllerOptions) {
    this.options = options;
  }

  isFrozen(documentName: string): boolean {
    return this.frozen.has(documentName);
  }

  isClosed(documentName: string): boolean {
    return this.closed.has(documentName);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === CONTROL_PATHS.healthz) {
      // Liveness must not claim healthy after lock loss: a process that lost
      // the singleton lock is alive but must be replaced, and an orchestrator
      // that only looks at /healthz would keep it in rotation.
      const healthy = this.options.isReady() || !this.options.isShuttingDown();
      respond(res, healthy ? 200 : 503, { ok: healthy && this.options.isReady() });
      return;
    }
    if (req.method === "GET" && path === CONTROL_PATHS.readyz) {
      const ready = this.options.isReady() && !this.options.isShuttingDown();
      respond(res, ready ? 200 : 503, { ready });
      return;
    }
    if (req.method === "GET" && path === CONTROL_PATHS.metrics) {
      const body = metrics.render();
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(body);
      return;
    }
    if (req.method !== "POST") {
      respond(res, 405, { error: "method_not_allowed" });
      return;
    }

    const body = await readBody(req);
    try {
      verifyServiceRequest({
        secret: this.options.serviceSecret,
        method: "POST",
        path,
        timestamp: headerValue(req, SERVICE_TIMESTAMP_HEADER),
        signature: headerValue(req, SERVICE_SIGNATURE_HEADER),
        body,
        ...(this.options.now ? { now: this.options.now } : {}),
      });
    } catch (error) {
      log("warn", "control call rejected", {
        event: "control_rejected",
        reason: error instanceof TokenError ? "signature" : "unknown",
      });
      respond(res, 403, { error: "signature_invalid" });
      return;
    }

    let parsed: Record<string, unknown> = {};
    if (body.length > 0) {
      try {
        parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      } catch {
        respond(res, 422, { error: "invalid_json" });
        return;
      }
    }

    try {
      switch (path) {
        case CONTROL_PATHS.freeze:
          await this.freeze(parsed, res);
          return;
        case CONTROL_PATHS.unfreeze:
          this.unfreeze(String(parsed["freezeToken"] ?? ""));
          respond(res, 200, { ok: true });
          return;
        case CONTROL_PATHS.flush:
          await this.flush(asStringArray(parsed["documentNames"]), res);
          return;
        case CONTROL_PATHS.close:
          await this.close(parsed, res);
          return;
        default:
          respond(res, 404, { error: "unknown_control_path" });
          return;
      }
    } catch (error) {
      log("error", "control call failed", {
        event: "control_failed",
        reason: "error",
      });
      respond(res, 503, { error: "control_failed", message: (error as Error).message });
    }
  }

  private async freeze(
    payload: Record<string, unknown>,
    res: ServerResponse,
  ): Promise<void> {
    const names = asStringArray(payload["documentNames"]);
    if (names.length === 0) {
      respond(res, 422, { error: "no_documents" });
      return;
    }
    const invalid = names.filter((name) => !parseAnyDocumentName(name));
    if (invalid.length > 0) {
      respond(res, 422, { error: "invalid_document_name" });
      return;
    }
    // 1. Read-only first: a store that lands after this point would be an
    //    edit accepted while the revision is being published.
    for (const name of names) {
      this.broadcastPublishLifecycle(name, "freezing");
      this.frozen.add(name);
      this.setRoomReadOnly(name);
    }
    // 2. Flush every pending store so the manifest describes committed state.
    const manifest = [];
    for (const name of names) {
      await this.flushDocument(name);
      const commit = this.options.persistence.lastCommit(name);
      manifest.push({
        documentName: name,
        stateHash: commit?.stateHash ?? "",
        materializedRevision: commit?.materializedRevision ?? 0,
        questionRevision: commit?.questionRevision ?? 0,
      });
    }
    const freezeToken = randomUUID();
    const timer = setTimeout(() => {
      this.unfreeze(freezeToken);
      metrics.incCounter("authoring_coedit_freeze_total", { outcome: "expired" });
    }, (this.options.freezeLeaseSeconds ?? FREEZE_LEASE_SECONDS) * 1000);
    // Node keeps the process alive on a pending timer by default; this lease
    // must not be the reason a drained process refuses to exit.
    timer.unref?.();
    this.leases.set(freezeToken, { documentNames: names, timer });
    metrics.incCounter("authoring_coedit_freeze_total", { outcome: "accepted" });
    respond(res, 200, { freezeToken, manifest });
  }

  private unfreeze(freezeToken: string): void {
    const lease = this.leases.get(freezeToken);
    if (!lease) return;
    clearTimeout(lease.timer);
    this.leases.delete(freezeToken);
    for (const name of lease.documentNames) {
      if (this.closed.has(name)) continue;
      this.frozen.delete(name);
      this.broadcastPublishLifecycle(name, "active");
      this.setRoomReadOnly(name, false);
    }
    metrics.incCounter("authoring_coedit_freeze_total", { outcome: "accepted" });
  }

  private async flush(names: string[], res: ServerResponse): Promise<void> {
    for (const name of names) {
      await this.flushDocument(name);
    }
    respond(res, 200, { ok: true, flushed: names.length });
  }

  private async close(payload: Record<string, unknown>, res: ServerResponse): Promise<void> {
    const names = asStringArray(payload["documentNames"]);
    const reason = typeof payload["reason"] === "string" ? payload["reason"] : "feature_disabled";
    for (const name of names) {
      this.closed.add(name);
      this.frozen.delete(name);
      // A final store attempt so the last acknowledged state is durable before
      // the sockets drop. A failure here is logged, not fatal: the client
      // still holds its own copy and the row is closed either way.
      try {
        await this.flushDocument(name);
      } catch (error) {
        log("warn", "final flush before close failed", {
          event: "close_flush_failed",
          reason: "unavailable",
        });
      }
      this.closeRoom(name, reason);
      this.options.persistence.forget(name);
      metrics.incCounter("authoring_coedit_lifecycle_close_total", {
        reason: closeReasonLabel(reason),
      });
    }
    respond(res, 200, { ok: true, closed: names.length });
  }

  /**
   * Closes every live connection to a room with a reason the browser can act
   * on.
   *
   * Hocuspocus' bare `closeConnections` closes with its generic "Reset
   * Connection" reason, which a client cannot tell apart from a dead socket.
   * The design requires the browser to offer copy/export of the prompt when a
   * room is closed for a lifecycle reason, so the reason has to survive the
   * wire: it travels as the application close message, prefixed so a lifecycle
   * close can never be confused with a transport close.
   */
  private closeRoom(documentName: string, reason: string): void {
    const document = this.options.hocuspocus.documents.get(documentName);
    const connections = document?.getConnections() ?? [];
    if (connections.length === 0) {
      // Nothing is attached (or the document is unloaded); the server-wide
      // sweep is still the correct way to release anything left behind.
      this.options.hocuspocus.closeConnections(documentName);
      return;
    }
    const event = { code: 1000, reason: lifecycleCloseReason(reason) };
    for (const connection of connections) connection.close(event);
  }

  private setRoomReadOnly(documentName: string, readOnly = true): void {
    const document = this.options.hocuspocus.documents.get(documentName);
    if (!document) return;
    for (const connection of document.getConnections()) {
      (connection as unknown as { readOnly: boolean }).readOnly = readOnly;
      if (!readOnly) this.resyncConnection(document, connection);
    }
  }

  private broadcastPublishLifecycle(
    documentName: string,
    phase: "freezing" | "active",
  ): void {
    const document = this.options.hocuspocus.documents.get(documentName);
    if (!document) return;
    document.broadcastStateless(
      JSON.stringify({
        type: "coedit.lifecycle",
        documentName,
        phase,
        reason: "publish",
      }),
    );
  }

  /**
   * Re-offers the room's state to one connection after it becomes writable
   * again.
   *
   * Why this is required, not a nicety: while frozen, a client's updates are
   * refused by the server, but the client keeps them locally. Every later edit
   * from that client is causally dependent on the refused ones, so the server
   * holds those later updates as pending structs and the room silently stops
   * converging. Sending the server's own sync step makes the client answer with
   * the updates the server lacks, which is exactly the refused state.
   */
  private resyncConnection(document: Document, connection: Connection): void {
    const context = connection.context as { mode?: string } | undefined;
    if (context?.mode === "read") return;
    try {
      const message = new OutgoingMessage(connection.messageAddress)
        .createSyncMessage()
        .writeFirstSyncStepFor(document)
        .toUint8Array();
      connection.send(message);
    } catch {
      // A connection that cannot be re-synced here recovers on its next
      // reconnect, which performs the same handshake.
    }
  }

  /** Forces a store for one room, returning once it has settled. */
  private async flushDocument(documentName: string): Promise<void> {
    const document = this.options.hocuspocus.documents.get(documentName) as
      | (Document & { lastContext?: CoeditConnectionContext })
      | undefined;
    if (!document) return;
    const context = (document as unknown as { lastContext?: CoeditConnectionContext }).lastContext;
    await this.options.persistence.store({
      documentName,
      document: document as unknown as import("yjs").Doc,
      context,
    });
  }

  /** Suspends every open room during shutdown (new edits stop early). */
  freezeAllForShutdown(): void {
    for (const [name] of this.options.hocuspocus.documents) {
      this.frozen.add(name);
      this.setRoomReadOnly(name);
    }
  }

  /** Flushes every open room within the shutdown deadline. */
  async flushAllForShutdown(): Promise<{ flushed: number; failed: number }> {
    let flushed = 0;
    let failed = 0;
    for (const [name] of this.options.hocuspocus.documents) {
      try {
        await this.flushDocument(name);
        flushed += 1;
      } catch {
        failed += 1;
      }
    }
    metrics.incCounter("authoring_coedit_shutdown_flush_total", {
      outcome: failed === 0 ? "accepted" : "rejected",
    });
    return { flushed, failed };
  }

  clearLeases(): void {
    for (const lease of this.leases.values()) {
      clearTimeout(lease.timer);
    }
    this.leases.clear();
  }
}

const CLOSE_REASONS = new Set([
  "question_deleted",
  "draft_replaced",
  "exam_published",
  "workbook_replaced",
  "feature_disabled",
]);

function closeReasonLabel(reason: string): string {
  return CLOSE_REASONS.has(reason) ? reason : "other";
}

/**
 * Prefix of the close reason the service sends when Go deliberately closes a
 * room. The browser treats `coedit:<label>` as a lifecycle signal and anything
 * else as a transport event, so the two can never be confused.
 */
export const LIFECYCLE_CLOSE_REASON_PREFIX = "coedit:";

export function lifecycleCloseReason(reason: string): string {
  return `${LIFECYCLE_CLOSE_REASON_PREFIX}${closeReasonLabel(reason)}`;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) out.push(entry.trim());
  }
  return out;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.byteLength;
    if (total > MAX_CONTROL_BODY_BYTES) {
      throw new Error("control body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
