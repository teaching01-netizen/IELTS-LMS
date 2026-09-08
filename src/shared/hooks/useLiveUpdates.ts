import { useEffect, useRef } from 'react';

export interface LiveUpdateEvent {
  kind: string;
  id: string;
  revision: number;
  event: string;
  scheduleId?: string;
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

// Plan C1: STUDENT_ROLE_SOCKET_RETIRED — student sockets are retired in favor
// of the versioned runtime poll (GET .../runtime?sinceRevision=). The student
// exam hook must NOT open this socket (pass role: 'proctor-observer' only for
// staff surfaces, or leave enabled=false). This hook stays for proctor-only
// live updates; student callers migrate to createStudentRuntimePoll.
export const STUDENT_ROLE_SOCKET_RETIRED = 'STUDENT_WS_RETIRED' as const;

export function useLiveUpdates(options: {
  scheduleId?: string;
  attemptId?: string;
  lastSeenRuntimeRevision?: number;
  enabled?: boolean;
  debounceMs?: number;
  // role gates the socket: 'student' short-circuits to disconnected (the
  // server answers 410 STUDENT_WS_RETIRED; do not burn reconnect loops).
  // Staff surfaces pass 'proctor-observer'. Defaults to proctor-observer
  // for backward compatibility with existing staff callers.
  role?: 'student' | 'proctor-observer';
  onConnected?: () => void;
  onDisconnected?: () => void;
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
    onRuntimeSnapshotRef.current = options.onRuntimeSnapshot;
  }, [options.onRuntimeSnapshot]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    lastSeenRuntimeRevisionRef.current = options.lastSeenRuntimeRevision;
  }, [options.lastSeenRuntimeRevision]);

  useEffect(() => {
    // Plan C1: student role never opens the socket. Report disconnected so
    // callers fall back to the runtime poll (no 410 round-trip, no retry
    // storm, zero student sockets — the 1M enabler).
    if (options.role === 'student') {
      onDisconnectedRef.current?.();
      return () => undefined;
    }
    const staticUrl = buildLiveUpdatesUrl({
      ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
      ...(options.attemptId ? { attemptId: options.attemptId } : {}),
    });
    if (!enabled || !staticUrl) {
      return () => undefined;
    }

    let disposed = false;
    shouldReconnectRef.current = true;

    const scheduleReconnect = () => {
      if (disposed || !shouldReconnectRef.current) {
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
  }, [debounceMs, enabled, options.attemptId, options.scheduleId]);
}
