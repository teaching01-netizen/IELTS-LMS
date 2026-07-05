import { describe, expect, it } from 'vitest';
import type { StudentAttemptMutation } from '../../types/studentAttempt';
import {
  getMutationCoalesceKey,
  coalescePendingMutations,
} from '../studentMutationOutbox';

function makeAnswerMutation(overrides: Partial<StudentAttemptMutation> = {}): StudentAttemptMutation {
  return {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    attemptId: 'attempt-1',
    scheduleId: 'sched-1',
    timestamp: new Date().toISOString(),
    type: 'answer',
    payload: { questionId: 'q1', value: 'A', module: 'reading' },
    ...overrides,
  };
}

function makeWritingMutation(overrides: Partial<StudentAttemptMutation> = {}): StudentAttemptMutation {
  return {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    attemptId: 'attempt-1',
    scheduleId: 'sched-1',
    timestamp: new Date().toISOString(),
    type: 'writing_answer',
    payload: { taskId: 'task1', value: 'essay text' },
    ...overrides,
  };
}

function makeFlagMutation(overrides: Partial<StudentAttemptMutation> = {}): StudentAttemptMutation {
  return {
    id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    attemptId: 'attempt-1',
    scheduleId: 'sched-1',
    timestamp: new Date().toISOString(),
    type: 'flag',
    payload: { questionId: 'q1', value: true, module: 'reading' },
    ...overrides,
  };
}

describe('getMutationCoalesceKey', () => {
  it('returns answer key with questionId only for non-slot answer', () => {
    const mutation = makeAnswerMutation({
      payload: { questionId: 'q1', value: 'A', module: 'reading' },
    });
    expect(getMutationCoalesceKey(mutation)).toBe('answer:q1');
  });

  it('returns answer key with slot index for slot-based answer', () => {
    const mutation = makeAnswerMutation({
      payload: { questionId: 'q1', value: ['A', 'B'], slotIndex: 1, module: 'reading' },
    });
    expect(getMutationCoalesceKey(mutation)).toBe('answer:q1:slot:1');
  });

  it('returns null for answer with empty questionId', () => {
    const mutation = makeAnswerMutation({
      payload: { questionId: '  ', value: 'A', module: 'reading' },
    });
    expect(getMutationCoalesceKey(mutation)).toBeNull();
  });

  it('returns writing_answer key with taskId', () => {
    const mutation = makeWritingMutation({
      payload: { taskId: 'task1', value: 'essay' },
    });
    expect(getMutationCoalesceKey(mutation)).toBe('writing_answer:task1');
  });

  it('returns null for writing_answer with empty taskId', () => {
    const mutation = makeWritingMutation({
      payload: { taskId: '', value: 'essay' },
    });
    expect(getMutationCoalesceKey(mutation)).toBeNull();
  });

  it('returns flag key with questionId', () => {
    const mutation = makeFlagMutation({
      payload: { questionId: 'q1', value: true, module: 'reading' },
    });
    expect(getMutationCoalesceKey(mutation)).toBe('flag:q1');
  });

  it('returns null for flag with empty questionId', () => {
    const mutation = makeFlagMutation({
      payload: { questionId: '  ', value: true, module: 'reading' },
    });
    expect(getMutationCoalesceKey(mutation)).toBeNull();
  });

  it('returns type key for position mutation', () => {
    const mutation: StudentAttemptMutation = {
      id: 'm1',
      attemptId: 'attempt-1',
      scheduleId: 'sched-1',
      timestamp: new Date().toISOString(),
      type: 'position',
      payload: { currentModule: 'reading', currentQuestionId: 'q1' },
    };
    expect(getMutationCoalesceKey(mutation)).toBe('position');
  });

  it('returns type key for network mutation', () => {
    const mutation: StudentAttemptMutation = {
      id: 'm1',
      attemptId: 'attempt-1',
      scheduleId: 'sched-1',
      timestamp: new Date().toISOString(),
      type: 'network',
      payload: { online: true },
    };
    expect(getMutationCoalesceKey(mutation)).toBe('network');
  });

  it('returns type key for device_fingerprint mutation', () => {
    const mutation: StudentAttemptMutation = {
      id: 'm1',
      attemptId: 'attempt-1',
      scheduleId: 'sched-1',
      timestamp: new Date().toISOString(),
      type: 'device_fingerprint',
      payload: { hash: 'abc123' },
    };
    expect(getMutationCoalesceKey(mutation)).toBe('device_fingerprint');
  });

  it('returns null for violation mutation', () => {
    const mutation: StudentAttemptMutation = {
      id: 'm1',
      attemptId: 'attempt-1',
      scheduleId: 'sched-1',
      timestamp: new Date().toISOString(),
      type: 'violation',
      payload: { type: 'tab_switch', severity: 'low' },
    };
    expect(getMutationCoalesceKey(mutation)).toBeNull();
  });

  it('returns null for precheck mutation', () => {
    const mutation: StudentAttemptMutation = {
      id: 'm1',
      attemptId: 'attempt-1',
      scheduleId: 'sched-1',
      timestamp: new Date().toISOString(),
      type: 'precheck',
      payload: { result: {} },
    };
    expect(getMutationCoalesceKey(mutation)).toBeNull();
  });

  it('returns null for heartbeat mutation', () => {
    const mutation: StudentAttemptMutation = {
      id: 'm1',
      attemptId: 'attempt-1',
      scheduleId: 'sched-1',
      timestamp: new Date().toISOString(),
      type: 'heartbeat',
      payload: { status: 'ok' },
    };
    expect(getMutationCoalesceKey(mutation)).toBeNull();
  });
});

