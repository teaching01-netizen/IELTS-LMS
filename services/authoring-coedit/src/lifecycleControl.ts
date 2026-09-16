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
import type { CoeditLoadMetadata, CoeditPersistence } from "./persistence.js";
import { log, metrics } from "./telemetry.js";
import type {
  CoeditDecimalString,
  CoeditLifecycleOperation,
} from "../../../src/features/exam-authoring/realtime/coedit/protocol.js";

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
  renew: "/control/renew",
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

/** Additive private control contracts shared with the Go coordinator. */
export interface CoeditFreezeRequest extends Partial<CoeditLifecycleOperation> {
  documentNames: string[];
  draftVersionId?: string;
  reason: string;
}

export interface CoeditFreezeManifestEntry {
  documentName: string;
  stateHash: string;
  materializedRevision: number;
  questionRevision: number;
  stateEpoch?: CoeditDecimalString;
  commitSequence?: CoeditDecimalString;
  workspaceRevision?: number;
}

export interface CoeditFreezeResponse extends Partial<CoeditLifecycleOperation> {
  freezeToken: string;
  manifest: CoeditFreezeManifestEntry[];
}

export interface CoeditUnfreezeRequest {
  freezeToken: string;
  freezeOperationId?: string;
}

export interface CoeditFlushRequest {
  documentNames: string[];
  freezeOperationId?: string;
}

export interface CoeditCloseRequest {
  documentNames: string[];
  reason: string;
  freezeOperationId?: string;
}

interface Lease {
  documentNames: string[];
  timer: ReturnType<typeof setTimeout>;
  operationId: string;
  expiresAt: number;
}

interface DurableLifecycle {
  state: string;
  freezeOperationId?: string;
  freezeExpiresAt?: number;
}

const MAX_CONTROL_BODY_BYTES = 1 << 20;

export class LifecycleController {
  private readonly options: LifecycleControllerOptions;
  private readonly leases = new Map<string, Lease>();
  /** Documents currently frozen; stores are refused while frozen. */
  private readonly frozen = new Set<string>();
  private readonly closed = new Set<string>();
  private readonly durable = new Map<string, DurableLifecycle>();
  /** At most one asynchronous lifecycle operation may own a room at a time. */
  private readonly roomOperations = new Map<string, string>();

  constructor(options: LifecycleControllerOptions) {
    this.options = options;
  }

  isFrozen(documentName: string): boolean {
    const durable = this.durable.get(documentName)?.state;
    return this.frozen.has(documentName) || durable === "freezing" || durable === "frozen";
  }

  isClosed(documentName: string): boolean {
    return this.closed.has(documentName) || this.durable.get(documentName)?.state === "closed";
  }

  /** Effective write permission across durable and in-memory lifecycle state. */
  isReadOnly(documentName: string): boolean {
    return this.isClosed(documentName) || this.isFrozen(documentName);
  }

  /** Hydrates the row state returned by a Go load or durable refresh. */
  hydrateDurableState(documentName: string, metadata: CoeditLoadMetadata): void {
    this.durable.set(documentName, {
      state: metadata.lifecycleState,
      ...(metadata.freezeOperationId === undefined ? {} : { freezeOperationId: metadata.freezeOperationId }),
      ...(metadata.freezeExpiresAt === undefined ? {} : { freezeExpiresAt: metadata.freezeExpiresAt }),
    });
  }

