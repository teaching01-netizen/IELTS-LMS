import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveUpdates } from '../useLiveUpdates';

/**
 * Phase 3: `role` describes the caller to the server; it does not disable
 * transport. The old contract ("student role reports disconnected without
 * opening a socket") made the student channel permanently poll-only, so a
 * proctor's Start reached a waiting student up to a poll window late.
 */

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

  close() {
    this.onclose?.(new CloseEvent('close'));
  }

  send() {}
}

describe('useLiveUpdates role + connect budget', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // @ts-expect-error test shim: deterministic WebSocket.
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it('opens the socket for a student when the caller enables it', () => {
    const onEvent = vi.fn();
    const onConnected = vi.fn();
    renderHook(() =>
      useLiveUpdates({
        role: 'student',
        scheduleId: 'sched-1',
        attemptId: 'attempt-1',
        enabled: true,
        onConnected,
        onEvent,
      }),
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toContain('scheduleId=sched-1');
    expect(MockWebSocket.instances[0]?.url).toContain('attemptId=attempt-1');

    MockWebSocket.instances[0]?.open();
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it('stays disconnected without opening when the caller disables it', () => {
    const onEvent = vi.fn();
    const onDisconnected = vi.fn();
    renderHook(() =>
      useLiveUpdates({
        role: 'student',
        scheduleId: 'sched-1',
        enabled: false,
        onDisconnected,
        onEvent,
      }),
    );

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(onDisconnected).not.toHaveBeenCalled();
  });

  // STUDENT_WS=gone answers 410 before the upgrade and a browser cannot see
  // that status, so the client spends a bounded budget and then hands the
  // session to the poll (onDisconnected already fired: no silent hole).
  it('stops after the connect budget when it never opened', () => {
    const onEvent = vi.fn();
    const onDisconnected = vi.fn();
    const onConnectExhausted = vi.fn();
    renderHook(() =>
      useLiveUpdates({
        role: 'student',
        scheduleId: 'sched-1',
        enabled: true,
        maxConnectAttemptsWithoutOpen: 3,
        onDisconnected,
        onConnectExhausted,
        onEvent,
      }),
    );

    // Five retries' worth of backoff (500 + 1000 + 2000 + ... capped at 10s).
    for (let i = 0; i < 6; i++) {
      MockWebSocket.instances[MockWebSocket.instances.length - 1]?.close();
      vi.advanceTimersByTime(15_000);
    }

    expect(MockWebSocket.instances).toHaveLength(3);
    expect(onDisconnected.mock.calls.length).toBeGreaterThanOrEqual(3);
    // The budget being spent is a rollout signal, reported exactly once (the
    // check runs on every reconnect attempt, so a second call would mean the
    // hook kept trying after it gave up).
    expect(onConnectExhausted).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying after a drop when the socket had already opened', () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useLiveUpdates({
        role: 'student',
        scheduleId: 'sched-1',
        enabled: true,
        maxConnectAttemptsWithoutOpen: 3,
        onEvent,
      }),
    );

    MockWebSocket.instances[0]?.open();
    for (let i = 0; i < 6; i++) {
      MockWebSocket.instances[MockWebSocket.instances.length - 1]?.close();
      vi.advanceTimersByTime(15_000);
    }

    // A real outage after a healthy connection never exhausts the budget.
    expect(MockWebSocket.instances.length).toBeGreaterThan(3);
  });
});
