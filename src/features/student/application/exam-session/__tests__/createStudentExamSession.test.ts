import { describe, expect, it } from 'vitest';
import { createStudentExamSession } from '../createStudentExamSession';
import type { StudentExamStoreSeed } from '../studentExamStore';

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

describe('student exam session application', () => {
  it('composes scoped answer and navigation commands without React', async () => {
    const session = createStudentExamSession({ seed: createSeed(), module: 'reading' });

    await session.answers.setObjectiveAnswer('q1', 'FINAL');
    session.navigation.setModule('writing', 'task-1');
    session.navigation.setQuestion('task-2');

    expect(session.store.getState().attempt.answers.q1).toBe('FINAL');
    expect(session.store.getState().navigation).toEqual({
      currentModule: 'writing',
      currentQuestionId: 'task-2',
    });
  });
});
