import {
  AUTHORING_FATAL_ERROR_CODES,
  AUTHORING_PROTOCOL_VERSION,
  type AuthoringCapabilities,
  type AuthoringClientOptions,
  type AuthoringConnectionState,
  type AuthoringInboundFrame,
  type AuthoringSubscribeFrame,
} from "./contracts";
import { MAX_AUTHORING_FRAME_BYTES, parseAuthoringFrame } from "./schemas";

/**
 * Framework-free authoring WebSocket client.
 *
 * Mirrors the proven cleanup discipline of the runtime live hook (ref-held
 * callbacks, disposed-flag teardown, timer/socket refs) but this is a SEPARATE
 * client: its URL, frames, backoff ceiling (30 s vs 10 s), and error taxonomy
 * are all authoring-specific. It never touches React Query — it only emits
 * typed callbacks.
 *
 * Liveness: the browser auto-answers server pings, so the client cannot observe
 * them. Instead it sends a periodic re-subscribe (a supported frame that the
 * server revalidates and re-acks) and treats ANY inbound frame as liveness.
 * Silence beyond `heartbeatTimeoutMs` closes the socket and reconnects.
 */

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 25_000;
const DEFAULT_STABLE_RESET_MS = 30_000;
const DEFAULT_BASE_MS = 500;
const DEFAULT_CAP_MS = 30_000;
const DEFAULT_JITTER_MS = 250;

export interface AuthoringBackoffOptions {
  baseMs?: number;
  capMs?: number;
  jitterMs?: number;
}

/**
 * Exponential backoff with jitter: `min(cap, base * 2^attempt) + uniform(0, jitter)`.
 * attempt 0 ≈ 500 ms, 1 ≈ 1000, 2 ≈ 2000, … hard-capped at 30 s + jitter.
 * The exponent is clamped so a long outage can never overflow to Infinity.
 */
export function computeAuthoringBackoffMs(
  attempt: number,
  options?: AuthoringBackoffOptions,
): number {
  const base = options?.baseMs ?? DEFAULT_BASE_MS;
  const cap = options?.capMs ?? DEFAULT_CAP_MS;
  const jitter = options?.jitterMs ?? DEFAULT_JITTER_MS;
  const safeAttempt = Math.max(0, Math.min(Math.trunc(attempt), 10));
  const exponential = Math.min(cap, base * 2 ** safeAttempt);
  return exponential + Math.floor(Math.random() * (jitter + 1));
}

