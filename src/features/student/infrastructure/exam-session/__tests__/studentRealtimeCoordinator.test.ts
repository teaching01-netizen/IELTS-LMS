import { describe, expect, it, vi } from 'vitest';
import { createStudentRealtimeCoordinator } from '../studentRealtimeCoordinator';

describe('student realtime coordinator', () => {
  it('ignores a runtime snapshot older than the applied revision', () => {
    const update = vi.fn();
    const coordinator = createStudentRealtimeCoordinator({
      scheduleId: 'schedule-1',
      candidateId: 'candidate-1',
      cache: {
        invalidateLiveSession: vi.fn(),
        updateLiveRuntime: update,
      },
    });

    expect(coordinator.handleRuntimeSnapshot({ revision: 42, runtime: { id: 'new' } })).toBe('applied');
    expect(coordinator.handleRuntimeSnapshot({ revision: 41, runtime: { id: 'old' } })).toBe('ignored');
    expect(update).toHaveBeenCalledTimes(1);
  });

  // Monotonic revisions: once a frame is applied, a re-delivered frame for the
  // same revision must not start a second refresh.
  it('ignores a schedule_runtime event at or below the applied revision', () => {
    const invalidate = vi.fn();
    const coordinator = createStudentRealtimeCoordinator({
      scheduleId: 'schedule-1',
      candidateId: 'candidate-1',
      cache: { invalidateLiveSession: invalidate, updateLiveRuntime: vi.fn() },
    });

    expect(
      coordinator.handleEvent({ kind: 'schedule_runtime', id: 'schedule-1', revision: 11, event: 'start_runtime' }),
    ).toBe('invalidated');
    expect(invalidate).toHaveBeenCalledTimes(1);

    coordinator.handleRuntimeSnapshot({ revision: 11, runtime: { id: 'rt' } });
    expect(
      coordinator.handleEvent({ kind: 'schedule_runtime', id: 'schedule-1', revision: 11, event: 'start_runtime' }),
    ).toBe('ignored');
    expect(
      coordinator.handleEvent({ kind: 'schedule_runtime', id: 'schedule-1', revision: 10, event: 'start_runtime' }),
    ).toBe('ignored');
    expect(invalidate).toHaveBeenCalledTimes(1);

    // A newer transition still refreshes.
    expect(
      coordinator.handleEvent({ kind: 'schedule_runtime', id: 'schedule-1', revision: 12, event: 'pause_runtime' }),
    ).toBe('invalidated');
  });

  // Attempt revisions are their own sequence: gating them on the runtime
  // revision would silently drop the student's own answer updates.
  it('never gates attempt events on the runtime revision', () => {
    const invalidate = vi.fn();
    const coordinator = createStudentRealtimeCoordinator({
      scheduleId: 'schedule-1',
      candidateId: 'candidate-1',
      cache: { invalidateLiveSession: invalidate, updateLiveRuntime: vi.fn() },
    });
    coordinator.handleRuntimeSnapshot({ revision: 50, runtime: { id: 'rt' } });

    expect(
      coordinator.handleEvent({ kind: 'attempt', id: 'attempt-1', revision: 3, event: 'answer_updated' }),
    ).toBe('invalidated');
  });

  // Reconnect + poll racing: the socket re-opening invalidates the cached live
  // session (one revalidation) and the snapshot it carries commits once; a
  // wake-up frame for that same revision adds nothing.
  it('converges once when a reconnect and a poll land together', () => {
    const invalidate = vi.fn();
    const update = vi.fn();
    const coordinator = createStudentRealtimeCoordinator({
      scheduleId: 'schedule-1',
      candidateId: 'candidate-1',
      cache: { invalidateLiveSession: invalidate, updateLiveRuntime: update },
    });

    coordinator.handleSocketConnected();
    expect(coordinator.handleRuntimeSnapshot({ revision: 5, runtime: { id: 'rt' } })).toBe('applied');
    expect(
      coordinator.handleEvent({ kind: 'schedule_runtime', id: 'schedule-1', revision: 5, event: 'start_runtime' }),
    ).toBe('ignored');

    expect(update).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('uses accelerated polling when the live socket is unavailable', () => {
    const coordinator = createStudentRealtimeCoordinator({
      scheduleId: 'schedule-1',
      candidateId: 'candidate-1',
      cache: {
        invalidateLiveSession: vi.fn(),
        updateLiveRuntime: vi.fn(),
      },
    });

    coordinator.handleSocketDisconnected();

    expect(coordinator.getPollingPolicy('live')).toEqual({ intervalMs: 1500, maxIntervalMs: 3000 });
  });

  // A cohort waiting on Start has no runtime row yet (`null`) or a
  // `not_started` one; a paused cohort is waiting on Resume. Without a socket
  // the poll is their only live channel, so it must be as tight as mid-exam:
  // the 15-25s cadence here is what made a proctor's Start reach the room up
  // to 25s late.
  it('polls a waiting cohort as tightly as a live one when the socket is unavailable', () => {
    const coordinator = createStudentRealtimeCoordinator({
      scheduleId: 'schedule-1',
      candidateId: 'candidate-1',
      cache: { invalidateLiveSession: vi.fn(), updateLiveRuntime: vi.fn() },
    });

    for (const status of [null, 'not_started', 'paused'] as const) {
      expect(coordinator.getPollingPolicy(status)).toEqual({ intervalMs: 1500, maxIntervalMs: 3000 });
    }
    // A terminal runtime has nothing left to observe.
    expect(coordinator.getPollingPolicy('completed')).toEqual({ intervalMs: 15_000, maxIntervalMs: 25_000 });
    expect(coordinator.getPollingPolicy('cancelled')).toEqual({ intervalMs: 15_000, maxIntervalMs: 25_000 });
  });

  it('rests lazily while the socket carries the transitions', () => {
    const coordinator = createStudentRealtimeCoordinator({
      scheduleId: 'schedule-1',
      candidateId: 'candidate-1',
      cache: { invalidateLiveSession: vi.fn(), updateLiveRuntime: vi.fn() },
    });
    coordinator.handleSocketConnected();

    expect(coordinator.getPollingPolicy('live')).toEqual({ intervalMs: 20_000, maxIntervalMs: 30_000 });
    expect(coordinator.getPollingPolicy(null)).toEqual({ intervalMs: 15_000, maxIntervalMs: 25_000 });
    expect(coordinator.getPollingPolicy('not_started')).toEqual({ intervalMs: 15_000, maxIntervalMs: 25_000 });

    // Losing the socket tightens the waiting cohort immediately.
    coordinator.handleSocketDisconnected();
    expect(coordinator.getPollingPolicy('not_started')).toEqual({ intervalMs: 1500, maxIntervalMs: 3000 });
  });
});
