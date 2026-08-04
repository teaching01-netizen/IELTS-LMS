import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentAppWrapper } from '../StudentAppWrapper';
import { createDefaultConfig } from '../../../constants/examDefaults';
import * as studentAttemptRepoModule from '../../../services/studentAttemptRepository';
import { studentAttemptRepository } from '../../../services/studentAttemptRepository';
import type { ExamState } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';
import { EXAM_VIEWPORT_CONTENT } from '../examPageZoomGuard';

function setWritingEditorText(editor: HTMLElement, value: string) {
  if (editor instanceof HTMLTextAreaElement) {
    fireEvent.change(editor, { target: { value } });
    return;
  }
  editor.textContent = value;
  fireEvent.input(editor);
}

function createWritingRuntimeSnapshot(): ExamSessionRuntime {
  return {
    id: 'runtime-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    examTitle: 'Mock Exam',
    cohortName: 'Cohort A',
    deliveryMode: 'proctor_start',
    status: 'live',
    actualStartAt: '2026-01-01T00:00:00.000Z',
    actualEndAt: null,
    activeSectionKey: 'writing',
    currentSectionKey: 'writing',
    currentSectionRemainingSeconds: 300,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    sections: [
      {
        sectionKey: 'writing',
        label: 'Writing',
        order: 1,
        plannedDurationMinutes: 60,
        gapAfterMinutes: 0,
        status: 'live',
        availableAt: '2026-01-01T00:00:00.000Z',
        actualStartAt: '2026-01-01T00:00:00.000Z',
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
        completionReason: undefined,
        projectedStartAt: '2026-01-01T00:00:00.000Z',
        projectedEndAt: '2026-01-01T01:00:00.000Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createReadingRuntimeSnapshot(): ExamSessionRuntime {
  return {
    id: 'runtime-reading-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    examTitle: 'Mock Exam',
    cohortName: 'Cohort A',
    deliveryMode: 'proctor_start',
    status: 'live',
    actualStartAt: '2026-01-01T00:00:00.000Z',
    actualEndAt: null,
    activeSectionKey: 'reading',
    currentSectionKey: 'reading',
    currentSectionRemainingSeconds: 300,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    sections: [
      {
        sectionKey: 'reading',
        label: 'Reading',
        order: 1,
        plannedDurationMinutes: 60,
        gapAfterMinutes: 0,
        status: 'live',
        availableAt: '2026-01-01T00:00:00.000Z',
        actualStartAt: '2026-01-01T00:00:00.000Z',
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
        completionReason: undefined,
        projectedStartAt: '2026-01-01T00:00:00.000Z',
        projectedEndAt: '2026-01-01T01:00:00.000Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createWritingAttemptSnapshot(): StudentAttempt {
  return {
    id: 'attempt-1',
    scheduleId: 'sched-1',
    studentKey: 'student-sched-1-alice',
    examId: 'exam-1',
    examTitle: 'Mock Exam',
    candidateId: 'alice',
    candidateName: 'Alice Roe',
    candidateEmail: 'alice@example.com',
    phase: 'exam',
    currentModule: 'writing',
    currentQuestionId: 'task1',
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    proctorStatus: 'active',
    proctorNote: null,
    proctorUpdatedAt: null,
    proctorUpdatedBy: null,
    lastWarningId: null,
    lastAcknowledgedWarningId: null,
    submittedAt: null,
    integrity: {
      preCheck: {
        completedAt: '2026-01-01T00:00:00.000Z',
        browserFamily: 'chrome',
        browserVersion: 120,
        screenDetailsSupported: true,
        heartbeatReady: true,
        acknowledgedSafariLimitation: false,
        checks: [],
      },
      deviceFingerprintHash: null,
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
      syncState: 'saved',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createReadingAttemptSnapshot(): StudentAttempt {
  const attempt = createWritingAttemptSnapshot();
  return {
    ...attempt,
    id: 'attempt-reading-1',
    phase: 'exam',
    currentModule: 'reading',
    currentQuestionId: 'rq-1',
    answers: {},
    writingAnswers: {},
  };
}

function installVisualViewportMock(initialHeight: number, initialOffsetTop = 0) {
  const visualViewportTarget = new EventTarget();
  let height = initialHeight;
  let offsetTop = initialOffsetTop;
  let scale = 1;
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() {
        return height;
      },
      get offsetTop() {
        return offsetTop;
      },
      get scale() {
        return scale;
      },
      addEventListener: visualViewportTarget.addEventListener.bind(visualViewportTarget),
      removeEventListener: visualViewportTarget.removeEventListener.bind(visualViewportTarget),
    },
  });

  return {
    setHeight(nextHeight: number) {
      height = nextHeight;
    },
    setOffsetTop(nextOffsetTop: number) {
      offsetTop = nextOffsetTop;
    },
    setScale(nextScale: number) {
      scale = nextScale;
    },
    dispatchResize() {
      visualViewportTarget.dispatchEvent(new Event('resize'));
    },
    dispatchScroll() {
      visualViewportTarget.dispatchEvent(new Event('scroll'));
    },
    restore() {
      if (originalVisualViewport) {
        Object.defineProperty(window, 'visualViewport', originalVisualViewport);
      } else {
        Reflect.deleteProperty(window, 'visualViewport');
      }
    },
  };
}

describe('StudentApp runtime-backed mode', () => {
  it('guards native page zoom only during the exam lifecycle', () => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
      ?? document.head.appendChild(document.createElement('meta'));
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1.0';

    const { unmount } = render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={createWritingAttemptSnapshot()}
        runtimeSnapshot={createWritingRuntimeSnapshot()}
      />,
    );

    expect(viewport).toHaveAttribute('content', EXAM_VIEWPORT_CONTENT);
    expect(document.documentElement).toHaveClass('student-exam-active');
    expect(document.body).toHaveClass('student-exam-active');
    unmount();
    expect(viewport).toHaveAttribute('content', 'width=device-width, initial-scale=1.0');
    expect(document.documentElement).not.toHaveClass('student-exam-active');
    expect(document.body).not.toHaveClass('student-exam-active');
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            attempt: {
              attemptToken: 'test-token',
              expiresAt: '2099-01-01T00:00:00.000Z',
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    vi.spyOn(studentAttemptRepository as any, 'getPendingMutations').mockResolvedValue([]);
    vi.spyOn(studentAttemptRepository as any, 'saveAttempt').mockResolvedValue();
    vi.spyOn(studentAttemptRepository as any, 'savePendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository as any, 'clearPendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository as any, 'getAttemptsByScheduleId').mockResolvedValue([]);
  });

  const state: ExamState = {
    title: 'Mock Exam',
    type: 'Academic',
    activeModule: 'writing',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config: createDefaultConfig('Academic', 'Academic'),
    reading: { passages: [] },
    listening: { parts: [] },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: [],
    },
  };

  const readingState: ExamState = {
    ...state,
    activeModule: 'reading',
    config: {
      ...state.config,
      sections: {
        ...state.config.sections,
        reading: {
          ...state.config.sections.reading,
          enabled: true,
          allowedQuestionTypes: ['SHORT_ANSWER'],
        },
        listening: {
          ...state.config.sections.listening,
          enabled: false,
        },
        writing: {
          ...state.config.sections.writing,
          enabled: false,
        },
        speaking: {
          ...state.config.sections.speaking,
          enabled: false,
        },
      },
    },
    reading: {
      passages: [
        {
          id: 'p1',
          title: 'Passage 1',
          content: 'Read and answer.',
          images: [],
          wordCount: 3,
          blocks: [
            {
              id: 'reading-short-1',
              type: 'SHORT_ANSWER',
              instruction: 'Answer the question.',
              questions: [
                {
                  id: 'rq-1',
                  prompt: 'Type one word',
                  correctAnswer: 'alpha',
                  answerRule: 'ONE_WORD',
                },
              ],
            },
          ],
        },
      ],
    },
  };

  it('renders the persistent highlight tool in Reading exam mode without a floating toolbar', async () => {
    render(
      <StudentAppWrapper
        state={readingState}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={createReadingAttemptSnapshot()}
        runtimeSnapshot={createReadingRuntimeSnapshot()}
      />,
    );

    await screen.findByRole('timer', { name: /time remaining/i });
    expect(screen.getByRole('button', { name: 'Highlight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose highlight color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erase highlights' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply yellow highlight/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(screen.getByRole('button', { name: 'Highlighting' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Highlight' })).toBeInTheDocument());
  });

  it('renders the persistent highlight tools in Writing exam mode', async () => {
    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={createWritingAttemptSnapshot()}
        runtimeSnapshot={createWritingRuntimeSnapshot()}
      />,
    );

    await screen.findByRole('timer', { name: /time remaining/i });
    expect(screen.getByRole('button', { name: 'Highlight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose highlight color' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erase highlights' })).toBeInTheDocument();
  });

  it('never writes shell geometry during reused-tab and keyboard viewport events', async () => {
    const visualViewport = installVisualViewportMock(640, 120);
    const root = document.documentElement;
    root.style.removeProperty('--student-viewport-height');
    root.style.removeProperty('--student-viewport-offset-top');

    try {
      const { container } = render(
        <StudentAppWrapper
          state={state}
          onExit={() => {}}
          scheduleId="sched-1"
          attemptSnapshot={createWritingAttemptSnapshot()}
          runtimeSnapshot={createWritingRuntimeSnapshot()}
        />,
      );

      const editor = await screen.findByRole('textbox', { name: /writing response/i });
      const shell = container.querySelector<HTMLElement>('.student-exam-shell');
      expect(shell).not.toBeNull();
      expect(shell?.style.height).toBe('');

      act(() => {
        visualViewport.setHeight(900);
        visualViewport.setOffsetTop(0);
        visualViewport.dispatchResize();
        editor.focus();
        visualViewport.setHeight(560);
        visualViewport.setOffsetTop(180);
        visualViewport.dispatchResize();
        editor.blur();
        visualViewport.setHeight(900);
        visualViewport.dispatchResize();
        visualViewport.setOffsetTop(0);
        visualViewport.dispatchScroll();
      });

      expect(root.style.getPropertyValue('--student-viewport-height')).toBe('');
      expect(root.style.getPropertyValue('--student-viewport-offset-top')).toBe('');
      expect(shell?.style.height).toBe('');
      expect(shell?.style.top).toBe('');
    } finally {
      visualViewport.restore();
    }
  });
  it('shows the waiting overlay when the runtime locks the student between sections', () => {
    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: null,
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 300,
      waitingForNextSection: true,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'completed',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: '2026-01-01T01:00:00.000Z',
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: 'auto_timeout',
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T01:00:00.000Z',
    };

    const { container } = render(
      <StudentAppWrapper state={state} onExit={() => {}} runtimeSnapshot={runtimeSnapshot} />,
    );

    expect(container).toBeInTheDocument();
  });

  it('passes exam security settings into the Writing editor', async () => {
    const writingState: ExamState = {
      ...state,
      config: createDefaultConfig('Academic', 'Academic'),
    };
    writingState.config.security.preventAutocorrect = true;
    writingState.config.security.preventAutofill = true;

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'writing',
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 300,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'writing',
      currentQuestionId: 'task1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      submittedAt: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(
      <StudentAppWrapper
        state={writingState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: /writing response/i });
    expect(editor).toHaveAttribute('spellcheck', 'false');
    expect(editor).toHaveAttribute('autocorrect', 'off');
    expect(editor).toHaveAttribute('autocapitalize', 'off');
  });

  it('commits the mounted writing editor draft before runtime final submission', async () => {
    const writingState: ExamState = {
      ...state,
      config: createDefaultConfig('Academic', 'Academic'),
    };

    const liveRuntimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'writing',
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 120,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const completedRuntimeSnapshot: ExamSessionRuntime = {
      ...liveRuntimeSnapshot,
      status: 'completed',
      actualEndAt: '2026-01-01T01:00:00.000Z',
      activeSectionKey: null,
      currentSectionRemainingSeconds: 0,
      sections: liveRuntimeSnapshot.sections.map((section) => ({
        ...section,
        status: 'completed',
        actualEndAt: '2026-01-01T01:00:00.000Z',
        completionReason: 'auto_timeout',
      })),
      updatedAt: '2026-01-01T01:00:00.000Z',
    };
    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'writing',
      currentQuestionId: 'task1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      submittedAt: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const submittedAttempt: StudentAttempt = {
      ...attemptSnapshot,
      phase: 'post-exam',
      submittedAt: '2026-01-01T01:00:01.000Z',
      recovery: {
        ...attemptSnapshot.recovery,
        syncState: 'saved',
      },
    };
    vi.spyOn(studentAttemptRepository as any, 'submitAttempt').mockResolvedValue(submittedAttempt);

    const { rerender } = render(
      <StudentAppWrapper
        state={writingState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={liveRuntimeSnapshot}
      />,
    );

    const editor = (await screen.findByRole('textbox', { name: /writing response/i })) as HTMLElement;
    setWritingEditorText(editor, 'Visible iPad final draft');

    rerender(
      <StudentAppWrapper
        state={writingState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={completedRuntimeSnapshot}
      />,
    );

    await waitFor(() => {
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalledWith(
        'attempt-1',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'writing_answer',
            payload: expect.objectContaining({
              taskId: 'task1',
              value: 'Visible iPad final draft',
            }),
          }),
        ]),
      );
    });
  });

  it('keeps local objective text input stable during same-attempt refresh', async () => {
    const user = userEvent.setup();

    const objectiveState: ExamState = {
      ...state,
      activeModule: 'reading',
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    let attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: { q1: 'SERVER_SEED' },
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 1800,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const { rerender } = render(
      <StudentAppWrapper
        state={objectiveState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    const objectiveInput = screen.getByLabelText('Answer for question 1') as HTMLInputElement;
    await user.clear(objectiveInput);
    await user.type(objectiveInput, 'LOCAL_TYPED');
    expect(objectiveInput.value).toBe('LOCAL_TYPED');

    attemptSnapshot = {
      ...attemptSnapshot,
      answers: { q1: 'SERVER_REFRESH' },
      updatedAt: '2026-01-01T00:00:02.000Z',
    };
    rerender(
      <StudentAppWrapper
        state={objectiveState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    expect((screen.getByLabelText('Answer for question 1') as HTMLInputElement).value).toBe('LOCAL_TYPED');
  });

  it('preserves sibling slot values during rapid multi-slot typing and focus switching', async () => {
    const user = userEvent.setup();
    const slotState: ExamState = {
      ...state,
      activeModule: 'reading',
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SENTENCE_COMPLETION',
                instruction: 'Complete the sentences.',
                questions: [
                  {
                    id: 'q-slots',
                    sentence: 'The ____ fox jumped over the ____ dog.',
                    blanks: ['blank-1', 'blank-2'],
                    correctAnswers: [['quick'], ['lazy']],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q-slots:0',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 1800,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(
      <StudentAppWrapper
        state={slotState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    const slotOne = screen.getByLabelText('Answer for question 1') as HTMLInputElement;
    const slotTwo = screen.getByLabelText('Answer for question 2') as HTMLInputElement;

    await user.type(slotOne, 'quick');
    await user.click(slotTwo);
    await user.type(slotTwo, 'lazy');

    expect(slotOne.value).toBe('quick');
    expect(slotTwo.value).toBe('lazy');

    await waitFor(() => {
      const persistedMutations = vi
        .mocked(studentAttemptRepository.savePendingMutations)
        .mock.calls.flatMap(([, mutations]) => mutations ?? []);
      const mergedSlotMutation = persistedMutations.find((mutation) => {
        if (mutation.type !== 'answer') {
          return false;
        }
        const payload = mutation.payload as { questionId?: unknown; value?: unknown };
        return (
          payload.questionId === 'q-slots' &&
          Array.isArray(payload.value) &&
          payload.value[0] === 'quick' &&
          payload.value[1] === 'lazy'
        );
      });
      expect(mergedSlotMutation).toBeDefined();
    });
  });

  it('keeps local writing editor content stable during same-attempt refresh', async () => {
    const writingState: ExamState = {
      ...state,
      activeModule: 'writing',
    };

    let attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'writing',
      currentQuestionId: 'task1',
      answers: {},
      writingAnswers: { task1: '<p>Server seed</p>' },
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'writing',
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 1800,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const { rerender } = render(
      <StudentAppWrapper
        state={writingState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    const editor = (await screen.findByRole('textbox', { name: /writing response/i })) as HTMLTextAreaElement;
    setWritingEditorText(editor, 'Server seed LOCAL_TYPED');
    expect(editor.value).toContain('LOCAL_TYPED');

    attemptSnapshot = {
      ...attemptSnapshot,
      writingAnswers: { task1: '<p>Server refresh</p>' },
      updatedAt: '2026-01-01T00:00:03.000Z',
    };
    rerender(
      <StudentAppWrapper
        state={writingState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    expect(((await screen.findByRole('textbox', { name: /writing response/i })) as HTMLTextAreaElement).value).toContain('LOCAL_TYPED');
  });

  it('preserves a writing task draft after navigating away and back in runtime-backed mode', async () => {
    const user = userEvent.setup();
    const writingState: ExamState = {
      ...state,
      activeModule: 'writing',
    };
    const attemptSnapshot = createWritingAttemptSnapshot();

    render(
      <StudentAppWrapper
        state={writingState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={createWritingRuntimeSnapshot()}
      />,
    );

    const editor = (await screen.findByRole('textbox', { name: /writing response/i })) as HTMLTextAreaElement;
    await user.type(editor, 'Task 1 draft before switch');
    expect(editor.value).toBe('Task 1 draft before switch');

    await user.click(screen.getByRole('button', { name: 'Task 2' }));
    await user.click(screen.getByRole('button', { name: 'Task 1' }));

    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement).value).toBe(
        'Task 1 draft before switch',
      );
    });
  });

  it('keeps local choice selection stable during same-attempt refresh', async () => {
    const user = userEvent.setup();

    const tfngState: ExamState = {
      ...state,
      activeModule: 'reading',
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'tfng-1',
                type: 'TFNG',
                instruction: 'Answer the question.',
                mode: 'TFNG',
                questions: [
                  {
                    id: 'q1',
                    statement: 'The statement is true.',
                    correctAnswer: 'T',
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    let attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: { q1: 'T' },
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 1800,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const { rerender } = render(
      <StudentAppWrapper
        state={tfngState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    const radioOptions = screen.getAllByRole('radio') as HTMLInputElement[];
    await user.click(radioOptions[1]!);
    const falseOption = radioOptions[1]!;
    expect(falseOption.checked).toBe(true);

    attemptSnapshot = {
      ...attemptSnapshot,
      answers: { q1: 'T' },
      updatedAt: '2026-01-01T00:00:04.000Z',
    };
    rerender(
      <StudentAppWrapper
        state={tfngState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    expect((screen.getAllByRole('radio') as HTMLInputElement[])[1]?.checked).toBe(true);
  });

  it('does not render the completion screen when attempt phase is post-exam but terminal is unverified', async () => {
    vi.useFakeTimers();

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'writing',
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 300,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'post-exam',
      currentModule: 'writing',
      currentQuestionId: 'task-1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [
        {
          id: 'violation-1',
          type: 'TAB_SWITCH',
          severity: 'high',
          timestamp: '2026-01-01T00:00:00.000Z',
          description: 'Tab switched',
        },
      ],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      submittedAt: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: false,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByText(/Examination Complete!/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Tab switched/i)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('renders the completion screen when submittedAt is present (finished early while runtime live)', async () => {
    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'writing',
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 300,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'writing',
      currentQuestionId: 'task-1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      submittedAt: '2026-01-01T00:30:00.000Z',
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: false,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Examination Complete!/i)).toBeInTheDocument();
    });
  });

  it('locks the UI when Finish is clicked in runtime-backed mode', async () => {
    const user = userEvent.setup();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      'ielts_student_attempt_credentials_v1',
      JSON.stringify([
        {
          attemptId: 'attempt-1',
          scheduleId: 'sched-1',
          attemptToken: 'token-1',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    );

    const submitState: ExamState = {
      title: 'Submit Exam',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'p1',
      activeListeningPartId: 'l1',
      config: createDefaultConfig('Academic', 'Academic'),
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: {
        task1Prompt: 'Task 1 prompt',
        task2Prompt: 'Task 2 prompt',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Submit Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 1800,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const submittedAttempt: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Submit Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'post-exam',
      currentModule: 'reading',
      currentQuestionId: null,
      answers: { q1: 'seeded answer' },
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
        lastDisconnectAt: null,
        lastReconnectAt: null,
        lastHeartbeatAt: null,
        lastHeartbeatStatus: 'idle',
      },
      recovery: {
        lastRecoveredAt: null,
        lastLocalMutationAt: null,
        lastPersistedAt: '2026-01-01T00:10:00.000Z',
        lastDroppedMutations: null,
        pendingMutationCount: 0,
        serverAcceptedThroughSeq: 0,
        clientSessionId: null,
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:10:00.000Z',
    };

    const submitAttempt = vi
      .spyOn(studentAttemptRepository as any, 'submitAttempt')
      .mockResolvedValue(submittedAttempt);
    vi.spyOn(studentAttemptRepository as any, 'saveAttempt').mockResolvedValue();
    vi.spyOn(studentAttemptRepository as any, 'clearPendingMutations').mockResolvedValue();

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Submit Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(
      <StudentAppWrapper
        state={submitState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    await user.type(screen.getByLabelText('Answer for question 1'), 'seeded answer');
    await user.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => {
      expect(screen.queryByText(/Waiting for cohort advance/i)).not.toBeInTheDocument();
    });

    expect(submitAttempt).not.toHaveBeenCalled();
    expect(screen.queryByText(/Examination Complete!/i)).not.toBeInTheDocument();
  });

  it('shows a blocking tab-switch warning overlay when tab switching is detected', async () => {
    vi.useFakeTimers();
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.security.tabSwitchRule = 'warn';

    const examState: ExamState = {
      ...state,
      config,
      activeModule: 'reading',
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 600,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: false,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    act(() => {
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(screen.getByText(/Tab switching detected/i)).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /I Understand/i }));
    });

    expect(screen.queryByText(/Tab switching detected/i)).not.toBeInTheDocument();

    hiddenSpy.mockRestore();
    vi.useRealTimers();
  });

  it('shows a blocking black overlay when screenshot shortcut is detected', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.security.tabSwitchRule = 'none';
    config.security.antiScreenshotGuardEnabled = true;

    const examState: ExamState = {
      ...state,
      config,
      activeModule: 'reading',
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 600,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: false,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'PrintScreen',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(screen.getByText(/screen capture blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/screenshot attempt detected/i)).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /continue exam/i }));
    });

    await waitFor(() => {
      expect(screen.queryByText(/screen capture blocked/i)).not.toBeInTheDocument();
    });
  });

  it('does not show screenshot blackout overlay when anti-screenshot guard is disabled', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.security.tabSwitchRule = 'none';
    config.security.antiScreenshotGuardEnabled = false;

    const examState: ExamState = {
      ...state,
      config,
      activeModule: 'reading',
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 600,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const attemptSnapshot = createWritingAttemptSnapshot();
    attemptSnapshot.currentModule = 'reading';
    attemptSnapshot.currentQuestionId = 'q1';

    render(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'PrintScreen',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(screen.queryByText(/screen capture blocked/i)).not.toBeInTheDocument();
  });

  it('auto-submits a runtime-backed section at 00:00 and locks the UI', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.progression.autoSubmit = true;

    const examState: ExamState = {
      ...state,
      config,
      activeModule: 'reading',
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 1,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: null,
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: false,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const { rerender } = render(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    rerender(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={{ ...runtimeSnapshot, currentSectionRemainingSeconds: 0 }}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Waiting for cohort advance/i)).not.toBeInTheDocument();
    });

    expect(screen.queryByText(/Examination Complete!/i)).not.toBeInTheDocument();
  });

  it('auto-submits a runtime-backed section when loading with a server-confirmed 00:00 boundary', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.progression.autoSubmit = true;

    const examState: ExamState = {
      ...state,
      config,
      activeModule: 'reading',
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 0,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: null,
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: false,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    window.sessionStorage.setItem(
      'ielts_student_attempt_credentials_v1',
      JSON.stringify([
        {
          attemptId: attemptSnapshot.id,
          scheduleId: attemptSnapshot.scheduleId,
          attemptToken: 'token-1',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    );
    const saveAttempt = vi.spyOn(studentAttemptRepository as any, 'saveAttempt').mockResolvedValue();

    render(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/Waiting for cohort advance/i)).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(saveAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          currentModule: 'writing',
          phase: 'exam',
          recovery: expect.objectContaining({
            syncState: 'saved',
          }),
        }),
      );
    });
  });

  it('deduplicates rapid Finish clicks while a runtime-backed flush is already in-flight', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      'ielts_student_attempt_credentials_v1',
      JSON.stringify([
        {
          attemptId: 'attempt-1',
          scheduleId: 'sched-1',
          attemptToken: 'token-1',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    );
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.progression.autoSubmit = false;
    config.progression.unansweredSubmissionPolicy = 'allow';
    config.sections.listening.enabled = false;
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;

    const examState: ExamState = {
      title: 'Submit Exam',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'p1',
      activeListeningPartId: 'l1',
      config,
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: {
        task1Prompt: 'Task 1 prompt',
        task2Prompt: 'Task 2 prompt',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 600,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        pendingMutationCount: 1,
        serverAcceptedThroughSeq: 0,
        clientSessionId: null,
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    vi.spyOn(studentAttemptRepository as any, 'getPendingMutations').mockResolvedValue([
      {
        id: 'mutation-1',
        attemptId: attemptSnapshot.id,
        scheduleId: attemptSnapshot.scheduleId,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'answer',
        payload: {
          questionId: 'q1',
          value: 'seeded answer',
          module: 'reading',
        },
      },
    ]);

    let resolveSave: (() => void) | null = null;
    const saveAttempt = vi
      .spyOn(studentAttemptRepository as any, 'saveAttempt')
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    render(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    const finishButton = screen.getByRole('button', { name: 'Finish' });
    fireEvent.click(finishButton);
    fireEvent.click(finishButton);

    await waitFor(() => {
      expect(saveAttempt).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
  });

  it('does not trigger duplicate runtime auto-submit while the first zero-timer flush is still in-flight', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      'ielts_student_attempt_credentials_v1',
      JSON.stringify([
        {
          attemptId: 'attempt-1',
          scheduleId: 'sched-1',
          attemptToken: 'token-1',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    );
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.progression.autoSubmit = true;

    const examState: ExamState = {
      ...state,
      config,
      activeModule: 'reading',
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 1,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        pendingMutationCount: 1,
        serverAcceptedThroughSeq: 0,
        clientSessionId: null,
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    vi.spyOn(studentAttemptRepository as any, 'getPendingMutations').mockResolvedValue([
      {
        id: 'mutation-1',
        attemptId: attemptSnapshot.id,
        scheduleId: attemptSnapshot.scheduleId,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'answer',
        payload: {
          questionId: 'q1',
          value: 'seeded answer',
          module: 'reading',
        },
      },
    ]);

    let resolveSave: (() => void) | null = null;
    const saveAttempt = vi
      .spyOn(studentAttemptRepository as any, 'saveAttempt')
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const { rerender } = render(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });

    const atZeroSnapshot = {
      ...runtimeSnapshot,
      currentSectionRemainingSeconds: 0,
      updatedAt: '2026-01-01T00:00:01.000Z',
    };
    rerender(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={atZeroSnapshot}
      />,
    );

    rerender(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={{
          ...atZeroSnapshot,
          updatedAt: '2026-01-01T00:00:02.000Z',
        }}
      />,
    );

    await waitFor(() => {
      expect(saveAttempt).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
  });

  it('retries auto-submit when flushing pending mutations fails', async () => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    window.sessionStorage.setItem(
      'ielts_student_attempt_credentials_v1',
      JSON.stringify([
        {
          attemptId: 'attempt-1',
          scheduleId: 'sched-1',
          attemptToken: 'token-1',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      ]),
    );

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.progression.autoSubmit = true;

    const examState: ExamState = {
      ...state,
      config,
      activeModule: 'reading',
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 1,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'reading',
          label: 'Reading',
          order: 1,
          plannedDurationMinutes: 60,
          gapAfterMinutes: 0,
          status: 'live',
          availableAt: '2026-01-01T00:00:00.000Z',
          actualStartAt: '2026-01-01T00:00:00.000Z',
          actualEndAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionMinutes: 0,
          completionReason: undefined,
          projectedStartAt: '2026-01-01T00:00:00.000Z',
          projectedEndAt: '2026-01-01T01:00:00.000Z',
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: null,
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: false,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
        deviceFingerprintHash: null,
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
        pendingMutationCount: 1,
        serverAcceptedThroughSeq: 0,
        clientSessionId: null,
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    vi.spyOn(studentAttemptRepository as any, 'getPendingMutations').mockResolvedValue([
      {
        id: 'mutation-1',
        attemptId: attemptSnapshot.id,
        scheduleId: attemptSnapshot.scheduleId,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'answer',
        payload: {
          questionId: 'q1',
          value: 'seeded answer',
          module: 'reading',
        },
      },
    ]);
    const saveAttempt = vi
      .spyOn(studentAttemptRepository as any, 'saveAttempt')
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(undefined);
    vi.spyOn(studentAttemptRepository as any, 'clearPendingMutations').mockResolvedValue();
    vi.spyOn(studentAttemptRepository as any, 'getAttemptsByScheduleId').mockResolvedValue([]);

    const { rerender } = render(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    rerender(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={{ ...runtimeSnapshot, currentSectionRemainingSeconds: 0 }}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(saveAttempt).toHaveBeenCalled();
    expect(screen.queryByText(/Waiting for cohort advance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reconnecting session/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Attempt data is being reconciled before the exam can continue/i),
    ).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('does not show dropped-mutation reconciliation banner to students', () => {
    const runtimeSnapshot = createReadingRuntimeSnapshot();
    const attemptSnapshot: StudentAttempt = {
      ...createReadingAttemptSnapshot(),
      recovery: {
        ...createReadingAttemptSnapshot().recovery,
        lastDroppedMutations: {
          at: '2026-01-01T00:05:00.000Z',
          count: 2,
          fromModule: 'reading',
          toModule: 'listening',
          reason: 'SECTION_ADVANCED',
          affectedAnswers: ['rq-1'],
        },
      },
    };

    render(
      <StudentAppWrapper
        state={readingState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={runtimeSnapshot}
      />,
    );

    expect(screen.queryByText(/This section has ended\. Moving you to the next section\./i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dismiss notification/i })).not.toBeInTheDocument();
  });

  it('blocks submission when unansweredSubmissionPolicy is block', async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    window.sessionStorage.clear();

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.progression.autoSubmit = false;
    config.progression.unansweredSubmissionPolicy = 'block';
    config.sections.listening.enabled = false;
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;

    const examState: ExamState = {
      title: 'Submit Exam',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'p1',
      activeListeningPartId: 'l1',
      config,
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: {
        task1Prompt: 'Task 1 prompt',
        task2Prompt: 'Task 2 prompt',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Submit Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: null,
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(<StudentAppWrapper state={examState} onExit={() => {}} attemptSnapshot={attemptSnapshot} />);

    await user.click(screen.getByRole('button', { name: 'Finish' }));

    expect(screen.getByText(/must answer all questions/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Section' })).toBeDisabled();
    expect(screen.queryByText(/Examination Complete!/i)).not.toBeInTheDocument();
  });

  it('shows a confirmation when unansweredSubmissionPolicy is confirm and allows submitting with unanswered', async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    window.sessionStorage.clear();

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.progression.autoSubmit = false;
    config.progression.unansweredSubmissionPolicy = 'confirm';
    config.sections.listening.enabled = false;
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;

    const examState: ExamState = {
      title: 'Submit Exam',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'p1',
      activeListeningPartId: 'l1',
      config,
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: {
        task1Prompt: 'Task 1 prompt',
        task2Prompt: 'Task 2 prompt',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Submit Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: null,
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(<StudentAppWrapper state={examState} onExit={() => {}} attemptSnapshot={attemptSnapshot} />);

    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByText(/unanswered question/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Section' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Submit Section' }));

    await waitFor(() => {
      expect(screen.getByText(/Examination Complete!/i)).toBeInTheDocument();
    });
  });

  it('submits immediately when unansweredSubmissionPolicy is allow even with unanswered', async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    window.sessionStorage.clear();

    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.progression.autoSubmit = false;
    config.progression.unansweredSubmissionPolicy = 'allow';
    config.sections.listening.enabled = false;
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;

    const examState: ExamState = {
      title: 'Submit Exam',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'p1',
      activeListeningPartId: 'l1',
      config,
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: {
        task1Prompt: 'Task 1 prompt',
        task2Prompt: 'Task 2 prompt',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Submit Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: null,
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(<StudentAppWrapper state={examState} onExit={() => {}} attemptSnapshot={attemptSnapshot} />);

    await user.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => {
      expect(screen.getByText(/Examination Complete!/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Confirm Submission/i)).not.toBeInTheDocument();
  });

  it('shows the finish action for the final self-paced module', async () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.security.detectSecondaryScreen = false;
    config.progression.autoSubmit = true;
    config.sections.listening.enabled = false;
    config.sections.writing.enabled = false;
    config.sections.speaking.enabled = false;

    const examState: ExamState = {
      title: 'Submit Exam',
      type: 'Academic',
      activeModule: 'reading',
      activePassageId: 'p1',
      activeListeningPartId: 'l1',
      config,
      reading: {
        passages: [
          {
            id: 'p1',
            title: 'Passage 1',
            content: 'Seeded passage',
            blocks: [
              {
                id: 'reading-block-1',
                type: 'SHORT_ANSWER',
                instruction: 'Answer the question using one word from the passage.',
                questions: [
                  {
                    id: 'q1',
                    prompt: 'Question 1',
                    correctAnswer: 'seeded answer',
                    answerRule: 'ONE_WORD',
                  },
                ],
              },
            ],
          },
        ],
      },
      listening: { parts: [] },
      writing: {
        task1Prompt: 'Task 1 prompt',
        task2Prompt: 'Task 2 prompt',
      },
      speaking: {
        part1Topics: [],
        cueCard: '',
        part3Discussion: [],
      },
    };

    const attemptSnapshot: StudentAttempt = {
      id: 'attempt-1',
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Submit Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      phase: 'exam',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      flags: {},
      violations: [],
      proctorStatus: 'active',
      proctorNote: null,
      proctorUpdatedAt: null,
      proctorUpdatedBy: null,
      lastWarningId: null,
      lastAcknowledgedWarningId: null,
      integrity: {
        preCheck: null,
        deviceFingerprintHash: null,
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
        syncState: 'saved',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    render(
      <StudentAppWrapper
        state={examState}
        onExit={() => {}}
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Finish' })).toBeInTheDocument();
    expect(screen.queryByText(/IELTS Examination Complete!/i)).not.toBeInTheDocument();
  });

  it('shows the Submission pending panel instead of a success screen after a failed submit (FEX-051)', async () => {
    vi.useFakeTimers();
    try {
      const PENDING_SUBMISSIONS_STORAGE_KEY =
        'ielts_student_attempt_pending_submissions_v1';

      const readingAttempt = createReadingAttemptSnapshot();
      const seededAttempt = {
        ...readingAttempt,
        answers: { 'rq-1': 'SEEDED_FINAL' },
      };
      const pendingRecord = studentAttemptRepoModule.buildPendingStudentSubmission(seededAttempt);
      window.localStorage.setItem(
        PENDING_SUBMISSIONS_STORAGE_KEY,
        JSON.stringify([pendingRecord]),
      );

      const submittedAttempt: StudentAttempt = {
        ...readingAttempt,
        phase: 'post-exam',
        submittedAt: '2026-01-01T01:00:01.000Z',
      };
      const submitAttempt = vi
        .spyOn(studentAttemptRepository as any, 'submitAttempt')
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue(submittedAttempt);

      render(
        <StudentAppWrapper
          state={readingState}
          onExit={() => {}}
          scheduleId={readingAttempt.scheduleId}
          attemptSnapshot={readingAttempt}
          runtimeSnapshot={createReadingRuntimeSnapshot()}
        />,
      );

      // Bootstrap resumes the durable pending record; the resume attempt fails,
      // so the page must show the pending panel — never a success screen.
      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        screen.getByRole('heading', { name: 'Submission pending' }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/IELTS Examination Complete!/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();

      // Pending locks the exam against further editing: the workspace fieldset
      // is disabled (jsdom does not propagate fieldset disabled to descendant
      // controls, so assert the fieldset itself).
      const answerInput = screen.getByLabelText('Answer for question 1') as HTMLInputElement;
      const workspaceFieldset = answerInput.closest('fieldset');
      expect(workspaceFieldset).not.toBeNull();
      expect((workspaceFieldset as HTMLFieldSetElement).disabled).toBe(true);
      expect(workspaceFieldset).toHaveAttribute('aria-disabled', 'true');
      expect(submitAttempt).toHaveBeenCalledTimes(1);

      // Retry now reuses the same submission identity and the ORIGINAL frozen
      // final snapshot, and the backend receipt transitions the page to
      // confirmed success.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(submitAttempt).toHaveBeenCalledTimes(2);
      expect(submitAttempt.mock.calls[1][0].answers).toEqual({ 'rq-1': 'SEEDED_FINAL' });
      expect(submitAttempt.mock.calls[1][0].id).toBe('attempt-reading-1');

      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });

      expect(screen.queryByRole('heading', { name: 'Submission pending' })).not.toBeInTheDocument();
      expect(screen.getByText(/IELTS Examination Complete!/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the Submission pending panel over the post-exam view while a completed runtime is unconfirmed (FEX-051)', async () => {
    vi.useFakeTimers();
    try {
      const PENDING_SUBMISSIONS_STORAGE_KEY =
        'ielts_student_attempt_pending_submissions_v1';

      const writingAttempt = createWritingAttemptSnapshot();
      const pendingRecord = studentAttemptRepoModule.buildPendingStudentSubmission(writingAttempt);
      window.localStorage.setItem(
        PENDING_SUBMISSIONS_STORAGE_KEY,
        JSON.stringify([pendingRecord]),
      );

      vi.spyOn(studentAttemptRepository as any, 'submitAttempt').mockRejectedValue(
        new Error('network down'),
      );

      const liveRuntimeSnapshot = createWritingRuntimeSnapshot();
      const completedRuntimeSnapshot: ExamSessionRuntime = {
        ...liveRuntimeSnapshot,
        status: 'completed',
        actualEndAt: '2026-01-01T01:00:00.000Z',
        activeSectionKey: null,
        currentSectionRemainingSeconds: 0,
        sections: liveRuntimeSnapshot.sections.map((section) => ({
          ...section,
          status: 'completed' as const,
          actualEndAt: '2026-01-01T01:00:00.000Z',
          completionReason: 'auto_timeout' as const,
        })),
        updatedAt: '2026-01-01T01:00:00.000Z',
      };

      render(
        <StudentAppWrapper
          state={state}
          onExit={() => {}}
          scheduleId={writingAttempt.scheduleId}
          attemptSnapshot={writingAttempt}
          runtimeSnapshot={completedRuntimeSnapshot}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
        await Promise.resolve();
      });

      // The runtime is structurally complete, but the backend has not confirmed
      // the submission: the pending panel must overlay the post-exam view.
      expect(screen.getByText(/IELTS Examination Complete!/i)).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Submission pending' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