  private setDurableState(
    documentName: string,
    state: string,
    operationId?: string,
    expiresAt?: number,
  ): void {
    this.durable.set(documentName, {
      state,
      ...(operationId === undefined ? {} : { freezeOperationId: operationId }),
      ...(expiresAt === undefined ? {} : { freezeExpiresAt: expiresAt }),
    });
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

    let body: Buffer;
    try {
      body = await readBody(req);
    } catch (error) {
      if (error instanceof Error && error.message === "control body too large") {
        respond(res, 413, { error: "body_too_large" });
        return;
      }
      throw error;
    }
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
          if (!this.unfreeze(String(parsed["freezeToken"] ?? ""), optionalString(parsed["freezeOperationId"]))) {
            respond(res, 409, { error: "freeze_owner_mismatch" });
            return;
          }
          respond(res, 200, { ok: true });
          return;
        case CONTROL_PATHS.renew:
          this.renew(parsed, res);
          return;
        case CONTROL_PATHS.flush:
          await this.flush(
            asStringArray(parsed["documentNames"]),
            optionalString(parsed["freezeOperationId"]),
            res,
          );
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
    const names = uniqueNames(asStringArray(payload["documentNames"]));
    if (names.length === 0) {
      respond(res, 422, { error: "no_documents" });
      return;
    }
    const invalid = names.filter((name) => !parseAnyDocumentName(name));
    if (invalid.length > 0) {
      respond(res, 422, { error: "invalid_document_name" });
      return;
    }
    if (!this.beginRoomOperation(names, "freeze")) {
      respond(res, 409, { error: "freeze_conflict" });
      return;
    }
    try {
      await this.freezeLocked(names, payload, res);
    } finally {
      this.endRoomOperation(names, "freeze");
    }
  }

  private async freezeLocked(
    names: string[],
    payload: Record<string, unknown>,
    res: ServerResponse,
  ): Promise<void> {
    if (names.some((name) => this.isFrozen(name) || this.leaseFor(name) !== undefined)) {
      respond(res, 409, { error: "freeze_conflict" });
      return;
    }
    // 1. Read-only first: a store that lands after this point would be an
    //    edit accepted while the revision is being published.
    const operationId = optionalString(payload["freezeOperationId"]) ?? "";
    for (const name of names) {
      this.broadcastPublishLifecycle(name, "freezing");
      this.frozen.add(name);
      this.setDurableState(name, "freezing", operationId || undefined);
      this.setRoomReadOnly(name);
    }
    // 2. Flush every pending store so the manifest describes committed state.
    // Go has already durably fenced these rows, so operation-owned calls must
    // use final-store rather than ordinary store.
    const requestedExpiry = positiveInteger(payload["freezeExpiresAt"]);
    const manifest = [];
    try {
      for (const name of names) {
        await this.flushDocument(name, operationId || undefined);
        const commit = this.options.persistence.lastCommit(name);
        manifest.push({
          documentName: name,
          stateHash: commit?.stateHash ?? "",
          materializedRevision: commit?.materializedRevision ?? 0,
          questionRevision: commit?.questionRevision ?? 0,
          ...(commit?.stateEpoch === undefined ? {} : { stateEpoch: commit.stateEpoch }),
          ...(commit?.commitSequence === undefined ? {} : { commitSequence: commit.commitSequence }),
          ...(commit?.workspaceRevision === undefined ? {} : { workspaceRevision: commit.workspaceRevision }),
        });
      }
    } catch (error) {
      this.rollbackFrozen(names);
      throw error;
    }
    const freezeToken = randomUUID();
    const expiresAt = requestedExpiry ?? this.nowSeconds() + (this.options.freezeLeaseSeconds ?? FREEZE_LEASE_SECONDS);
    const timer = this.scheduleLease(freezeToken, operationId, expiresAt);
    this.leases.set(freezeToken, { documentNames: names, timer, operationId, expiresAt });
    for (const name of names) this.setDurableState(name, "frozen", operationId || undefined, expiresAt);
    metrics.incCounter("authoring_coedit_freeze_total", { outcome: "accepted" });
    respond(res, 200, {
      freezeToken,
      manifest,
      ...(operationId ? { freezeOperationId: operationId } : {}),
      ...(requestedExpiry === undefined ? {} : { freezeExpiresAt: expiresAt }),
    });
  }

