import type { IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { SkipFurtherHooksError } from "@hocuspocus/common";
import {
  OutgoingMessage,
  Server,
  type Connection,
  type Extension,
  type onAuthenticatePayload,
  type onConnectPayload,
  type onDisconnectPayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
  type onTokenSyncPayload,
} from "@hocuspocus/server";
import { prosemirrorJSONToYXmlFragment } from "y-prosemirror";
import * as Y from "yjs";
import { authorizeDocument, TokenError, verifyToken, type TokenClaims } from "./authToken.js";
import { ConfigError, loadConfig, singletonLockName, type CoeditServiceConfig } from "./config.js";
import { FIELD_SET_WORKSPACE, MAX_FRAME_BYTES, parseAnyDocumentName } from "./documentIdentity.js";
import {
  COEDIT_OVERSIZED_REASON,
  encodeStateAsUpdate,
  promptSchema,
  RICH_ROOT_PREFIX,
} from "./documentCodec.js";
import { GoAuthoringClient, GoRequestError } from "./goAuthoringClient.js";
import {
  CONTROL_PATHS,
  LifecycleController,
  type CoeditConnectionContext,
} from "./lifecycleControl.js";
import { CoeditPersistence, type CoeditLoadMetadata, type StoreHookInput } from "./persistence.js";
import { SingletonLock } from "./singletonLock.js";
import { log, metrics } from "./telemetry.js";
import { documentFromStructuredContent } from "./richTextSchema.js";
// The command-envelope vocabulary, builder, and validator are shared with the
// browser package so the two halves of the relay cannot disagree about what a
// command is. The service imports the browser module the same way it already
// imports the browser's rich-text schema.
import { parseSatWorkspaceCommand } from "../../../src/features/exam-authoring/realtime/coedit/workspaceCommands.js";
import { parseCoeditStoreRequest } from "../../../src/features/exam-authoring/realtime/coedit/storeRequest.js";
import {
  createWorkspaceSeedResultFrame,
  parseWorkspaceSeedFrame,
  type WorkspaceSeedFrame,
  type WorkspaceSeedOutcome,
} from "../../../src/features/exam-authoring/realtime/coedit/workspaceSeed.js";

/**
 * Co-edit service process.
 *
 * The server is one singleton process, so the whole lifecycle is written to
 * fail closed: readiness is false until the environment lock is held, lock
 * loss closes every room and exits, and shutdown refuses to claim success when
 * the flush deadline expires.
 */
export const CONTROL_REQUEST_TIMEOUT_MS = 15_000;
/** Bounds on the durable-seed ledger: ids only, never content. */
export const MAX_APPLIED_SEEDS_PER_ROOM = 512;
export const MAX_SEED_LEDGER_ROOMS = 128;
export const MAX_UNAUTHENTICATED_QUEUE_BYTES = MAX_FRAME_BYTES * 4;
export const TOKEN_REFRESH_INTERVAL_MS = 60_000;

/**
 * Refusal reason sent when the room refused a write outright rather than
 * failing to persist it (see the `beforeSync` hook below). Mirrored by the
 * browser package's contracts: the wire string is the shared vocabulary, so
 * neither side may invent its own.
 */
export const COEDIT_WRITE_REFUSED_REASON = "coedit_write_refused";

export {
  /**
   * Re-exported so the store path and the browser share one string for the
   * size refusal; `CodecError.reason` carries it onto the wire.
   */
  COEDIT_OVERSIZED_REASON,
};

/**
 * y-protocols/sync message types that carry client CONTENT (y-protocols@1.0.7:
 * 0 = sync step 1, 1 = sync step 2, 2 = update). Step 1 carries only a state
 * vector, so refusing it would announce a refusal that did not happen.
 */
const SYNC_STEP_TWO = 1;
const SYNC_UPDATE = 2;

/** A refusal the author must be told about, in the existing failure frame. */
interface CoeditRefusalFrame {
  type: "coedit.save_failed";
  documentName: string;
  retryable: boolean;
  reason: string | null;
  requiresResync: boolean;
}
const STATE_SIZE_BUCKETS = [4 << 10, 16 << 10, 64 << 10, 256 << 10, 1 << 20, 2 << 20, 4 << 20];
const RETRYABLE_CLOSE = { code: 1012, reason: "coedit_service_restart" };
const PERMISSION_DENIED = { code: 4403, reason: "permission-denied" };

export const CONTROL_REQUEST_PATHS = new Set<string>([
  CONTROL_PATHS.healthz,
  CONTROL_PATHS.readyz,
  CONTROL_PATHS.metrics,
  CONTROL_PATHS.freeze,
  CONTROL_PATHS.unfreeze,
  CONTROL_PATHS.renew,
  CONTROL_PATHS.flush,
  CONTROL_PATHS.close,
]);

/**
 * Backoff ladder for a store that failed for a TRANSIENT reason.
 *
 * The only failures retried here are the ones where the backend was briefly
 * away — Go answered 5xx, or could not be reached at all (`GoRequestError`
 * marks exactly those retryable). A REFUSED write is never retried: a fenced
 * hash, a revision conflict, a freeze, a closed room, and an oversized document
 * cannot be satisfied by trying again, and looping against one is what leaves an
 * author watching a save that never completes. Those keep the recovery path
 * they already have (the refusal frame, and the editor's export/review offer).
 *
 * Bounded on purpose: three attempts over ~13s covers the window a deploy, a
 * restart, or a dropped connection occupies, and then the editor's own Retry and
 * the recovery copy are the way forward. Each attempt re-projects the live
 * document, so a success on any rung commits the newest state, not the state
 * that happened to be there when the first attempt failed.
 */
export const STORE_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 9_000];

