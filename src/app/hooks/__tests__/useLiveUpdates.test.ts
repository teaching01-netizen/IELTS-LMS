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
    // @ts-expect-error test shim
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

  it('stops reconnecting after an error frame', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const onEvent = vi.fn();
    renderHook(() => useLiveUpdates({ scheduleId: 'sched-1', onEvent }));

    const socket = MockWebSocket.instances[0];
    socket.open();
    socket.emitMessage({ type: 'error', code: 'SCHEDULE_CAPACITY', message: 'too many' });

    vi.advanceTimersByTime(20_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(onEvent).not.toHaveBeenCalled();
  });
});
