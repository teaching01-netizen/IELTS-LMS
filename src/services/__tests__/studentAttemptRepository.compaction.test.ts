import { describe, expect, it } from 'vitest';
import type { StudentAttempt, StudentAttemptMutation } from '../../types/studentAttempt';
import { replayPendingMutationsOntoAttempt, compactSubmittedAttempt } from '../studentAttemptRepository';

function makeAttempt(overrides?: Partial<StudentAttempt>): StudentAttempt {
  return {
    id: 'attempt-1',
    scheduleId: 'sched-1',
    studentKey: 'student-key',
    examId: 'exam-1',
    examTitle: 'Exam',
    candidateId: 'cand-1',
    candidateName: 'Candidate',
    candidateEmail: 'candidate@example.com',
    phase: 'exam',
    currentModule: 'reading',
    currentQuestionId: 'q1',
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    proctorStatus: 'active' as any,
    proctorNote: null,
    proctorUpdatedAt: null,
    proctorUpdatedBy: null,
    lastWarningId: null,
    lastAcknowledgedWarningId: null,
    submittedAt: null,
    integrity: {
      preCheck: null,
      deviceFingerprintHash: null,
      clientSessionId: null,
      lastDisconnectAt: null,
      lastReconnectAt: null,
      lastHeartbeatAt: null,
      lastHeartbeatStatus: 'idle',
    },
    recovery: {
      finalSubmissionPending: false,
      lastRecoveredAt: null,
      lastLocalMutationAt: null,
      lastPersistedAt: null,
      lastDroppedMutations: null,
      pendingMutationCount: 0,
      serverAcceptedThroughSeq: 0,
      clientSessionId: null,
      syncState: 'idle',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('replayPendingMutationsOntoAttempt', () => {
  it('returns same attempt when mutations are empty', () => {
    const attempt = makeAttempt();
    const result = replayPendingMutationsOntoAttempt(attempt, []);
    expect(result).toBe(attempt);
  });

  it('applies answer mutations to attempt', () => {
    const attempt = makeAttempt({ answers: {} });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'attempt-1', scheduleId: 'sched-1', timestamp: '',
        type: 'answer', payload: { questionId: 'q1', value: 'A', module: 'reading' },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.answers).toEqual({ q1: 'A' });
  });

  it('applies writing_answer mutations to attempt', () => {
    const attempt = makeAttempt({ writingAnswers: {} });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'attempt-1', scheduleId: 'sched-1', timestamp: '',
        type: 'writing_answer', payload: { taskId: 'task1', value: 'essay text' },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.writingAnswers).toEqual({ task1: 'essay text' });
  });

  it('applies flag mutations to attempt', () => {
    const attempt = makeAttempt({ flags: {} });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'attempt-1', scheduleId: 'sched-1', timestamp: '',
        type: 'flag', payload: { questionId: 'q1', value: true, module: 'reading' },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.flags).toEqual({ q1: true });
  });

  it('applies position mutations to attempt', () => {
    const attempt = makeAttempt({ currentModule: 'reading', currentQuestionId: 'q1' });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'attempt-1', scheduleId: 'sched-1', timestamp: '',
        type: 'position', payload: { currentModule: 'writing', currentQuestionId: 'q2', phase: 'exam' },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.currentModule).toBe('writing');
    expect(result.currentQuestionId).toBe('q2');
  });

  it('merges multiple answer mutations for different questions', () => {
    const attempt = makeAttempt({ answers: { q1: 'old' } });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'answer', payload: { questionId: 'q1', value: 'new', module: 'reading' },
      },
      {
        id: 'm2', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'answer', payload: { questionId: 'q2', value: 'B', module: 'reading' },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.answers).toEqual({ q1: 'new', q2: 'B' });
  });

  it('skips mutations with invalid questionId', () => {
    const attempt = makeAttempt({ answers: {} });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'answer', payload: { questionId: 123 as any, value: 'A', module: 'reading' },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.answers).toEqual({});
  });

  it('skips writing_answer mutations with invalid taskId', () => {
    const attempt = makeAttempt({ writingAnswers: {} });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'writing_answer', payload: { taskId: 123 as any, value: 'text' },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.writingAnswers).toEqual({});
  });

  it('skips flag mutations with invalid value', () => {
    const attempt = makeAttempt({ flags: {} });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'flag', payload: { questionId: 'q1', value: 'not-boolean' as any, module: 'reading' },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.flags).toEqual({});
  });

  it('sets pendingMutationCount on recovery', () => {
    const attempt = makeAttempt();
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'answer', payload: { questionId: 'q1', value: 'A', module: 'reading' },
      },
      {
        id: 'm2', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'answer', payload: { questionId: 'q2', value: 'B', module: 'reading' },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.recovery.pendingMutationCount).toBe(2);
  });

  it('handles position mutation with null currentQuestionId', () => {
    const attempt = makeAttempt({ currentQuestionId: 'q1' });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'position', payload: { currentModule: 'writing', currentQuestionId: null },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.currentQuestionId).toBeNull();
  });

  it('ignores position mutation with invalid phase', () => {
    const attempt = makeAttempt({ phase: 'exam' });
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'position', payload: { currentModule: 'writing', phase: 'invalid_phase' as any },
      },
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.phase).toBe('exam');
  });

  it('ignores unknown mutation types', () => {
    const attempt = makeAttempt();
    const mutations: StudentAttemptMutation[] = [
      {
        id: 'm1', attemptId: 'a', scheduleId: 's', timestamp: '',
        type: 'sync' as any, payload: {},
      } as any,
    ];
    const result = replayPendingMutationsOntoAttempt(attempt, mutations);
    expect(result.recovery.pendingMutationCount).toBe(1);
  });
});

describe('compactSubmittedAttempt', () => {
  it('creates receipt from submitted attempt', () => {
    const attempt = makeAttempt({
      phase: 'post-exam',
      submittedAt: '2026-01-01T01:00:00.000Z',
      recovery: {
        lastRecoveredAt: null,
        lastLocalMutationAt: null,
        lastPersistedAt: null,
        lastDroppedMutations: null,
        pendingMutationCount: 0,
        serverAcceptedThroughSeq: 42,
        clientSessionId: null,
        syncState: 'saved',
      },
    });
    (attempt as any).finalSubmission = {
      submissionId: 'sub-1',
      submittedAt: '2026-01-01T01:00:00.000Z',
    };

    const receipt = compactSubmittedAttempt(attempt);
    expect(receipt.attemptId).toBe('attempt-1');
    expect(receipt.scheduleId).toBe('sched-1');
    expect(receipt.submittedAt).toBe('2026-01-01T01:00:00.000Z');
    expect(receipt.submissionId).toBe('sub-1');
    expect(receipt.lastServerAcceptedSeq).toBe(42);
  });

  it('throws for attempt without submittedAt', () => {
    const attempt = makeAttempt({ submittedAt: null });
    expect(() => compactSubmittedAttempt(attempt)).toThrow(
      'Cannot compact an attempt without submission receipt metadata.',
    );
  });

  it('throws for attempt without submissionId', () => {
    const attempt = makeAttempt({
      submittedAt: '2026-01-01T01:00:00.000Z',
    });
    (attempt as any).finalSubmission = { submissionId: null };
    expect(() => compactSubmittedAttempt(attempt)).toThrow(
      'Cannot compact an attempt without submission receipt metadata.',
    );
  });
});
