import { describe, expect, it } from 'vitest';
import { resolveStudentRealtimeTransport } from '../studentRealtimeRollout';

describe('student realtime rollout', () => {
  it('defaults SAT to the live socket and keeps other providers on polling', () => {
    expect(resolveStudentRealtimeTransport(undefined, 'sat')).toBe('websocket');
    expect(resolveStudentRealtimeTransport(null, 'sat')).toBe('websocket');
    expect(resolveStudentRealtimeTransport('', 'sat')).toBe('websocket');
    expect(resolveStudentRealtimeTransport(undefined, 'ielts')).toBe('poll');
    expect(resolveStudentRealtimeTransport(undefined, 'act')).toBe('poll');
  });

  it('keeps explicit transport settings authoritative and invalid values fail closed', () => {
    expect(resolveStudentRealtimeTransport('poll', 'sat')).toBe('poll');
    expect(resolveStudentRealtimeTransport('true', 'sat')).toBe('poll');
    expect(resolveStudentRealtimeTransport(true, 'sat')).toBe('poll');
    expect(resolveStudentRealtimeTransport('websocket', 'ielts')).toBe('websocket');
    expect(resolveStudentRealtimeTransport(' WebSocket ', 'sat')).toBe('websocket');
  });
});