export interface CoeditServiceDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Overridable so tests can exercise contention and lock loss without MySQL. */
  lock?: LockLike;
  /**
   * Retry ladder for a transiently failed store. Injected so a test can prove
   * the retry happens without waiting out the production backoff; the default is
   * the shipped ladder above.
   */
  storeRetryDelaysMs?: readonly number[];
}

export interface LockLike {
  isReady(): boolean;
  acquire(): Promise<void>;
  release(): Promise<void>;
  /** The service assigns this so lock loss is always routed to one handler. */
  onLost(reason: string): void;
}

/**
 * The addressable service object.
 *
 * `start()` is the only method that binds a port, and it never binds before the
 * singleton lock is held — a process that cannot own the lock must not accept a
 * single socket, or two processes would serve the same rooms.
 */
export class CoeditService {
  readonly config: CoeditServiceConfig;
  readonly server: Server<CoeditConnectionContext>;
  readonly persistence: CoeditPersistence;
  readonly lifecycle: LifecycleController;
  private readonly lock: LockLike;
  private readonly go: GoAuthoringClient;
  private readonly now: () => number;
  private shuttingDown = false;
  private listening = false;
  private lockLost = false;
  /**
   * Connections awaiting an answer to a token refresh, keyed by document and
   * socket.
   *
   * Membership IS the deadline: a key that is still present at the next tick
   * means that connection ignored the previous request. A stored timestamp
   * was carried here before and never read — the interval already is the
   * deadline, so a second clock could only drift from it.
   */
  private readonly pendingTokenSync = new Set<string>();
  private readonly seedOperations = new Map<string, Promise<void>>();
  /**
   * Seed ids whose proposal became durable content, keyed by document name.
   *
   * This is what makes a duplicate seed request idempotent instead of a second
   * arbitration: the id is the deterministic fingerprint of the proposal, so a
   * retry of the exact same frame is recognizable. Recorded only AFTER the
   * store succeeds — an applied-then-unpersisted proposal must be allowed to
   * apply again if the room reloads without it.
   */
  private readonly appliedSeeds = new Map<string, Set<string>>();
  /**
   * One pending store retry per room, with the rung it is on.
   *
   * Keyed by room so a room can never accumulate timers: a new failure replaces
   * the pending attempt (and advances the ladder) instead of adding a second
   * one, which is what keeps a failing backend from being hammered by an
   * unbounded number of retries for the same rooms.
   */
  private readonly storeRetries = new Map<
    string,
    { attempts: number; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly storeRetryDelays: readonly number[];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CoeditServiceConfig, deps: CoeditServiceDeps = {}) {
    this.config = config;
    this.now = deps.now ?? (() => Date.now());
    this.storeRetryDelays = deps.storeRetryDelaysMs ?? STORE_RETRY_DELAYS_MS;
    this.go = new GoAuthoringClient({
      baseUrl: config.goBaseUrl,
      serviceSecret: config.serviceSecret,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      now: this.now,
    });
    this.lock =
      deps.lock ??
      new SingletonLock({
        dsn: config.mysqlDsn,
        lockName: singletonLockName(config.environment),
        lockTimeoutSeconds: config.lockTimeoutSeconds,
      });
    // Lock loss is fatal and must be handled exactly once, wherever the lock
    // implementation reports it from.
    this.lock.onLost = (reason) => this.onLockLost(reason);
    this.persistence = new CoeditPersistence(this.go);
    this.server = new Server<CoeditConnectionContext>({
      name: "authoring-coedit",
      port: config.port,
      address: config.host,
      quiet: true,
      // Signals are handled here so shutdown can drain instead of exiting at
      // the first SIGTERM with rooms still writable.
      stopOnSignals: false,
      debounce: 250,
      maxDebounce: 1000,
      // Durability beats a warm in-memory cache: a disconnect stores and
      // unloads, so a room is never lost to an eviction policy.
      unloadImmediately: true,
      maxUnauthenticatedQueueSize: MAX_UNAUTHENTICATED_QUEUE_BYTES,
      websocketOptions: { maxPayload: MAX_FRAME_BYTES },
      extensions: [this.hooks()],
    });    this.lifecycle = new LifecycleController({
      serviceSecret: config.serviceSecret,
      hocuspocus: this.server.hocuspocus,
      persistence: this.persistence,
      isReady: () => this.isReady(),
      isShuttingDown: () => this.shuttingDown,
      allowedOrigin: config.allowedOrigin,
      now: this.now,
    });
    this.persistence.setBroadcaster((documentName, payload) => {
      this.server.hocuspocus.documents.get(documentName)?.broadcastStateless(payload);
    });
    this.installControlRouter();
  }

  isReady(): boolean {
    return this.listening && !this.shuttingDown && !this.lockLost && this.lock.isReady();
  }

  /** Acquires the singleton lock, then binds the port. Throws on lock contention. */
  async start(): Promise<void> {
    await this.lock.acquire();
    await this.server.listen();
    this.listening = true;
    this.refreshTimer = setInterval(() => this.requestTokenRefreshes(), TOKEN_REFRESH_INTERVAL_MS);
    this.refreshTimer.unref?.();
    log("info", "authoring-coedit listening", {
      event: "listen",
      port: this.config.port,
      environment: this.config.environment,
    });
  }