/** Same-origin authoring socket URL (Phase 03 mount: GET /api/v1/ws/authoring). */
export function buildAuthoringSocketUrl(examId: string): string {
  const path = `/api/v1/ws/authoring?examId=${encodeURIComponent(examId)}`;
  if (typeof window === "undefined") {
    return path;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export class AuthoringRealtimeClient {
  private readonly options: AuthoringClientOptions;
  private socket: WebSocket | null = null;
  private disposed = true;
  private fatal = false;
  private stable = false;
  private attempt = 0;
  private state: AuthoringConnectionState = "disabled";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while the FIRST subscribe of this socket is awaiting its ack. */
  private awaitingInitialAck = false;
  /** Whether that first subscribe asked to resume (lastSeenCursor present). */
  private initialSubscribeResumed = false;

  constructor(options: AuthoringClientOptions) {
    this.options = options;
  }

  start(): void {
    this.disposed = false;
    this.fatal = false;
    this.stable = false;
    this.attempt = 0;
    this.setState("connecting");
    this.connect();
  }

  /** Disposed-flag cleanup: no further reconnects, timers, or callbacks. */
  stop(): void {
    this.disposed = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState("disabled");
  }

  /** Manual retry (exposed through the hook): resets backoff and reconnects now. */
  reconnectNow(): void {
    if (this.disposed) {
      return;
    }
    this.fatal = false;
    this.attempt = 0;
    this.clearReconnectTimer();
    this.connect();
  }

  getAttemptCount(): number {
    return this.attempt;
  }

  isStableConnected(): boolean {
    return this.stable && this.state === "live";
  }

  /**
   * Send one outbound frame (presence only in practice). Returns false when no
   * socket is open, which the caller treats as "the advisory frame was dropped",
   * never as an error.
   */
  send(frame: unknown): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 /* OPEN */) {
      return false;
    }
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  sendSubscribe(lastSeenCursor: number | null): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 /* OPEN */) {
      return;
    }
    const frame: AuthoringSubscribeFrame = {
      type: "authoring.subscribe",
      v: AUTHORING_PROTOCOL_VERSION,
      examId: this.options.examId,
    };
    if (lastSeenCursor !== null) {
      frame.lastSeenCursor = lastSeenCursor;
    }
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      // A send failure will surface through onclose; nothing to do here.
    }
  }

  private setState(next: AuthoringConnectionState): void {
    if (this.state === next) {
      return;
    }
    this.state = next;
    this.options.onStateChange?.(next);
  }

  private createSocket(url: string): WebSocket {
    if (this.options.socketFactory) {
      return this.options.socketFactory.create(url);
    }
    return new WebSocket(url);
  }

  private connect(): void {
    if (this.disposed || this.fatal) {
      return;
    }
    const previous = this.socket;
    if (previous) {
      this.socket = null;
      previous.close();
    }

    let socket: WebSocket;
    try {
      socket = this.createSocket(this.options.url);
    } catch {
      this.setState("reconnecting");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.disposed || this.socket !== socket) {
        socket.close();
        return;
      }
      this.armStableReset();
      this.armKeepalive();
      this.armHeartbeat();
      const lastSeen = this.options.getLastSeenCursor();
      this.initialSubscribeResumed = lastSeen !== null;
      this.awaitingInitialAck = true;
      this.sendSubscribe(lastSeen);
    };

    socket.onmessage = (event: MessageEvent) => {
      if (this.disposed || this.socket !== socket) {
        return;
      }
      this.armHeartbeat();
      this.handleRaw(event.data);
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.clearTimers();
      if (this.disposed) {
        return;
      }
      if (this.fatal) {
        this.setState("forbidden");
        return;
      }
      this.setState("reconnecting");
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose owns reconnect; nothing to do.
    };
  }

  private handleRaw(data: unknown): void {
    if (typeof data !== "string") {
      return;
    }
    if (data.length > MAX_AUTHORING_FRAME_BYTES) {
      this.options.onMalformed?.({ raw: data.slice(0, 256), reason: "oversize" });
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      this.options.onMalformed?.({ raw: data.slice(0, 256), reason: "malformed-json" });
      return;
    }
    // Presence is routed BEFORE the delivery-frame union: it has its own
    // vocabulary and its own (advisory) failure mode, so an unknown presence
    // shape must never be counted as a malformed delivery frame or close the
    // socket an author is actively editing over.
    if (
      json !== null &&
      typeof json === "object" &&
      (json as Record<string, unknown>)["type"] === "authoring.presence"
    ) {
      this.options.onPresence?.(json);
      return;
    }
    const parsed = parseAuthoringFrame(json);
    if (!parsed.ok) {
      if (parsed.outcome === "unknown-kind") {
        // Structurally valid, semantically unknown: the caller consumes the
        // cursor so resume never lags, without running business behavior.
        this.options.onUnknownKind?.({ rawKind: parsed.rawKind, cursor: parsed.cursor });
        return;
      }
      this.options.onMalformed?.({ raw: data.slice(0, 256), reason: parsed.reason });
      return;
    }
    const frame: AuthoringInboundFrame = parsed.value;
    if (frame.type === "authoring.subscribed") {
      this.setState("live");
      // Only the FIRST ack of a socket is a baseline event. Keepalive
      // re-subscribe acks must never re-seed the cursor or trigger refetches.
      if (this.awaitingInitialAck) {
        this.awaitingInitialAck = false;
        this.options.onSubscribed?.({
          examId: frame.examId,
          draftVersionId: frame.draftVersionId,
          barrierCursor: frame.barrierCursor,
          resumed: this.initialSubscribeResumed,
          connectionId: frame.connectionId ?? null,
        });
      }
    } else if (frame.type === "authoring.capabilities") {
      const capabilities: AuthoringCapabilities = {
        delivery: frame.delivery,
        presence: frame.presence,
        conflictCompare: frame.conflictCompare,
      };
      this.options.onCapabilities?.(capabilities);
    } else if (frame.type === "authoring.error") {
      if (AUTHORING_FATAL_ERROR_CODES.includes(frame.code)) {
        this.fatal = true;
        this.setState("forbidden");
        this.clearTimers();
        const socket = this.socket;
        this.socket = null;
        socket?.close();
        return;
      }
    }
    this.options.onFrame?.(frame);
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.fatal) {
      return;
    }
    const delay = computeAuthoringBackoffMs(this.attempt, {
      baseMs: this.options.minReconnectDelayMs ?? DEFAULT_BASE_MS,
      capMs: this.options.maxReconnectDelayMs ?? DEFAULT_CAP_MS,
    });
    this.attempt = Math.min(this.attempt + 1, 20);
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.disposed) {
        this.connect();
      }
    }, delay);
  }

  private armHeartbeat(): void {
    this.clearHeartbeatTimer();
    const timeout = this.options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      // Silence: assume the connection is dead and force a clean reconnect.
      const socket = this.socket;
      this.socket = null;
      socket?.close();
      if (!this.disposed) {
        this.setState("reconnecting");
        this.scheduleReconnect();
      }
    }, timeout);
  }

  private armKeepalive(): void {
    this.clearKeepaliveTimer();
    const interval = this.options.keepaliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS;
    this.keepaliveTimer = setInterval(() => {
      // A re-subscribe is a supported frame: the server revalidates the draft
      // and re-acks, which also refreshes the liveness signal above.
      this.sendSubscribe(this.options.getLastSeenCursor());
    }, interval);
  }

  private armStableReset(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
    }
    const delay = this.options.stableResetMs ?? DEFAULT_STABLE_RESET_MS;
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      this.stable = true;
      this.attempt = 0;
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearKeepaliveTimer(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.clearKeepaliveTimer();
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }
}
