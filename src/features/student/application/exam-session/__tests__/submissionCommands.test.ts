import { describe, expect, it, vi } from 'vitest';
import { createStudentExamStore } from '../studentExamStoreFactory';
import { createStudentSubmissionCommands } from '../submissionCommands';

function createStore() {
  return createStudentExamStore({
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
  });
}

describe('student submission commands', () => {
  it('commits drafts and flushes durability before submitting', async () => {
    const order: string[] = [];
    const commands = createStudentSubmissionCommands({
      store: createStore(),
      drafts: {
        async commitAll() {
          order.push('commit');
        },
        async flushDurability() {
          order.push('durability');
        },
      },
      transport: {
        async flushPending() {
          order.push('flush');
          return true;
        },
        async submit() {
          order.push('submit');
          return true;
        },
      },
    });

    await expect(commands.requestSubmit()).resolves.toEqual({ kind: 'submitted' });
    expect(order).toEqual(['commit', 'durability', 'flush', 'submit']);
  });

  it('does not report completion when the durability barrier fails', async () => {
    const submit = vi.fn(async () => true);
    const store = createStore();
    const commands = createStudentSubmissionCommands({
      store,
      drafts: {
        async commitAll() {},
        async flushDurability() {},
      },
      transport: {
        async flushPending() {
          return false;
        },
        submit,
      },
    });

    await expect(commands.requestSubmit()).resolves.toEqual({
      kind: 'blocked',
      reason: 'durability_failed',
    });
    expect(submit).not.toHaveBeenCalled();
    expect(store.getState().persistence.syncState).toBe('error');
  });
});