  /**
   * Graceful shutdown: readiness false, no new sockets, rooms read-only,
   * pending stores flushed, sockets closed with a retryable reason, lock
   * released. A deadline breach exits non-zero rather than claiming the flush
   * completed.
   */
  async stop(): Promise<"clean" | "timeout"> {
    if (this.shuttingDown) return "clean";
    this.shuttingDown = true;
    // Pending retries belong to a process that is leaving: the flush below is
    // the last store this process attempts.
    this.clearStoreRetries();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.lifecycle.clearLeases();
    const deadline = new Promise<"timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), this.config.shutdownTimeoutMs);
      timer.unref?.();
    });
    const drain = (async (): Promise<"clean"> => {
      // 1. Stop accepting new connections. The callback only settles once every
      //    open socket is gone, so the promise is created here and awaited after
      //    the rooms are closed below (awaiting it now would deadlock against
      //    the live WebSockets).
      const listenerClosed = new Promise<void>((resolve) => {
        this.server.httpServer.close(() => resolve());
      });
      // 2. Freeze first so an edit that races the flush is refused, not lost.
      this.lifecycle.freezeAllForShutdown();
      const flushed = await this.lifecycle.flushAllForShutdown();
      log("info", "authoring-coedit shutdown flush", {
        event: "shutdown",
        stage: "flush",
        outcome: flushed.failed === 0 ? "accepted" : "rejected",
        count: flushed.flushed,
      });
      // 3. Close sockets with a retryable reason: clients keep local state and
      //    reconnect once the replacement process owns the lock.
      for (const [name, document] of this.server.hocuspocus.documents) {
        for (const connection of document.getConnections()) {
          connection.close(RETRYABLE_CLOSE);
        }
        this.persistence.forget(name);
      }
      // A provider that has been told to reconnect keeps its TCP connection
      // open until it decides to reconnect, and httpServer.close() waits for
      // every socket. Force the sockets down so shutdown stays inside its
      // deadline instead of relying on client cooperation.
      this.server.httpServer.closeIdleConnections();
      this.server.httpServer.closeAllConnections();
      await Promise.race([listenerClosed, sleep(250)]);
      // destroy() waits for Hocuspocus to unload every document, which happens
      // on socket-close. State is already flushed and every room already
      // closed, so the wait is bounded rather than trusted.
      await Promise.race([this.server.destroy().catch(() => undefined), sleep(1_000)]);
      await this.lock.release().catch(() => undefined);
      this.listening = false;
      this.refreshGauges();
      return "clean";
    })();
    const outcome = await Promise.race([drain, deadline]);
    if (outcome === "timeout") {
      // The stores themselves are counted by flushAllForShutdown (the store
      // dimension). This increment is the deadline dimension, so it is the
      // only one that may be added here: counting `accepted` unconditionally
      // after this branch reported a breach made every timed-out shutdown
      // report success as well as failure.
      metrics.incCounter("authoring_coedit_shutdown_flush_total", { outcome: "rejected" });
      log("error", "authoring-coedit shutdown deadline exceeded", {
        event: "shutdown",
        stage: "flush",
        outcome: "rejected",
      });
    }
    return outcome;
  }

  /** Lock loss is fatal: a live process without the lock would serve split rooms. */
  private onLockLost(reason: string): void {
    if (this.lockLost) return;
    this.lockLost = true;
    this.clearStoreRetries();
    log("error", "authoring-coedit lost the singleton lock", {
      event: "singleton_lock_lost",
      reason,
    });
    for (const document of this.server.hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        connection.close(RETRYABLE_CLOSE);
      }
    }
    void this.stop().finally(() => process.exit(1));
  }

  /**
   * Hocuspocus does not ask clients to prove their token is still valid, so
   * this process does. A connection that fails to answer a refresh — or answers
   * with a token for a different document — is closed rather than trusted.
   */
  requestTokenRefreshes(): void {
    for (const [documentName, document] of this.server.hocuspocus.documents) {
      for (const connection of document.getConnections()) {
        const key = refreshKey(documentName, connection.socketId);
        if (this.pendingTokenSync.has(key)) {
          log("warn", "co-edit token refresh missing", {
            event: "token_refresh",
            outcome: "expired",
            stage: "close",
          });
          this.pendingTokenSync.delete(key);
          connection.close({ code: 4401, reason: "token-refresh-missing" });
          continue;
        }
        this.pendingTokenSync.add(key);
        connection.requestToken();
      }
    }
  }

  private installControlRouter(): void {
    const httpServer = this.server.httpServer;
    // Hocuspocus owns the `request` listener for its start screen. Control and
    // health paths must be answered by this service instead, so the single
    // listener is replaced with a router that delegates everything else back.
    httpServer.removeAllListeners("request");
    httpServer.on("request", (request: IncomingMessage, response) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (CONTROL_REQUEST_PATHS.has(path)) {
        void this.lifecycle.handle(request, response).catch((error: Error) => {
          log("error", "control request failed", { event: "control_failed", stage: "other" });
          if (!response.headersSent) {
            response.writeHead(503, { "content-type": "application/json" });
          }
          response.end(JSON.stringify({ error: "control_failed", message: error.message }));
        });
        return;
      }
      void this.server.requestHandler(request, response);
    });
  }

  private refreshGauges(): void {
    metrics.setGauge(
      "authoring_coedit_connections_current",
      this.server.hocuspocus.getConnectionsCount(),
    );
    metrics.setGauge(
      "authoring_coedit_documents_current",
      this.server.hocuspocus.getDocumentsCount(),
    );
  }

  private hooks(): Extension<CoeditConnectionContext> {
    return {
      onAuthenticate: async ({
        token,
        documentName,
        connectionConfig,
        context,
        requestHeaders,
      }: onAuthenticatePayload<CoeditConnectionContext>) => {
        this.assertOrigin(requestHeaders);
        let claims: TokenClaims;
        try {
          claims = verifyToken(token, { tokenSecret: this.config.tokenSecret, now: this.now });
          authorizeDocument(documentName, claims);
        } catch (error) {
          metrics.incCounter("authoring_coedit_auth_total", { outcome: "rejected" });
          log("warn", "co-edit authentication rejected", {
            event: "auth",
            outcome: "rejected",
            reason: error instanceof TokenError ? "signature" : "other",
          });
          throw permissionDenied(error);
        }
        const name = claims.documentName;
        let durable: CoeditLoadMetadata;
        try {
          durable = await this.persistence.preloadLifecycle(name);
          this.lifecycle.hydrateDurableState(name, durable);
        } catch (error) {
          metrics.incCounter("authoring_coedit_auth_total", { outcome: "unavailable" });
          throw permissionDenied(error);
        }
        if (this.lifecycle.isClosed(name) || durable.lifecycleState === "closed") {
          metrics.incCounter("authoring_coedit_auth_total", { outcome: "closed" });
          throw permissionDenied(new TokenError("Co-edit document is closed."));
        }
        if (claims.mode === "write" && this.lifecycle.isReadOnly(name)) {
          metrics.incCounter("authoring_coedit_auth_total", { outcome: "frozen" });
          throw permissionDenied(new TokenError("Co-edit document is read-only during its lifecycle transition."));
        }
        if (this.server.hocuspocus.documents.has(name)) this.persistence.discardPreloaded(name);
        // Only server-signed identity reaches the connection context. A client
        // cannot nominate its own name, actor id, mode, or document.
        context.actorId = claims.actorId;
        context.displayName = claims.displayName;
        context.documentName = name;
        context.mode = claims.mode;
        context.organizationId = claims.organizationId ?? "";
        context["fieldSet"] = claims.fieldSet ?? parseAnyDocumentName(name)?.fieldSet ?? "prompt";
        // Mutating connectionConfig is what Hocuspocus reads when it builds the
        // connection, so a read token is genuinely read-only below the hooks.
        connectionConfig.readOnly = claims.mode === "read" || this.lifecycle.isReadOnly(name);
        metrics.incCounter("authoring_coedit_auth_total", {
          outcome: "accepted",
          mode: claims.mode,
        });
        this.refreshGauges();
      },

      onTokenSync: async ({
        token,
        documentName,
        connection,
        connectionConfig,
        context,
      }: onTokenSyncPayload<CoeditConnectionContext>) => {
        const key = refreshKey(documentName, connection.socketId);
        this.pendingTokenSync.delete(key);
        let claims: TokenClaims;
        try {
          claims = verifyToken(token, { tokenSecret: this.config.tokenSecret, now: this.now });
          authorizeDocument(documentName, claims);
        } catch (error) {
          log("warn", "co-edit token refresh rejected", {
            event: "token_refresh",
            outcome: "rejected",
            reason: "signature",
          });
          throw permissionDenied(error);
        }
        if (claims.mode !== context.mode || claims.actorId !== context.actorId) {
          throw permissionDenied(new TokenError("Co-edit token refresh changed identity."));
        }
        let durable: CoeditLoadMetadata;
        try {
          durable = await this.persistence.preloadLifecycle(documentName);
          this.lifecycle.hydrateDurableState(documentName, durable);
        } catch (error) {
          throw permissionDenied(error);
        } finally {
          if (this.server.hocuspocus.documents.has(documentName)) this.persistence.discardPreloaded(documentName);
        }
        if (this.lifecycle.isClosed(documentName) || durable.lifecycleState === "closed") {
          throw permissionDenied(new TokenError("Co-edit document is closed."));
        }
        if (claims.mode === "write" && this.lifecycle.isReadOnly(documentName)) {
          throw permissionDenied(new TokenError("Co-edit document is read-only during its lifecycle transition."));
        }
        connectionConfig.readOnly = claims.mode === "read" || this.lifecycle.isReadOnly(documentName);
        connection.readOnly = connectionConfig.readOnly;
        context.displayName = claims.displayName;
      },

      onConnect: async ({ requestHeaders }: onConnectPayload<CoeditConnectionContext>) => {
        this.assertOrigin(requestHeaders);
        metrics.incCounter("authoring_coedit_reconnect_total", { outcome: "accepted" });
        this.refreshGauges();
      },

      connected: async ({ documentName, connection }) => {
        // Loading an already committed document (including the first seed) is
        // itself durable. Send that exact state to the new connection so the
        // browser can render Saved without waiting for an unrelated edit to
        // trigger the first store acknowledgement.
        //
        const commit = this.persistence.lastCommit(documentName);
        if (!commit) return;
        connection.send(
          new OutgoingMessage(connection.messageAddress)
            .writeStateless(
              JSON.stringify({
                type: "coedit.ack",
                documentName,
                stateVector: commit.stateVector,
                stateHash: commit.stateHash,
                questionRevision: commit.questionRevision,
                materializedRevision: commit.materializedRevision,
                ...(commit.stateEpoch === undefined ? {} : { stateEpoch: commit.stateEpoch }),
                ...(commit.commitSequence === undefined ? {} : { commitSequence: commit.commitSequence }),
                ...(commit.workspaceRevision === undefined ? {} : { workspaceRevision: commit.workspaceRevision }),
              }),
            )
            .toUint8Array(),
        );
      },

      /**
       * Structural mutations remain authoritative HTTP commands. This relay
       * only fans out the already-applied result to peers in the same exam
       * workspace, so other open pages can invalidate without reloading.
       */
      onStateless: async ({ documentName, document, connection, payload }) => {
        // A durable-store request is meaningful in every room type, so it is
        // handled before the workspace-only frames below.
        if (parseCoeditStoreRequest(payload, { documentName })) {
          await this.storeOnRequest(documentName, document, connection);
          return;
        }
        if (parseAnyDocumentName(documentName)?.fieldSet !== FIELD_SET_WORKSPACE) return;
        const seed = parseWorkspaceSeedFrame(payload, { documentName });
        if (seed) {
          if (!this.maySeed(documentName, connection)) {
            metrics.incCounter("authoring_coedit_seed_total", { outcome: "rejected" });
            log("warn", "co-edit workspace seed refused", {
              event: "seed",
              outcome: "rejected",
              stage: "store",
              reason: "other",
            });
            // A refusal the browser must be able to stop waiting on: the root
            // will never appear, so the field is told now instead of pulsing.
            this.sendSeedResult(documentName, connection, seed, "rejected", false);
            return;
          }
          await this.applyWorkspaceSeed(documentName, document, connection, seed);
          return;
        }
        if (connection.readOnly || this.lifecycle.isReadOnly(documentName)) return;
        const command = parseSatWorkspaceCommand(payload, {
          documentName,
          // The signed identity, not something the browser asserted: a relayed
          // notification must come from the actor it claims.
          ...(connection.context.actorId ? { actorId: connection.context.actorId } : {}),
        });
        if (!command) return;
        document.broadcastStateless(JSON.stringify(command));
      },

      /**
       * Announces a refused write.
       *
       * A read-only connection's updates are dropped by Hocuspocus with a
       * SyncStatus frame carrying `applied: false`, and the browser's provider
       * only reacts to `applied: true` — it decrements its unsynced counter and
       * otherwise ignores the frame. So an author whose room went read-only
       * (a publish freeze marks every connection read-only) is left holding
       * content the server never applied, with a save status that never leaves
       * Syncing and no way to learn why. This hook runs BEFORE that guard, so
       * the refusal is announced in the failure vocabulary the editor already
       * has, which turns it into the export recovery instead of a dead end.
       *
       * Only `connection.readOnly` is treated as a refusal, because that is
       * exactly when Hocuspocus refuses: a frozen room whose connection is
       * still writable accepts the update and fails the STORE instead, and that
       * path already reports itself.
       */
      beforeSync: async ({ connection, documentName, type }) => {
        if (!connection.readOnly) return;
        if (type !== SYNC_STEP_TWO && type !== SYNC_UPDATE) return;
        const frame: CoeditRefusalFrame = {
          type: "coedit.save_failed",
          documentName,
          // A verbatim retry cannot succeed: the connection is read-only until
          // the room changes lifecycle, so the client is told to export rather
          // than to loop.
          retryable: false,
          reason: COEDIT_WRITE_REFUSED_REASON,
          requiresResync: false,
        };
        try {
          connection.send(
            new OutgoingMessage(connection.messageAddress)
              .writeStateless(JSON.stringify(frame))
              .toUint8Array(),
          );
          metrics.incCounter("authoring_coedit_store_total", { outcome: "rejected" });
        } catch {
          // A connection that cannot be told recovers on its next reconnect,
          // which performs the same handshake against the current room state.
        }
      },

      onDisconnect: async ({
        documentName,
        socketId,
      }: onDisconnectPayload<CoeditConnectionContext>) => {
        this.pendingTokenSync.delete(refreshKey(documentName, socketId));
        this.refreshGauges();
      },

      onLoadDocument: async ({
        documentName,
        document,
        context,
      }: onLoadDocumentPayload<CoeditConnectionContext>) => {
        const metadata = await this.persistence.load({ documentName, document, context });
        this.lifecycle.hydrateDurableState(documentName, metadata);
        if (context.mode === "write" && this.lifecycle.isReadOnly(documentName)) {
          throw new Error("coedit_document_frozen");
        }
        this.refreshGauges();
      },

      onStoreDocument: async ({
        documentName,
        document,
        lastContext,
      }: onStoreDocumentPayload<CoeditConnectionContext>) => {
        if (this.lifecycle.isClosed(documentName)) {
          throw new Error("coedit_document_closed");
        }
        if (this.lifecycle.isReadOnly(documentName)) {
          log("warn", "co-edit store refused while frozen", {
            event: "store_refused",
            outcome: "frozen",
            stage: "store",
          });
          if (this.shuttingDown) {
            // Shutdown already flushed this room. Refusing without failing the
            // hook chain lets Hocuspocus unload the document and finish its
            // teardown; a thrown error here would strand the unload forever.
            throw new SkipFurtherHooksError("authoring-coedit is shutting down");
          }
          throw new Error("coedit_document_frozen");
        }
        metrics.incCounter("authoring_coedit_state_bytes", {
          le: sizeBucket(encodeStateAsUpdate(document).byteLength),
        });
        await this.storeRoom({ documentName, document, context: lastContext });
      },

      /**
       * Awareness is caret/selection only. Name, actor id, and color are
       * replaced with server-derived values and every other browser-defined
       * property is dropped, so a peer cannot impersonate or smuggle content
       * through presence.
       */
      beforeHandleAwareness: async ({ states, context }) => {
        const identity = context?.actorId
          ? { actorId: context.actorId, displayName: context.displayName ?? "" }
          : null;
        for (const [clientId, state] of states) {
          if (!identity) {
            states.delete(clientId);
            continue;
          }
          for (const key of Object.keys(state)) {
            if (!isAwarenessKey(key)) delete state[key];
          }
          state["user"] = {
            id: identity.actorId,
            name: identity.displayName,
            color: colorForActor(identity.actorId),
          };
        }
      },
    };
  }

  private assertOrigin(requestHeaders: Headers): void {
    const allowed = this.config.allowedOrigin;
    if (!allowed) return;
    const origin = requestHeaders.get("origin") ?? "";
    if (origin !== allowed) {
      log("warn", "co-edit origin rejected", { event: "auth", outcome: "rejected", reason: "client" });
      throw permissionDenied(new TokenError("Co-edit origin is not allowed."));
    }
  }

  /**
   * A seed is a write, so it must satisfy both write facts: the connection must
   * not be read-only (its token was minted for `write` and the room is not
   * frozen), and the SIGNED mode on the connection context — derived during
   * `onAuthenticate` from the token, never from the browser — must say write.
   * Checking the context too is what keeps a refreshed read token from turning
   * into a seeder: the transport flag alone is a mirror, not the authority.
   */
  private maySeed(documentName: string, connection: Connection<CoeditConnectionContext>): boolean {
    return (
      !connection.readOnly &&
      connection.context.mode === "write" &&
      !this.lifecycle.isReadOnly(documentName)
    );
  }

  /**
   * Tells the PROPOSER what happened to its seed.
   *
   * Sent to the connection that proposed rather than broadcast: it is that
   * editor's wait being resolved, and a peer's conflict is not another peer's
   * news. Never throws — this runs inside a stateless hook, and a rejection
   * there reaches the process instead of the browser.
   */
  private sendSeedResult(
    documentName: string,
    connection: Connection<CoeditConnectionContext>,
    seed: WorkspaceSeedFrame,
    outcome: WorkspaceSeedOutcome,
    retryable: boolean,
  ): void {
    try {
      const frame = createWorkspaceSeedResultFrame({
        documentName,
        seedId: seed.seedId,
        root: seed.root,
        path: seed.path,
        outcome,
        retryable,
      });
      connection.send(
        new OutgoingMessage(connection.messageAddress)
          .writeStateless(JSON.stringify(frame))
          .toUint8Array(),
      );
    } catch (error) {
      log("warn", "co-edit seed result could not be sent", {
        event: "seed",
        outcome: "rejected",
        stage: "notify",
        reason: error instanceof Error ? error.message : "other",
      });
    }
  }

  /** Applies one authenticated seed proposal while holding the field lock. */
  private async applyWorkspaceSeed(
    documentName: string,
    document: Y.Doc,
    connection: Connection<CoeditConnectionContext>,
    seed: WorkspaceSeedFrame,
  ): Promise<void> {
    // One lock per document + root, so two proposals for the SAME root are
    // serialized while proposals for different roots still make progress
    // together. "Root already has content" is only decidable inside that
    // serialization: outside it, both writers read the empty root and both
    // apply.
    const lockKey = `${documentName}\u0000${seed.root}\u0000${seed.path}`;
    await this.withSeedOperation(lockKey, async () => {
      const durablyApplied = this.appliedSeeds.get(documentName);
      if (durablyApplied?.has(seed.seedId)) {
        // The same proposal already became durable content. It is neither a
        // second author nor a conflict, and re-applying it could only re-derive
        // the state the store already holds.
        metrics.incCounter("authoring_coedit_seed_total", { outcome: "duplicate" });
        this.sendSeedResult(documentName, connection, seed, "applied", false);
        return;
      }
      if (seed.root === "scalar") {
        const root = document.getMap<unknown>(FIELD_SET_WORKSPACE);
        if (root.has(seed.path)) {
          metrics.incCounter("authoring_coedit_seed_total", { outcome: "conflict" });
          // The room already holds this root, and it is the newer truth: the
          // proposer adopts it rather than waiting for its own proposal.
          this.sendSeedResult(documentName, connection, seed, "conflict", false);
          return;
        }
        document.transact(() => {
          root.set(seed.path, JSON.stringify(seed.value));
        }, "coedit-seed");
      } else {
        const fragment = document.getXmlFragment(`${RICH_ROOT_PREFIX}${seed.path}`);
        if (fragment.length > 0) {
          metrics.incCounter("authoring_coedit_seed_total", { outcome: "conflict" });
          this.sendSeedResult(documentName, connection, seed, "conflict", false);
          return;
        }
        prosemirrorJSONToYXmlFragment(
          promptSchema(),
          documentFromStructuredContent(
            seed.value as Parameters<typeof documentFromStructuredContent>[0],
          ),
          fragment,
        );
      }
      // A seed is not acknowledged merely because it entered the live Y.Doc.
      // Store it through the same hash-checked path before treating it as
      // accepted; a failure leaves the document dirty, and a transient one is
      // retried on the shared ladder rather than left to the author.
      await this.storeRoom({
        documentName,
        document,
        context: connection.context,
      });
      this.recordAppliedSeed(documentName, seed.seedId);
      metrics.incCounter("authoring_coedit_seed_total", { outcome: "accepted" });
      log("info", "co-edit workspace seed accepted", {
        event: "seed",
        outcome: "accepted",
        stage: "store",
        mode: connection.context.mode,
      });
      this.sendSeedResult(documentName, connection, seed, "applied", false);
    }).catch((error) => {
      metrics.incCounter("authoring_coedit_seed_total", { outcome: "rejected" });
      log("warn", "co-edit workspace seed failed", {
        event: "seed",
        outcome: "rejected",
        stage: "store",
        reason: error instanceof Error ? error.message : "other",
      });
      // Reported, not silently swallowed: the field's editor can only stop
      // waiting if it learns the proposal did not become content.
      this.sendSeedResult(
        documentName,
        connection,
        seed,
        "failed",
        error instanceof GoRequestError && error.retryable,
      );
      // Deliberately NOT rethrown. This runs inside the `onStateless` hook, and
      // Hocuspocus does not catch a rejected stateless hook: the rejection
      // reached the process, took the whole service down, and every browser
      // then got a 503 on the co-edit socket — an author could not save at all
      // because one seed proposal failed. The proposal is idempotent, its
      // content is already in the live document (so the next debounced store
      // commits it), and the refusal has already been broadcast to the room by
      // the store that failed. Reporting it is the whole correct response.
    });
  }

  /**
   * Stores the room's current in-memory state because a client asked.
   *
   * This is what an editor's Retry action sends, and it is the only way a client
   * can make work durable: Hocuspocus stores a document when an update re-arms
   * its debounce, so a room whose last store failed stays dirty with nothing
   * scheduled until the author types again. The outcome is not answered here —
   * `persistence.store` already broadcasts the acknowledgement or the refusal to
   * the room, which is the vocabulary the save area already reads.
   */
  private async storeOnRequest(
    documentName: string,
    document: Y.Doc,
    connection: Connection<CoeditConnectionContext>,
  ): Promise<void> {
    if (connection.readOnly || this.lifecycle.isReadOnly(documentName)) {
      // A room that may not be written to has nothing to commit: the refusal
      // has its own path, and a read-only connection is reported through the
      // lifecycle frames the editor already reads.
      return;
    }
    try {
      await this.storeRoom({ documentName, document, context: connection.context });
    } catch (error) {
      // Never rethrown into the stateless hook: a rejection there is an
      // unhandled rejection and takes the process down (see `applyWorkspaceSeed`),
      // and the store has already broadcast its refusal to the room.
      log("warn", "co-edit store request failed", {
        event: "store_failed",
        reason: error instanceof Error ? error.message : "other",
        stage: "store",
      });
    }
  }

  /**
   * Stores one room, and arranges another attempt when the failure was the
   * backend being briefly away.
   *
   * Every store in this service goes through here, so the retry policy is a
   * property of storing rather than of one caller: an edit, a seed proposal, and
   * an author's Retry all recover the same way when the backend blinks. The
   * error still propagates, because the callers' contracts depend on it —
   * Hocuspocus keeps the document dirty when the store throws instead of
   * unloading it, and the seed path must not treat an unpersisted proposal as
   * applied.
   */
  private async storeRoom(input: StoreHookInput): Promise<void> {
    try {
      await this.persistence.store(input);
      this.cancelStoreRetry(input.documentName);
    } catch (error) {
      this.scheduleStoreRetry(input, error);
      throw error;
    }
  }

  /** Queues at most one pending retry per room, on the next rung of the ladder. */
  private scheduleStoreRetry(input: StoreHookInput, error: unknown): void {
    if (this.shuttingDown || this.lockLost) return;
    // A refusal is not a retryable condition; see STORE_RETRY_DELAYS_MS.
    if (!(error instanceof GoRequestError) || !error.retryable) return;
    const pending = this.storeRetries.get(input.documentName);
    const attempts = pending?.attempts ?? 0;
    const delayMs = this.storeRetryDelays[attempts];
    if (delayMs === undefined) {
      // Bounded ladder exhausted. The author already has the failure on screen
      // and can Retry, which starts a fresh ladder — hence the entry is dropped
      // rather than kept at its last rung: a spent ladder left in the map would
      // answer every FUTURE failure with "exhausted", so a room whose backend
      // came back could never be retried again, by anyone.
      this.storeRetries.delete(input.documentName);
      metrics.incCounter("authoring_coedit_store_retry_total", { outcome: "skipped" });
      log("warn", "co-edit store retries exhausted", {
        event: "store_retry",
        outcome: "skipped",
        count: attempts,
        stage: "store",
      });
      return;
    }
    if (pending) clearTimeout(pending.timer);
    const timer = setTimeout(() => {
      void this.retryStore(input);
    }, delayMs);
    timer.unref?.();
    this.storeRetries.set(input.documentName, { attempts: attempts + 1, timer });
    log("info", "co-edit store retry scheduled", {
      event: "store_retry",
      outcome: "accepted",
      attempt: attempts + 1,
      durationMs: delayMs,
      stage: "store",
    });
  }

  /**
   * One rung of the retry ladder.
   *
   * The room may have moved on between the failure and the attempt — closed,
   * frozen, or unloaded and reopened — and each of those means the stored copy
   * must NOT be written from here: a freeze or close refuses writes outright, and
   * a reopened room owns a DIFFERENT in-memory document, so committing the
   * discarded one would overwrite state the new room has already synced.
   *
   * The pending entry STAYS in the map while this rung runs: it is the ladder's
   * position, and a failure here has to continue from it. Clearing it first
   * would restart every rung at the bottom, which is an unbounded retry wearing
   * a bounded ladder's clothes.
   */
  private async retryStore(input: StoreHookInput): Promise<void> {
    if (this.shuttingDown || this.lockLost) {
      this.cancelStoreRetry(input.documentName);
      return;
    }
    if (this.lifecycle.isClosed(input.documentName) || this.lifecycle.isReadOnly(input.documentName)) {
      this.cancelStoreRetry(input.documentName);
      return;
    }
    const live = this.server.hocuspocus.documents.get(input.documentName) as unknown as
      | Y.Doc
      | undefined;
    if (live !== input.document) {
      // The room was unloaded and reopened; its ladder belongs to a document
      // that no longer exists.
      this.cancelStoreRetry(input.documentName);
      return;
    }
    try {
      await this.persistence.store(input);
      this.cancelStoreRetry(input.documentName);
      metrics.incCounter("authoring_coedit_store_retry_total", { outcome: "accepted" });
      log("info", "co-edit store retry accepted", {
        event: "store_retry",
        outcome: "accepted",
        stage: "store",
      });
    } catch (error) {
      metrics.incCounter("authoring_coedit_store_retry_total", { outcome: "rejected" });
      // The rung is logged by the store hook it failed in; this line only
      // accounts for the retry dimension.
      log("warn", "co-edit store retry rejected", {
        event: "store_retry",
        outcome: "rejected",
        reason: error instanceof Error ? error.message : "other",
        stage: "store",
      });
      this.scheduleStoreRetry(input, error);
    }
  }

  /** A successful store ends the ladder for its room. */
  private cancelStoreRetry(documentName: string): void {
    const pending = this.storeRetries.get(documentName);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.storeRetries.delete(documentName);
  }

  /** Shutdown and lock loss cancel every pending attempt: this process is done. */
  private clearStoreRetries(): void {
    for (const pending of this.storeRetries.values()) clearTimeout(pending.timer);
    this.storeRetries.clear();
  }

  /**
   * Remembers one durably applied seed id, bounded per room so a long-lived
   * workspace cannot grow this ledger without limit. The oldest rooms are
   * dropped first; a dropped entry only costs a re-arbitration of a proposal
   * whose root is already populated, which still resolves to a conflict.
   */
  private recordAppliedSeed(documentName: string, seedId: string): void {
    let applied = this.appliedSeeds.get(documentName);
    if (!applied) {
      applied = new Set<string>();
      this.appliedSeeds.set(documentName, applied);
    }
    applied.add(seedId);
    // A Set preserves insertion order, so the first key is the oldest proposal.
    while (applied.size > MAX_APPLIED_SEEDS_PER_ROOM) {
      const oldest = applied.values().next().value;
      if (typeof oldest !== "string") break;
      applied.delete(oldest);
    }
    while (this.appliedSeeds.size > MAX_SEED_LEDGER_ROOMS) {
      const oldestRoom = this.appliedSeeds.keys().next().value;
      if (typeof oldestRoom !== "string") break;
      this.appliedSeeds.delete(oldestRoom);
    }
  }

  private async withSeedOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.seedOperations.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.seedOperations.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      if (this.seedOperations.get(key) === current) this.seedOperations.delete(key);
      release();
    }
  }
}