  private unfreeze(freezeToken: string, operationId?: string): boolean {
    const lease = this.leases.get(freezeToken);
    if (!lease) return true;
    if (lease.operationId !== (operationId ?? "")) return false;
    clearTimeout(lease.timer);
    this.leases.delete(freezeToken);
    for (const name of lease.documentNames) {
      if (this.closed.has(name)) continue;
      this.frozen.delete(name);
      this.setDurableState(name, "active");
      this.broadcastPublishLifecycle(name, "active");
      this.setRoomReadOnly(name, false);
    }
    metrics.incCounter("authoring_coedit_freeze_total", { outcome: "accepted" });
    return true;
  }

  private renew(payload: Record<string, unknown>, res: ServerResponse): void {
    const freezeToken = optionalString(payload["freezeToken"]);
    const lease = freezeToken ? this.leases.get(freezeToken) : undefined;
    if (!freezeToken || !lease) {
      respond(res, 409, { error: "freeze_not_found" });
      return;
    }
    const operationId = optionalString(payload["freezeOperationId"]);
    if (lease.operationId !== (operationId ?? "")) {
      respond(res, 409, { error: "freeze_owner_mismatch" });
      return;
    }
    const expiresAt = positiveInteger(payload["freezeExpiresAt"]);
    const nextExpiresAt = expiresAt ?? this.nowSeconds() + (this.options.freezeLeaseSeconds ?? FREEZE_LEASE_SECONDS);
    if (nextExpiresAt <= this.nowSeconds()) {
      respond(res, 422, { error: "freeze_expired" });
      return;
    }
    clearTimeout(lease.timer);
    lease.expiresAt = Math.max(lease.expiresAt, nextExpiresAt);
    lease.timer = this.scheduleLease(freezeToken, lease.operationId, lease.expiresAt);
    respond(res, 200, {
      ok: true,
      ...(lease.operationId ? { freezeOperationId: lease.operationId } : {}),
      freezeExpiresAt: lease.expiresAt,
    });
  }

  private async flush(names: string[], operationId: string | undefined, res: ServerResponse): Promise<void> {
    const unique = uniqueNames(names);
    if (unique.length === 0) {
      respond(res, 422, { error: "no_documents" });
      return;
    }
    if (!this.beginRoomOperation(unique, "flush")) {
      respond(res, 409, { error: "room_operation_conflict" });
      return;
    }
    try {
      for (const name of unique) {
        await this.flushDocument(name, operationId);
      }
      respond(res, 200, { ok: true, flushed: unique.length });
    } finally {
      this.endRoomOperation(unique, "flush");
    }
  }

  private async close(payload: Record<string, unknown>, res: ServerResponse): Promise<void> {
    const names = uniqueNames(asStringArray(payload["documentNames"]));
    const reason = typeof payload["reason"] === "string" ? payload["reason"] : "feature_disabled";
    const operationId = optionalString(payload["freezeOperationId"]);
    if (names.length === 0) {
      respond(res, 422, { error: "no_documents" });
      return;
    }
    if (!this.beginRoomOperation(names, "close")) {
      respond(res, 409, { error: "room_operation_conflict" });
      return;
    }
    try {
      await this.closeLocked(names, reason, operationId, res);
    } finally {
      this.endRoomOperation(names, "close");
    }
  }