describe('coalescePendingMutations', () => {
  it('appends non-coalesceable mutation to pending list', () => {
    const existing: StudentAttemptMutation[] = [
      { id: 'm1', attemptId: 'a', scheduleId: 's', timestamp: '', type: 'violation', payload: { type: 'tab_switch', severity: 'low' } },
    ];
    const next: StudentAttemptMutation = {
      id: 'm2', attemptId: 'a', scheduleId: 's', timestamp: '', type: 'heartbeat', payload: { status: 'ok' },
    };
    const result = coalescePendingMutations(existing, next);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('m2');
  });

  it('replaces older answer mutation for same question', () => {
    const older = makeAnswerMutation({ id: 'older', payload: { questionId: 'q1', value: 'A', module: 'reading' } });
    const newer = makeAnswerMutation({ id: 'newer', payload: { questionId: 'q1', value: 'B', module: 'reading' } });
    const result = coalescePendingMutations([older], newer);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('newer');
  });

  it('replaces older answer mutation for same question+slot', () => {
    const older = makeAnswerMutation({ id: 'older', payload: { questionId: 'q1', value: ['A', 'B'], slotIndex: 0, module: 'reading' } });
    const newer = makeAnswerMutation({ id: 'newer', payload: { questionId: 'q1', value: ['C', 'B'], slotIndex: 0, module: 'reading' } });
    const result = coalescePendingMutations([older], newer);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('newer');
  });

  it('keeps different slot mutations separate', () => {
    const slot0 = makeAnswerMutation({ id: 's0', payload: { questionId: 'q1', value: ['A', ''], slotIndex: 0, module: 'reading' } });
    const slot1 = makeAnswerMutation({ id: 's1', payload: { questionId: 'q1', value: ['', 'B'], slotIndex: 1, module: 'reading' } });
    const result = coalescePendingMutations([slot0], slot1);
    expect(result).toHaveLength(2);
  });

  it('replaces older writing_answer mutation for same task', () => {
    const older = makeWritingMutation({ id: 'older', payload: { taskId: 'task1', value: 'old' } });
    const newer = makeWritingMutation({ id: 'newer', payload: { taskId: 'task1', value: 'new' } });
    const result = coalescePendingMutations([older], newer);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('newer');
  });

  it('replaces older flag mutation for same question', () => {
    const older = makeFlagMutation({ id: 'older', payload: { questionId: 'q1', value: true, module: 'reading' } });
    const newer = makeFlagMutation({ id: 'newer', payload: { questionId: 'q1', value: false, module: 'reading' } });
    const result = coalescePendingMutations([older], newer);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('newer');
  });

  it('replaces position mutation (singleton coalesce key)', () => {
    const older: StudentAttemptMutation = {
      id: 'older', attemptId: 'a', scheduleId: 's', timestamp: '',
      type: 'position', payload: { currentModule: 'reading', currentQuestionId: 'q1' },
    };
    const newer: StudentAttemptMutation = {
      id: 'newer', attemptId: 'a', scheduleId: 's', timestamp: '',
      type: 'position', payload: { currentModule: 'writing', currentQuestionId: 'q2' },
    };
    const result = coalescePendingMutations([older], newer);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('newer');
  });

  it('does not mix answer and flag coalesce keys', () => {
    const answer = makeAnswerMutation({ id: 'ans', payload: { questionId: 'q1', value: 'A', module: 'reading' } });
    const flag = makeFlagMutation({ id: 'flg', payload: { questionId: 'q1', value: true, module: 'reading' } });
    const result = coalescePendingMutations([answer], flag);
    expect(result).toHaveLength(2);
  });

  it('preserves order of non-coalesced mutations', () => {
    const v1: StudentAttemptMutation = {
      id: 'v1', attemptId: 'a', scheduleId: 's', timestamp: '2026-01-01T00:00:00.000Z',
      type: 'violation', payload: { type: 'tab_switch', severity: 'low' },
    };
    const v2: StudentAttemptMutation = {
      id: 'v2', attemptId: 'a', scheduleId: 's', timestamp: '2026-01-01T00:00:01.000Z',
      type: 'violation', payload: { type: 'screenshot', severity: 'medium' },
    };
    const result = coalescePendingMutations([v1], v2);
    expect(result[0].id).toBe('v1');
    expect(result[1].id).toBe('v2');
  });
});
