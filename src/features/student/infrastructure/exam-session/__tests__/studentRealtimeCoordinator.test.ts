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
});
