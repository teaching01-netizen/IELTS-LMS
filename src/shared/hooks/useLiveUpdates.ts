import { useEffect, useRef } from 'react';

export interface LiveUpdateEvent {
  kind: string;
  id: string;
  revision: number;
  event: string;
  scheduleId?: string;
  // Server commit instant of the bus row (RFC3339). Only used to measure
  // delivery latency client-side — never to decide state, because a client
  // clock has no authority over the runtime clock.
  createdAt?: string;
}

type LiveUpdateFrame =
  | { type: 'connected'; scheduleId?: string | null; attemptId?: string | null }
  | { type: 'error'; code?: string; message?: string }
  | { type: 'runtime_snapshot'; scheduleId?: string | null; runtime?: unknown }
  | LiveUpdateEvent;

function buildLiveUpdatesUrl(options: {
  scheduleId?: string;
  attemptId?: string;
  lastSeenRuntimeRevision?: number;
}) {
  if (typeof window === 'undefined') {
    return null;
  }

  const isSecure = window.location.protocol === 'https:';
  const protocol = isSecure ? 'wss:' : 'ws:';
  const base = `${protocol}//${window.location.host}`;
  const url = new URL('/api/v1/ws/live', base);

  if (options.scheduleId) {
    url.searchParams.set('scheduleId', options.scheduleId);
  }
  if (options.attemptId) {
    url.searchParams.set('attemptId', options.attemptId);
  }
  if (Number.isInteger(options.lastSeenRuntimeRevision)) {
    url.searchParams.set('lastSeenRuntimeRevision', String(options.lastSeenRuntimeRevision));
  }

  return url.toString();
}

function isLiveUpdateEvent(frame: unknown): frame is LiveUpdateEvent {
  if (!frame || typeof frame !== 'object') {
    return false;
  }

  const value = frame as Record<string, unknown>;
  return (
    typeof value['kind'] === 'string' &&
    typeof value['id'] === 'string' &&
    typeof value['event'] === 'string' &&
    (value['scheduleId'] === undefined || typeof value['scheduleId'] === 'string') &&
    (typeof value['revision'] === 'number' || typeof value['revision'] === 'string')
  );
}

// Plan C1 retired student sockets in favor of the versioned runtime poll
// (GET .../runtime?sinceRevision=). Plan C1 is now a ROLLOUT, not a law: the
// server admits student sockets again under STUDENT_WS=allow, and the student
// route decides the transport from one client switch
// (resolveStudentRealtimeTransport). `role` still matters — it is what the
// server authorizes and filters on — but it no longer silently disables
// transport, because a role that cannot connect is indistinguishable from a
// role whose updates were dropped.
//
// Emergency rollback: STUDENT_WS=gone answers 410 before the upgrade. A
// browser cannot see that status, so students pass a bounded connect budget
// (maxConnectAttemptsWithoutOpen) and fall back to the poll instead of
// burning a reconnect loop.
export const STUDENT_ROLE_SOCKET_RETIRED = 'STUDENT_WS_RETIRED' as const;

/** Default connect budget when a caller sets one; 0 = retry forever. */
export const DEFAULT_MAX_CONNECT_ATTEMPTS_WITHOUT_OPEN = 5;