  private async closeLocked(
    names: string[],
    reason: string,
    operationId: string | undefined,
    res: ServerResponse,
  ): Promise<void> {
    if (names.some((name) => {
      const lease = this.leaseFor(name);
      return lease !== undefined && lease.operationId !== (operationId ?? "");
    })) {
      respond(res, 409, { error: "freeze_owner_mismatch" });
      return;
    }
    for (const name of names) {
      // Stop new writes while the final flush is in flight, but do not mark
      // the durable service state closed until that flush has had its chance.
      this.frozen.add(name);
      this.setDurableState(name, "freezing", operationId);
      this.setRoomReadOnly(name);
      // A final store attempt so the last acknowledged state is durable before
      // the sockets drop. A failure here is logged, not fatal: the client
      // still holds its own copy and the row is closed either way.
      try {
        await this.flushDocument(name, operationId);
      } catch (error) {
        log("warn", "final flush before close failed", {
          event: "close_flush_failed",
          reason: "unavailable",
        });
      }
      this.closed.add(name);
      this.setDurableState(name, "closed");
      this.releaseLease(name, operationId);
      this.frozen.delete(name);
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
   * room is closed for a lifecycle reason ("Offline and recovery behavior",
   * docs/sat-authoring-coedit.md), so the reason has to survive the
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
      const context = connection.context as CoeditConnectionContext | undefined;
      const effectiveReadOnly = readOnly || context?.mode === "read" || this.isReadOnly(documentName);
      (connection as unknown as { readOnly: boolean }).readOnly = effectiveReadOnly;
      if (!effectiveReadOnly) this.resyncConnection(document, connection);
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
  private async flushDocument(documentName: string, freezeOperationId?: string): Promise<void> {
    const document = this.options.hocuspocus.documents.get(documentName) as
      | (Document & { lastContext?: CoeditConnectionContext })
      | undefined;
    if (!document) {
      const metadata = await this.options.persistence.refreshCommit(documentName);
      if (metadata) this.hydrateDurableState(documentName, metadata);
      return;
    }
    const context = (document as unknown as { lastContext?: CoeditConnectionContext }).lastContext;
    const input = {
      documentName,
      document: document as unknown as import("yjs").Doc,
      context,
    };
    if (freezeOperationId) {
      await this.options.persistence.finalStore(input, freezeOperationId);
      return;
    }
    await this.options.persistence.store(input);
  }

  private rollbackFrozen(documentNames: string[]): void {
    for (const name of documentNames) {
      if (this.closed.has(name)) continue;
      this.frozen.delete(name);
      this.setDurableState(name, "active");
      this.broadcastPublishLifecycle(name, "active");
      this.setRoomReadOnly(name, false);
    }
  }

  private beginRoomOperation(documentNames: string[], operation: string): boolean {
    if (documentNames.some((name) => this.roomOperations.has(name))) return false;
    for (const name of documentNames) this.roomOperations.set(name, operation);
    return true;
  }

  private endRoomOperation(documentNames: string[], operation: string): void {
    for (const name of documentNames) {
      if (this.roomOperations.get(name) === operation) this.roomOperations.delete(name);
    }
  }

  private leaseFor(documentName: string): Lease | undefined {
    for (const lease of this.leases.values()) {
      if (lease.documentNames.includes(documentName)) return lease;
    }
    return undefined;
  }

  private releaseLease(documentName: string, operationId?: string): void {
    for (const [freezeToken, lease] of this.leases) {
      if (lease.operationId !== (operationId ?? "") || !lease.documentNames.includes(documentName)) continue;
      clearTimeout(lease.timer);
      this.leases.delete(freezeToken);
    }
  }

  private scheduleLease(
    freezeToken: string,
    operationId: string,
    expiresAt: number,
  ): ReturnType<typeof setTimeout> {
    const delay = Math.max(1, expiresAt * 1000 - (this.options.now?.() ?? Date.now()));
    const timer = setTimeout(() => {
      this.unfreeze(freezeToken, operationId || undefined);
      metrics.incCounter("authoring_coedit_freeze_total", { outcome: "expired" });
    }, delay);
    timer.unref?.();
    return timer;
  }

  private nowSeconds(): number {
    return Math.floor((this.options.now?.() ?? Date.now()) / 1000);
  }

  /** Suspends every open room during shutdown (new edits stop early). */
  freezeAllForShutdown(): void {
    for (const [name] of this.options.hocuspocus.documents) {
      this.frozen.add(name);
      this.setDurableState(name, "freezing");
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

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
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