/** Presence fields a browser may set; everything else is server-derived. */
const AWARENESS_KEYS = new Set(["cursor", "selection", "user", "target"]);

function isAwarenessKey(key: string): boolean {
  return AWARENESS_KEYS.has(key) || /^cursor:[A-Za-z0-9:_/.-]{1,192}$/.test(key);
}

function refreshKey(documentName: string, socketId: string): string {
  return `${documentName}\u0000${socketId}`;
}

function sizeBucket(bytes: number): string {
  for (const bucket of STATE_SIZE_BUCKETS) {
    if (bytes <= bucket) return String(bucket);
  }
  return "+Inf";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref?.());
}

/** Deterministic, content-free cursor colour derived from the actor id. */
export function colorForActor(actorId: string): string {
  // CollaborationCaret accepts hex colors consistently across browsers. Keep
  // this palette in sync with the browser's server-derived fallback so a
  // collaborator's caret has one stable color in every client.
  const palette = [
    "#2563EB",
    "#7C3AED",
    "#DB2777",
    "#0891B2",
    "#4F46E5",
    "#C026D3",
    "#0369A1",
    "#9333EA",
  ];
  let hash = 0;
  for (let index = 0; index < actorId.length; index += 1) {
    hash = (hash * 31 + actorId.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length] as string;
}

function permissionDenied(error: unknown): Error {
  const reason = error instanceof Error ? error.message : "permission-denied";
  const wrapped = Object.assign(new Error(reason), {
    code: PERMISSION_DENIED.code,
    reason,
  });
  return wrapped;
}

export function createCoeditService(
  config: CoeditServiceConfig,
  deps: CoeditServiceDeps = {},
): CoeditService {
  return new CoeditService(config, deps);
}

export async function main(): Promise<void> {
  let config: CoeditServiceConfig;
  try {
    config = loadConfig();
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : "invalid configuration";
    // stderr, not the structured logger: nothing is configured yet, and a
    // service that cannot load its secrets must not appear to have started.
    process.stderr.write(`authoring-coedit: ${message}\n`);
    process.exit(1);
    return;
  }

  const service = createCoeditService(config);
  const shutdown = (signal: string) => {
    log("info", "authoring-coedit shutting down", { event: "shutdown", reason: signal });
    void service.stop().then((outcome) => {
      process.exit(outcome === "clean" ? 0 : 1);
    });
  };
  process.on("SIGTERM", () => shutdown("shutdown"));
  process.on("SIGINT", () => shutdown("shutdown"));

  try {
    await service.start();
  } catch (error) {
    log("error", "authoring-coedit failed to start", {
      event: "start_failed",
      outcome: "rejected",
      error: (error as Error).message,
    });
    await service.stop().catch(() => undefined);
    process.exit(1);
  }
}

const isEntrypoint =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  void main();
}