export function useLiveUpdates(options: {
  scheduleId?: string;
  attemptId?: string;
  lastSeenRuntimeRevision?: number;
  enabled?: boolean;
  debounceMs?: number;
  // role describes the caller to the server (authorization + fan-out filter).
  // It no longer gates the socket: whether a student connects is the caller's
  // `enabled` decision (see resolveStudentRealtimeTransport).
  // Staff surfaces pass 'proctor-observer'.
  role?: 'student' | 'proctor-observer';
  // Bounded connect budget: after this many failed attempts while this mount
  // has NEVER opened, stop reconnecting and report disconnected so the poll
  // takes over. 0 (default) retries forever — staff behavior. Students pass
  // DEFAULT_MAX_CONNECT_ATTEMPTS_WITHOUT_OPEN: one emergency rollback flag
  // (STUDENT_WS=gone) must cost five handshakes, not a reconnect loop.
  maxConnectAttemptsWithoutOpen?: number;
  onConnected?: () => void;
  onDisconnected?: () => void;
  // Fired once when the connect budget is spent without a single open. It is a
  // rollout signal, not an error path: the fallback transport already owns the
  // session by then (onDisconnected fired), so this only has to make the
  // "we spent the budget" state observable instead of silent.
  onConnectExhausted?: () => void;
  onError?: (error: { code?: string; message?: string }) => void;
  onRuntimeSnapshot?: (payload: { scheduleId?: string; runtime: unknown }) => void;
  onEvent: (event: LiveUpdateEvent) => void;
}) {
  const enabled = options.enabled ?? true;
  const debounceMs = options.debounceMs ?? 250;
  const onEventRef = useRef(options.onEvent);
  // Burst queue: every validated frame is queued (not coalesced into a
  // single slot), then flushed in order — most-recent-first per
  // (kind,id) so a burst of distinct students is never collapsed to one.
  const queuedEventsRef = useRef<LiveUpdateEvent[]>([]);
  const debounceTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const onConnectedRef = useRef(options.onConnected);
  const onDisconnectedRef = useRef(options.onDisconnected);
  const onConnectExhaustedRef = useRef(options.onConnectExhausted);
  const onErrorRef = useRef(options.onError);
  const onRuntimeSnapshotRef = useRef(options.onRuntimeSnapshot);
  const lastSeenRuntimeRevisionRef = useRef(options.lastSeenRuntimeRevision);

  useEffect(() => {
    onEventRef.current = options.onEvent;
  }, [options.onEvent]);

  useEffect(() => {
    onConnectedRef.current = options.onConnected;
  }, [options.onConnected]);

  useEffect(() => {
    onDisconnectedRef.current = options.onDisconnected;
  }, [options.onDisconnected]);

  useEffect(() => {
    onConnectExhaustedRef.current = options.onConnectExhausted;
  }, [options.onConnectExhausted]);

  useEffect(() => {
    onRuntimeSnapshotRef.current = options.onRuntimeSnapshot;
  }, [options.onRuntimeSnapshot]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    lastSeenRuntimeRevisionRef.current = options.lastSeenRuntimeRevision;
  }, [options.lastSeenRuntimeRevision]);

  useEffect(() => {
    const staticUrl = buildLiveUpdatesUrl({
      ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
      ...(options.attemptId ? { attemptId: options.attemptId } : {}),
    });
    if (!enabled || !staticUrl) {
      return () => undefined;
    }

    let disposed = false;
    shouldReconnectRef.current = true;
    // Connect budget state. A mount that never opened is either misconfigured
    // (STUDENT_WS=gone) or pointed at a dead origin; a mount that opened once
    // and later dropped is a real outage and keeps retrying.
    let everOpened = false;
    let attemptsWithoutOpen = 0;
    const maxAttemptsWithoutOpen = Math.max(0, options.maxConnectAttemptsWithoutOpen ?? 0);

    const scheduleReconnect = () => {
      if (disposed || !shouldReconnectRef.current) {
        return;
      }
      if (!everOpened && maxAttemptsWithoutOpen > 0 && attemptsWithoutOpen >= maxAttemptsWithoutOpen) {
        // Budget exhausted: stop reconnecting. The caller has already been told
        // it is disconnected, so its fallback transport (the versioned runtime
        // poll) owns the session. Never a silent hole: onDisconnected fired.
        shouldReconnectRef.current = false;
        onConnectExhaustedRef.current?.();
        return;
      }

      const attempt = reconnectAttemptRef.current;
      const backoffMs = Math.min(10_000, 500 * 2 ** attempt);
      const jitterMs = Math.floor(Math.random() * 150);
      const delayMs = backoffMs + jitterMs;
      reconnectAttemptRef.current = Math.min(attempt + 1, 20);

      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!disposed) {
          connect();
        }
      }, delayMs);
    };

    // Flush the queued burst: deliver every queued event in arrival order.
    // Same-(kind,id) duplicates keep only the newest revision so a rapid
    // retry burst for one student collapses, while distinct students all
    // still dispatch (fixes the old lastEventRef single-slot drop).
    const flushQueuedEvents = () => {
      const queued = queuedEventsRef.current;
      queuedEventsRef.current = [];
      debounceTimerRef.current = null;
      if (queued.length === 0) {
        return;
      }
      const newestByKey = new Map<string, LiveUpdateEvent>();
      for (const event of queued) {
        newestByKey.set(`${event.kind}::${event.id}`, event);
      }
      for (const event of queued) {
        if (newestByKey.get(`${event.kind}::${event.id}`) === event) {
          onEventRef.current(event);
        }
      }
    };

    const flushDebounced = () => {
      if (debounceMs <= 0) {
        flushQueuedEvents();
        return;
      }

      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        flushQueuedEvents();
      }, debounceMs);
    };

    const handleMessage = (raw: MessageEvent, sourceSocket: WebSocket) => {
      if (disposed || socketRef.current !== sourceSocket) {
        return;
      }
      if (typeof raw.data !== 'string') {
        return;
      }

      let frame: LiveUpdateFrame;
      try {
        frame = JSON.parse(raw.data) as LiveUpdateFrame;
      } catch {
        return;
      }

      if (frame && typeof frame === 'object' && 'type' in frame) {
        const type = (frame as { type?: unknown }).type;
        if (type === 'connected') {
          return;
        }
        if (type === 'error') {
          // Surface recoverable server errors via onError and reconnect
          // with backoff; only fatal auth/capacity codes stop reconnecting.
          const code = (frame as { code?: unknown }).code;
          const message = (frame as { message?: unknown }).message;
          const detail = {
            ...(typeof code === 'string' ? { code } : {}),
            ...(typeof message === 'string' ? { message } : {}),
          };
          onErrorRef.current?.(detail);
          if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'SCHEDULE_CAPACITY') {
            shouldReconnectRef.current = false;
            sourceSocket.close();
            if (socketRef.current === sourceSocket) {
              socketRef.current = null;
            }
            return;
          }
          // Recoverable error: close triggers onclose → scheduleReconnect.
          // The mock socket's close() may not fire onclose, so schedule
          // the reconnect explicitly as well (guarded by shouldReconnect).
          const wasCurrent = socketRef.current === sourceSocket;
          sourceSocket.close();
          if (wasCurrent && socketRef.current === sourceSocket) {
            socketRef.current = null;
            scheduleReconnect();
          }
          return;
        }
        if (type === 'runtime_snapshot') {
          const runtime = (frame as { runtime?: unknown }).runtime;
          if (!runtime) {
            return;
          }
          const scheduleId = (frame as { scheduleId?: unknown }).scheduleId;
          onRuntimeSnapshotRef.current?.({
            runtime,
            ...(typeof scheduleId === 'string' ? { scheduleId } : {}),
          });
          return;
        }
      }

      if (!isLiveUpdateEvent(frame)) {
        return;
      }

      // Guard non-finite revisions (Number('abc') is NaN): fall back to 0
      // so downstream revision comparisons never see NaN.
      const parsedRevision = Number(frame.revision);
      const nextEvent: LiveUpdateEvent = {
        kind: frame.kind,
        id: frame.id,
        revision: Number.isFinite(parsedRevision) ? parsedRevision : 0,
        event: frame.event,
      };
      if (typeof frame.scheduleId === 'string') {
        nextEvent.scheduleId = frame.scheduleId;
      }
      if (typeof (frame as { createdAt?: unknown }).createdAt === 'string') {
        nextEvent.createdAt = (frame as { createdAt: string }).createdAt;
      }
      queuedEventsRef.current.push(nextEvent);
      flushDebounced();
    };

    const connect = () => {
      if (disposed || !shouldReconnectRef.current) {
        return;
      }

      const previousSocket = socketRef.current;
      if (previousSocket) {
        socketRef.current = null;
        previousSocket.close();
      }

      const url = buildLiveUpdatesUrl({
        ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
        ...(options.attemptId ? { attemptId: options.attemptId } : {}),
        ...(Number.isInteger(lastSeenRuntimeRevisionRef.current)
          ? { lastSeenRuntimeRevision: lastSeenRuntimeRevisionRef.current }
          : {}),
      });
      const socket = new WebSocket(url ?? staticUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed || socketRef.current !== socket) {
          socket.close();
          return;
        }
        reconnectAttemptRef.current = 0;
        everOpened = true;
        attemptsWithoutOpen = 0;
        onConnectedRef.current?.();
      };
      socket.onmessage = (raw) => handleMessage(raw, socket);
      socket.onclose = () => {
        if (socketRef.current !== socket) {
          return;
        }
        socketRef.current = null;
        if (disposed) {
          return;
        }
        if (!everOpened) {
          attemptsWithoutOpen += 1;
        }
        onDisconnectedRef.current?.();
        scheduleReconnect();
      };
      socket.onerror = () => {
        // Best-effort; onclose will handle reconnect.
      };
    };

    connect();

    return () => {
      disposed = true;
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      queuedEventsRef.current = [];
      reconnectAttemptRef.current = 0;
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, [
    debounceMs,
    enabled,
    options.attemptId,
    options.maxConnectAttemptsWithoutOpen,
    options.role,
    options.scheduleId,
  ]);
}
