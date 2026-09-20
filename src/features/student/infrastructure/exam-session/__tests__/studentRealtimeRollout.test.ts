import { describe, expect, it } from 'vitest';
import { resolveStudentRealtimeTransport } from '../studentRealtimeRollout';

describe('student realtime rollout', () => {
  it('defaults to the poll-only posture', () => {
    // The rollback position must be what a missing/typo'd flag resolves to:
    // a partially deployed flag can never open a socket fleet.
    expect(resolveStudentRealtimeTransport(undefined)).toBe('poll');
    expect(resolveStudentRealtimeTransport(null)).toBe('poll');
    expect(resolveStudentRealtimeTransport('')).toBe('poll');
    expect(resolveStudentRealtimeTransport('poll')).toBe('poll');
    expect(resolveStudentRealtimeTransport('true')).toBe('poll');
    expect(resolveStudentRealtimeTransport(true)).toBe('poll');
    expect(resolveStudentRealtimeTransport('websocket')).toBe('websocket');
    expect(resolveStudentRealtimeTransport(' WebSocket ')).toBe('websocket');
  });
});
