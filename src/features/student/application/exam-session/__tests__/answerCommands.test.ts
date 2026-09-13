import { describe, expect, it } from 'vitest';
import type { StudentAttemptMutation } from '../../../../../types/studentAttempt';
import { createStudentAnswerCommands } from '../answerCommands';
import { createStudentExamStore, type StudentExamStoreSeed } from '../studentExamStore';

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

describe('student answer commands', () => {
  it('optimistically stores the resolved slot value and preserves mutation metadata', async () => {
    const store = createStudentExamStore(createSeed());
    const mutations: StudentAttemptMutation[] = [];
    const commands = createStudentAnswerCommands({
      store,
      module: 'reading',
      outbox: {
        enqueue: (mutation) => mutations.push(mutation),
        flush: async () => true,
        pendingCount: () => mutations.length,
      },
      createMutationId: () => 'mutation-1',
      now: () => '2026-08-16T00:00:00.000Z',
    });

    await commands.setObjectiveAnswer('q1', ['ignored', 'FINAL'], {
      slotIndex: 1,
      slotCount: 2,
      slotValue: 'FINAL',
      interactionType: 'typing',
    });

    expect(store.getState().attempt.answers.q1).toEqual(['', 'FINAL']);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.payload).toMatchObject({
      questionId: 'q1',
      value: ['', 'FINAL'],
      slotIndex: 1,
      slotCount: 2,
      slotValue: 'FINAL',
      interactionType: 'typing',
    });
  });

  it('persists science set/replace/clear with module scope and stable mutation ids (AT-07)', async () => {
    const seed = createSeed();
    seed.currentModule = 'science';
    const store = createStudentExamStore(seed);
    const mutations: StudentAttemptMutation[] = [];
    let nextId = 0;
    const commands = createStudentAnswerCommands({
      store,
      module: 'science',
      outbox: {
        enqueue: (mutation) => mutations.push(mutation),
        flush: async () => true,
        pendingCount: () => mutations.length,
      },
      createMutationId: () => `science-mutation-${(nextId += 1)}`,
      now: () => '2026-09-12T00:00:00.000Z',
    });

    // Set then replace then clear: canonical value converges, module stays science.
    await commands.setObjectiveAnswer('sci-q1', 'opt-a', { interactionType: 'discrete' });
    expect(store.getState().attempt.answers['sci-q1']).toBe('opt-a');
    await commands.setObjectiveAnswer('sci-q1', 'opt-b', { interactionType: 'discrete' });
    expect(store.getState().attempt.answers['sci-q1']).toBe('opt-b');
    await commands.setObjectiveAnswer('sci-q1', '', { interactionType: 'discrete' });
    expect(store.getState().attempt.answers['sci-q1']).toBe('');
    expect(mutations).toHaveLength(3);
    for (const [index, mutation] of mutations.entries()) {
      expect(mutation.id).toBe(`science-mutation-${index + 1}`);
      expect(mutation.payload).toMatchObject({ questionId: 'sci-q1', module: 'science' });
    }
    // Stable ids: no two mutations share an id (idempotent retry key).
    const ids = new Set(mutations.map((mutation) => mutation.id));
    expect(ids.size).toBe(3);
  });

  it('updates writing answers and flags through the same scoped command surface', async () => {
    const store = createStudentExamStore(createSeed());
    const commands = createStudentAnswerCommands({ store, module: 'reading' });

    await commands.setWritingAnswer('task-1', 'draft');
    await commands.toggleFlag('q1');

    expect(store.getState().attempt.writingAnswers).toEqual({ 'task-1': 'draft' });
    expect(store.getState().attempt.flags).toEqual({ q1: true });
  });
});
