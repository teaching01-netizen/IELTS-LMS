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

export function useLiveUpdates(options: {
  scheduleId?: string;
  attemptId?: string;
  lastSeenRuntimeRevision?: number;
  enabled?: boolean;
  debounceMs?: number;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onRuntimeSnapshot?: (payload: { scheduleId?: string; runtime: unknown }) => void;
  onEvent: (event: LiveUpdateEvent) => void;
}) {
  const enabled = options.enabled ?? true;
  const debounceMs = options.debounceMs ?? 250;
  const onEventRef = useRef(options.onEvent);
  const lastEventRef = useRef<LiveUpdateEvent | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const onConnectedRef = useRef(options.onConnected);
  const onDisconnectedRef = useRef(options.onDisconnected);
  const onRuntimeSnapshotRef = useRef(options.onRuntimeSnapshot);

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
    const url = buildLiveUpdatesUrl({
      ...(options.scheduleId ? { scheduleId: options.scheduleId } : {}),
      ...(options.attemptId ? { attemptId: options.attemptId } : {}),
      ...(Number.isInteger(options.lastSeenRuntimeRevision)
        ? { lastSeenRuntimeRevision: options.lastSeenRuntimeRevision }
        : {}),
    });
    if (!enabled || !url) {
      return () => undefined;
    }

    shouldReconnectRef.current = true;

    const scheduleReconnect = () => {
      if (!shouldReconnectRef.current) {
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
        connect();
      }, delayMs);
    };

    const flushDebounced = () => {
      if (debounceMs <= 0) {
        const event = lastEventRef.current;
        lastEventRef.current = null;
        if (event) {
          onEventRef.current(event);
        }
        return;
      }

      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        const event = lastEventRef.current;
        lastEventRef.current = null;
        debounceTimerRef.current = null;
        if (event) {
          onEventRef.current(event);
        }
      }, debounceMs);
    };

    const handleMessage = (raw: MessageEvent) => {
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
          shouldReconnectRef.current = false;
          socketRef.current?.close();
          socketRef.current = null;
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

      const nextEvent: LiveUpdateEvent = {
        kind: frame.kind,
        id: frame.id,
        revision: Number(frame.revision),
        event: frame.event,
      };
      if (typeof frame.scheduleId === 'string') {
        nextEvent.scheduleId = frame.scheduleId;
      }
      lastEventRef.current = nextEvent;
      flushDebounced();
    };

    const connect = () => {
      if (!shouldReconnectRef.current) {
        return;
      }

      if (socketRef.current) {
        socketRef.current.close();
      }

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        onConnectedRef.current?.();
      };
      socket.onmessage = handleMessage;
      socket.onclose = () => {
        socketRef.current = null;
        onDisconnectedRef.current?.();
        scheduleReconnect();
      };
      socket.onerror = () => {
        // Best-effort; onclose will handle reconnect.
      };
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      lastEventRef.current = null;
      reconnectAttemptRef.current = 0;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [debounceMs, enabled, options.attemptId, options.lastSeenRuntimeRevision, options.scheduleId]);
}
