import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveUpdates } from '../useLiveUpdates';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.(new Event('open'));
  }

  emitMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  close() {
    this.onclose?.(new CloseEvent('close'));
  }

  send() {}
}

describe('useLiveUpdates', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    // @ts-expect-error test shim: replace browser WebSocket with deterministic mock implementation.
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it('ignores connected frames', () => {
    const onEvent = vi.fn();
    renderHook(() => useLiveUpdates({ scheduleId: 'sched-1', onEvent }));

    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.emitMessage({ type: 'connected', scheduleId: 'sched-1' });

    vi.advanceTimersByTime(1_000);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('includes attemptId in the websocket URL when provided', () => {
    const onEvent = vi.fn();
    renderHook(() => useLiveUpdates({ scheduleId: 'sched-1', attemptId: 'attempt-1', onEvent }));

    expect(MockWebSocket.instances[0]?.url).toContain('scheduleId=sched-1');
    expect(MockWebSocket.instances[0]?.url).toContain('attemptId=attempt-1');
  });

  it('debounces bursts into one callback', () => {
    const onEvent = vi.fn();
    renderHook(() => useLiveUpdates({ scheduleId: 'sched-1', onEvent, debounceMs: 250 }));

    const socket = MockWebSocket.instances[0];
    socket.open();

    socket.emitMessage({ kind: 'schedule_runtime', id: 'sched-1', revision: 1, event: 'start_runtime' });
    socket.emitMessage({ kind: 'schedule_runtime', id: 'sched-1', revision: 2, event: 'pause_runtime' });

    vi.advanceTimersByTime(249);
    expect(onEvent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      kind: 'schedule_runtime',
      id: 'sched-1',
      revision: 2,
      event: 'pause_runtime',
    });
  });

  it('reconnects with exponential backoff on close', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const onEvent = vi.fn();
    renderHook(() => useLiveUpdates({ scheduleId: 'sched-1', onEvent }));

    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].close();

    vi.advanceTimersByTime(499);
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('ignores a close event from a socket replaced by a dependency change', () => {
    const onEvent = vi.fn();
    const { rerender } = renderHook(
      ({ revision }) =>
        useLiveUpdates({
          scheduleId: revision === 0 ? 'sched-1' : 'sched-2',
          onEvent,
        }),
      { initialProps: { revision: 0 } },
    );

    const firstSocket = MockWebSocket.instances[0];
    rerender({ revision: 1 });
    expect(MockWebSocket.instances).toHaveLength(2);

    // Real browser sockets can dispatch this asynchronously after cleanup.
    firstSocket.onclose?.(new CloseEvent('close'));
    vi.advanceTimersByTime(20_000);

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('does not reconnect when only the runtime snapshot revision changes', () => {
    const onEvent = vi.fn();
    const { rerender } = renderHook(
      ({ revision }) =>
        useLiveUpdates({
          scheduleId: 'sched-1',
          lastSeenRuntimeRevision: revision,
          onEvent,
        }),
      { initialProps: { revision: 0 } },
    );

    rerender({ revision: 1 });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain('lastSeenRuntimeRevision=0');
  });

  it('stops reconnecting after a fatal error frame and reports it via onError', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const onEvent = vi.fn();
    const onError = vi.fn();
    renderHook(() => useLiveUpdates({ scheduleId: 'sched-1', onEvent, onError }));

    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.emitMessage({ type: 'error', code: 'SCHEDULE_CAPACITY', message: 'too many' });

    vi.advanceTimersByTime(20_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({ code: 'SCHEDULE_CAPACITY', message: 'too many' });
  });

  it('reconnects after a recoverable error frame and reports it via onError', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const onEvent = vi.fn();
    const onError = vi.fn();
    renderHook(() => useLiveUpdates({ scheduleId: 'sched-1', onEvent, onError }));

    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.emitMessage({ type: 'error', code: 'TRANSIENT', message: 'try again' });

    expect(onError).toHaveBeenCalledWith({ code: 'TRANSIENT', message: 'try again' });
    // Recoverable errors schedule a reconnect with backoff (500ms base).
    vi.advanceTimersByTime(500);
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
  });

  it('delivers bursts for distinct students instead of only the last event', () => {
    const onEvent = vi.fn();
    renderHook(() => useLiveUpdates({ scheduleId: 'sched-1', onEvent, debounceMs: 250 }));

    const socket = MockWebSocket.instances[0];
    socket.open();

    socket.emitMessage({ kind: 'attempt', id: 'student-1', revision: 1, event: 'answer_updated' });
    socket.emitMessage({ kind: 'attempt', id: 'student-2', revision: 1, event: 'answer_updated' });

    vi.advanceTimersByTime(250);
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('guards non-numeric revisions instead of emitting NaN', () => {
    const onEvent = vi.fn();
    renderHook(() => useLiveUpdates({ scheduleId: 'sched-1', onEvent, debounceMs: 0 }));

    const socket = MockWebSocket.instances[0];
    socket.open();

    socket.emitMessage({ kind: 'attempt', id: 'student-1', revision: 'not-a-number', event: 'answer_updated' });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ revision: 0 }));
    expect(Number.isNaN(onEvent.mock.calls[0]?.[0]?.revision)).toBe(false);
  });
});
