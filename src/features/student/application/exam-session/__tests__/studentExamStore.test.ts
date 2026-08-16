import { describe, expect, it } from 'vitest';
import type { ModuleType } from '../../../../../types';
import { createStudentExamStore, type StudentExamStoreSeed } from '../studentExamStoreFactory';

function seed(attemptId: string, module: ModuleType = 'reading'): StudentExamStoreSeed {
  return {
    attemptId,
    scheduleId: 'schedule-1',
    candidateId: `candidate-${attemptId}`,
    phase: 'exam',
    currentModule: module,
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

describe('student exam session store', () => {
  it('isolates answer state by attempt identity', () => {
    const first = createStudentExamStore(seed('attempt-a'));
    const second = createStudentExamStore(seed('attempt-b'));

    first.getState().actions.setObjectiveAnswer('q1', 'FINAL');

    expect(first.getState().attempt.answers.q1).toBe('FINAL');
    expect(second.getState().attempt.answers.q1).toBeUndefined();
    expect(first.getState().identity.scopeKey).not.toBe(second.getState().identity.scopeKey);
  });

  it('notifies a question selector only when that question changes', () => {
    const store = createStudentExamStore(seed('attempt-a'));
    const observed: Array<string | undefined> = [];
    const unsubscribe = store.subscribe(
      (state) => state.attempt.answers.q1,
      (answer) => observed.push(typeof answer === 'string' ? answer : undefined),
    );

    store.getState().actions.setObjectiveAnswer('q2', 'OTHER');
    store.getState().actions.setObjectiveAnswer('q1', 'FINAL');
    unsubscribe();

    expect(observed).toEqual(['FINAL']);
  });

  it('keeps preview state isolated from a real attempt', () => {
    const preview = createStudentExamStore({
      ...seed('preview'),
      attemptId: null,
      candidateId: null,
      scheduleId: 'preview',
    });
    const realAttempt = createStudentExamStore(seed('attempt-a'));

    preview.getState().actions.setObjectiveAnswer('q1', 'PREVIEW');

    expect(preview.getState().attempt.answers.q1).toBe('PREVIEW');
    expect(realAttempt.getState().attempt.answers.q1).toBeUndefined();
  });
});
