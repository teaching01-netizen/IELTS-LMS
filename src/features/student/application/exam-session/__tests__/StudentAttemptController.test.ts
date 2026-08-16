import { describe, expect, it, vi } from 'vitest';
import { createStudentAttemptController } from '../StudentAttemptController';
import { createStudentExamStore, type StudentExamStoreSeed } from '../studentExamStore';
import type { StudentDurabilityPort } from '../../../contracts/exam-session/StudentDurabilityPort';
import type { StudentMutationOutbox } from '../../../contracts/exam-session/StudentMutationOutbox';
import type { StudentAttemptMutation } from '../../../../../types/studentAttempt';

function createSeed(): StudentExamStoreSeed {
  return {
    attemptId: 'attempt-1',
    scheduleId: 'schedule-1',
    candidateId: 'candidate-1',
    phase: 'exam',
    currentModule: 'reading',
    currentQuestionId: 'q1',
    answers: {},
    writingAnswers: {},
    flags: {},
    runtimeSnapshot: null,
    displayTimeRemaining: null,
    syncState: 'idle',
    pendingMutationCount: 0,
    acceptedThroughSeq: 0,
  };
}

function createMutation(): StudentAttemptMutation {
  return {
    id: 'mutation-1',
    attemptId: 'attempt-1',
    scheduleId: 'schedule-1',
    timestamp: '2026-08-16T00:00:00.000Z',
    type: 'answer',
    payload: { questionId: 'q1', value: 'FINAL', module: 'reading' },
  };
}

describe('student attempt controller', () => {
  it('persists an enqueued mutation before flushing transport', async () => {
    const store = createStudentExamStore(createSeed());
    const pending: StudentAttemptMutation[] = [];
    const outbox: StudentMutationOutbox = {
      enqueue: (mutation) => pending.push(mutation),
      flush: vi.fn(async () => {
        pending.length = 0;
        return true;
      }),
      pendingCount: () => pending.length,
    };
    const durability: StudentDurabilityPort = {
      readPendingMutations: async () => pending,
      persistPendingMutations: async () => undefined,
      persistAttempt: async () => undefined,
      flushPendingMutations: vi.fn(async () => true),
    };

    const controller = createStudentAttemptController({ store, durability, outbox });
    await controller.enqueue(createMutation());

    expect(store.getState().persistence).toMatchObject({
      syncState: 'saving',
      pendingMutationCount: 1,
    });
    await expect(controller.flushPending()).resolves.toBe(true);
    expect(durability.flushPendingMutations).toHaveBeenCalledWith('attempt-1');
    expect(store.getState().persistence).toMatchObject({
      syncState: 'saved',
      pendingMutationCount: 0,
    });
  });

  it('does not flush transport when the durability barrier fails', async () => {
    const store = createStudentExamStore(createSeed());
    const outbox: StudentMutationOutbox = {
      enqueue: async () => undefined,
      flush: vi.fn(async () => true),
      pendingCount: () => 1,
    };
    const durability: StudentDurabilityPort = {
      readPendingMutations: async () => [],
      persistPendingMutations: async () => undefined,
      persistAttempt: async () => undefined,
      flushPendingMutations: async () => false,
    };

    const controller = createStudentAttemptController({ store, durability, outbox });

    await expect(controller.flushPending()).resolves.toBe(false);
    expect(outbox.flush).not.toHaveBeenCalled();
    expect(store.getState().persistence.syncState).toBe('error');
  });
});
