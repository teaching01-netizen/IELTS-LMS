import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLiveUpdates } from '../useLiveUpdates';

// Plan C1: student role never opens a socket (server would 410). Proctor
// role keeps today's behavior.
describe('useLiveUpdates role gate', () => {
  it('student role reports disconnected without opening a socket', () => {
    const openSpy = vi.spyOn(globalThis, 'WebSocket' as never);
    const onDisconnected = vi.fn();
    renderHook(() =>
      useLiveUpdates({
        role: 'student',
        scheduleId: 'sched-1',
        enabled: true,
        onDisconnected,
        onEvent: () => {},
      }),
    );
    expect(onDisconnected).toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
