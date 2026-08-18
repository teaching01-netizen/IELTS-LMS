import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  StudentExamSessionProvider,
  useStudentExamSession,
  useStudentExamSessionStore,
} from '../exam-session/StudentExamSessionProvider';
import type { StudentExamStore, StudentExamStoreSeed } from '@student/application/exam-session/studentExamStore';

function makeSeed(overrides: Partial<StudentExamStoreSeed> = {}): StudentExamStoreSeed {
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
    displayTimeRemaining: 600,
    syncState: 'saved',
    pendingMutationCount: 0,
    acceptedThroughSeq: 1,
    ...overrides,
  };
}

function NavigationProbe() {
  const currentModule = useStudentExamSession((state) => state.navigation.currentModule);
  const currentQuestionId = useStudentExamSession((state) => state.navigation.currentQuestionId);
  return <div data-testid="navigation">{`${currentModule}:${currentQuestionId}`}</div>;
}

let storeRef: StudentExamStore | null = null;
function CaptureStore() {
  storeRef = useStudentExamSessionStore();
  return null;
}

describe('StudentExamSessionProvider navigation ownership', () => {
  it('keeps user navigation when a refresh seed carries an older persisted position', () => {
    storeRef = null;
    const { rerender } = render(
      <StudentExamSessionProvider seed={makeSeed()}>
        <CaptureStore />
        <NavigationProbe />
      </StudentExamSessionProvider>,
    );

    expect(screen.getByTestId('navigation')).toHaveTextContent('reading:q1');

    // The student navigates to q3 during the exam; the store is the live UI source.
    act(() => {
      storeRef?.getState().actions.setNavigation('reading', 'q3');
    });
    expect(screen.getByTestId('navigation')).toHaveTextContent('reading:q3');

    // A runtime poll arrives with a fresh runtime snapshot but the server attempt
    // still reports the older persisted position (position mutation still in flight).
    rerender(
      <StudentExamSessionProvider
        seed={makeSeed({
          currentQuestionId: 'q1',
          runtimeSnapshot: {
            id: 'runtime-1',
            scheduleId: 'schedule-1',
            examId: 'exam-1',
            examTitle: 'Test Exam',
            cohortName: 'Cohort A',
            deliveryMode: 'proctor_start',
            status: 'live',
            actualStartAt: '2026-01-01T00:00:00.000Z',
            actualEndAt: null,
            activeSectionKey: 'reading',
            currentSectionKey: 'reading',
            currentSectionRemainingSeconds: 540,
            waitingForNextSection: false,
            isOverrun: false,
            totalPausedSeconds: 0,
            sections: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:05.000Z',
          },
        })}
      >
        <CaptureStore />
        <NavigationProbe />
      </StudentExamSessionProvider>,
    );

    // The stale persisted position must not yank the student back to q1.
    expect(screen.getByTestId('navigation')).toHaveTextContent('reading:q3');
  });
});