import { describe, expect, it } from 'vitest';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import { getVerifiedTerminalState } from '../terminalState';

const activeAttempt = {
  id: 'attempt-1',
  phase: 'exam',
  proctorStatus: 'active',
  deliveryStatus: 'running',
  submittedAt: null,
} as StudentAttempt;

describe('getVerifiedTerminalState', () => {
  it('classifies attempt and runtime terminal states consistently', () => {
    expect(getVerifiedTerminalState({
      attempt: { ...activeAttempt, phase: 'post-exam' },
      runtime: null,
    })).toBe('completed');
    expect(getVerifiedTerminalState({
      attempt: activeAttempt,
      runtime: { status: 'completed' },
    })).toBe('completed');
    expect(getVerifiedTerminalState({
      attempt: activeAttempt,
      runtime: { status: 'cancelled' },
    })).toBe('terminated');
    expect(getVerifiedTerminalState({
      attempt: { ...activeAttempt, deliveryStatus: 'cancelled' },
      runtime: null,
    })).toBe('terminated');
  });
});
