import { describe, expect, it, vi } from 'vitest';
import type { StudentAttempt, StudentAttemptMutation } from '../../types/studentAttempt';
import {
  PendingMutationDurabilityMirror,
  buildQueuedMutationUpdate,
  createStudentMutationOutbox,
} from '../studentMutationOutbox';

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

describe('studentMutationOutbox.flushNow', () => {
  it('flushes pending mutations and clears the queue on success', async () => {
    const attempt = makeAttempt();
    const syncAttemptState = vi.fn();
    const setRuntimeAttemptSyncState = vi.fn();
    const setStorageDurabilityBlocking = vi.fn();

    const saveAttempt = vi.fn(async () => {});
    const clearPendingMutations = vi.fn(async () => {});
    const getAttemptsByScheduleId = vi.fn(async () => [attempt]);

    const mirror = new PendingMutationDurabilityMirror({
      debounceMs: 100,
      getAttempt: () => attempt,
      savePendingMutations: vi.fn(async () => {}),
      clearPendingMutations: vi.fn(async () => {}),
      setStorageDurabilityBlocking,
      onPersistError: vi.fn(),
      onPendingMutationCountChange: vi.fn(),
    });

    const mutation: StudentAttemptMutation = {
      id: 'm1',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: new Date().toISOString(),
      type: 'answer',
      payload: { questionId: 'q1', value: 'A', module: 'reading' },
    };
    mirror.setPendingMutations([mutation], {
      durableWriteMode: 'immediate',
      includesAnswerMutation: true,
      awaitPersistence: true,
      source: 'mutation',
    });

    const outbox = createStudentMutationOutbox({
      getAttempt: () => attempt,
      syncAttemptState,
      setRuntimeAttemptSyncState,
      setStorageDurabilityBlocking,
      mirror,
      persistenceEnabled: () => true,
      isOnline: () => true,
      hasAttemptCredential: () => true,
      refreshAttemptCredentialForAttempt: vi.fn(async () => true),
      backendConflictReason: () => null,
      clearAttemptMutationWatermark: vi.fn(),
      saveAttempt,
      clearPendingMutations,
      getAttemptsByScheduleId,
    });

    const ok = await outbox.flushNow();
    expect(ok).toBe(true);
    // Finding #6: the persisted record must never claim `saved` before the
    // delivery attempt resolved. Two honest records: a pre-send `saving`
    // record carrying the TRUE pending count, then `saved` only after the
    // mutation queue was cleared.
    expect(saveAttempt).toHaveBeenCalledTimes(2);
    expect((saveAttempt.mock.calls[0]?.[0] as StudentAttempt).recovery).toMatchObject({
      syncState: 'saving',
      pendingMutationCount: 1,
    });
    expect((saveAttempt.mock.calls[1]?.[0] as StudentAttempt).recovery).toMatchObject({
      syncState: 'saved',
      pendingMutationCount: 0,
    });
    expect(clearPendingMutations).toHaveBeenCalledTimes(1);
    expect(mirror.getPendingMutations()).toHaveLength(0);
  });

  it('forces immediate durability and zero-delay flush when requested near boundary', () => {
    const mutation: StudentAttemptMutation = {
      id: 'm-boundary',
      attemptId: 'attempt-1',
      scheduleId: 'sched-1',
      timestamp: new Date().toISOString(),
      type: 'answer',
      payload: {
        questionId: 'q1',
        value: 'A',
        module: 'reading',
        interactionType: 'typing',
      },
    };

    const result = buildQueuedMutationUpdate({
      currentAttempt: { id: 'attempt-1', scheduleId: 'sched-1', currentModule: 'reading' },
      pending: [],
      mutation,
      online: true,
      flushDelayMs: 400,
      forceImmediateDurability: true,
    });

    expect(result.durableWriteMode).toBe('immediate');
    expect(result.flush).toMatchObject({ kind: 'objective', delayMs: 0 });
  });
});
