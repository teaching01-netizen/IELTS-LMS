import type { IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { SkipFurtherHooksError } from "@hocuspocus/common";
import {
  OutgoingMessage,
  Server,
  type Extension,
  type onAuthenticatePayload,
  type onConnectPayload,
  type onDisconnectPayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
  type onTokenSyncPayload,
} from "@hocuspocus/server";
import { authorizeDocument, TokenError, verifyToken, type TokenClaims } from "./authToken.js";
import { ConfigError, loadConfig, singletonLockName, type CoeditServiceConfig } from "./config.js";
import { FIELD_SET_WORKSPACE, MAX_FRAME_BYTES, parseAnyDocumentName } from "./documentIdentity.js";
import { encodeStateAsUpdate } from "./documentCodec.js";
import { GoAuthoringClient } from "./goAuthoringClient.js";
import {
  CONTROL_PATHS,
  LifecycleController,
  type CoeditConnectionContext,
} from "./lifecycleControl.js";
import { CoeditPersistence } from "./persistence.js";
import { SingletonLock } from "./singletonLock.js";
import { log, metrics } from "./telemetry.js";
import { parseWorkspaceCommand } from "./workspaceCommands.js";

/**
 * Co-edit service process.
 *
 * The server is one singleton process, so the whole lifecycle is written to
 * fail closed: readiness is false until the environment lock is held, lock
 * loss closes every room and exits, and shutdown refuses to claim success when
 * the flush deadline expires.
 */
export const CONTROL_REQUEST_TIMEOUT_MS = 15_000;
export const MAX_UNAUTHENTICATED_QUEUE_BYTES = MAX_FRAME_BYTES * 4;
export const TOKEN_REFRESH_INTERVAL_MS = 60_000;
const STATE_SIZE_BUCKETS = [4 << 10, 16 << 10, 64 << 10, 256 << 10, 1 << 20, 2 << 20, 4 << 20];
const RETRYABLE_CLOSE = { code: 1012, reason: "coedit_service_restart" };
const PERMISSION_DENIED = { code: 4403, reason: "permission-denied" };

export const CONTROL_REQUEST_PATHS = new Set<string>([
  CONTROL_PATHS.healthz,
  CONTROL_PATHS.readyz,
  CONTROL_PATHS.metrics,
  CONTROL_PATHS.freeze,
  CONTROL_PATHS.unfreeze,
  CONTROL_PATHS.flush,
  CONTROL_PATHS.close,
]);

export interface CoeditServiceDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Overridable so tests can exercise contention and lock loss without MySQL. */
  lock?: LockLike;
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
  private readonly pendingTokenSync = new Map<string, number>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: CoeditServiceConfig, deps: CoeditServiceDeps = {}) {
    this.config = config;
    this.now = deps.now ?? (() => Date.now());
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
      metrics.incCounter("authoring_coedit_shutdown_flush_total", { outcome: "rejected" });
      log("error", "authoring-coedit shutdown deadline exceeded", {
        event: "shutdown",
        stage: "flush",
        outcome: "rejected",
      });
    }
    metrics.incCounter("authoring_coedit_shutdown_flush_total", { outcome: "accepted" });
    return outcome;
  }

  /** Lock loss is fatal: a live process without the lock would serve split rooms. */
  private onLockLost(reason: string): void {
    if (this.lockLost) return;
    this.lockLost = true;
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
        this.pendingTokenSync.set(key, this.now());
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
        if (this.lifecycle.isClosed(name)) {
          metrics.incCounter("authoring_coedit_auth_total", { outcome: "closed" });
          throw permissionDenied(new TokenError("Co-edit document is closed."));
        }
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
        connectionConfig.readOnly = claims.mode === "read";
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
        connectionConfig.readOnly = claims.mode === "read";
        connection.readOnly = claims.mode === "read";
        context.displayName = claims.displayName;
      },

      onConnect: async ({ requestHeaders }: onConnectPayload<CoeditConnectionContext>) => {
        this.assertOrigin(requestHeaders);
        metrics.incCounter("authoring_coedit_reconnect_total", { outcome: "accepted" });
        this.refreshGauges();
      },

      connected: async ({ documentName, connection }) => {
        // Loading an already committed document (including the first seed) is
        // itself durable. Send that exact hash to the new connection so the
        // browser can render Saved without waiting for an unrelated edit to
        // trigger the first store acknowledgement.
        const commit = this.persistence.lastCommit(documentName);
        if (!commit) return;
        connection.send(
          new OutgoingMessage(connection.messageAddress)
            .writeStateless(
              JSON.stringify({
                type: "coedit.ack",
                documentName,
                stateHash: commit.stateHash,
                questionRevision: commit.questionRevision,
                materializedRevision: commit.materializedRevision,
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
        if (parseAnyDocumentName(documentName)?.fieldSet !== FIELD_SET_WORKSPACE) return;
        if (connection.readOnly || this.lifecycle.isClosed(documentName) || this.lifecycle.isFrozen(documentName)) return;
        const command = parseWorkspaceCommand(payload, documentName, connection.context.actorId);
        if (!command) return;
        document.broadcastStateless(JSON.stringify(command));
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
        await this.persistence.load({ documentName, document, context });
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
        if (this.lifecycle.isFrozen(documentName)) {
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
        await this.persistence.store({ documentName, document, context: lastContext });
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
