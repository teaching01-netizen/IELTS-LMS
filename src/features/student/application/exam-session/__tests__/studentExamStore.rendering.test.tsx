import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { describe, expect, it } from 'vitest';
import {
  selectDisplayTimeRemaining,
  selectQuestionAnswer,
} from '../examSessionSelectors';
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
    displayTimeRemaining: 30,
    syncState: 'idle',
    pendingMutationCount: 0,
    acceptedThroughSeq: 0,
  };
}

describe('student exam selector rendering', () => {
  it('isolates timer and question renders from unrelated session updates', () => {
    const store = createStudentExamStore(createSeed());
    const renders = { timer: 0, q1: 0, q2: 0 };

    function TimerConsumer() {
      const value = useStore(store, selectDisplayTimeRemaining);
      useEffect(() => {
        renders.timer += 1;
      }, [value]);
      return null;
    }

    function QuestionOneConsumer() {
      const value = useStore(store, selectQuestionAnswer('q1'));
      useEffect(() => {
        renders.q1 += 1;
      }, [value]);
      return null;
    }

    function QuestionTwoConsumer() {
      const value = useStore(store, selectQuestionAnswer('q2'));
      useEffect(() => {
        renders.q2 += 1;
      }, [value]);
      return null;
    }

    render(
      <>
        <TimerConsumer />
        <QuestionOneConsumer />
        <QuestionTwoConsumer />
      </>,
    );
    const initialRenders = { ...renders };
    expect(initialRenders.timer).toBeGreaterThan(0);
    expect(initialRenders.q1).toBe(initialRenders.timer);
    expect(initialRenders.q2).toBe(initialRenders.timer);

    act(() => {
      store.getState().actions.setRuntimeSnapshot(null, 29);
    });
    expect(renders.timer).toBe(initialRenders.timer + 1);
    expect(renders.q1).toBe(initialRenders.q1);
    expect(renders.q2).toBe(initialRenders.q2);

    act(() => {
      store.getState().actions.setObjectiveAnswer('q1', 'FINAL');
    });
    expect(renders.timer).toBe(initialRenders.timer + 1);
    expect(renders.q1).toBe(initialRenders.q1 + 1);
    expect(renders.q2).toBe(initialRenders.q2);
  });
});
