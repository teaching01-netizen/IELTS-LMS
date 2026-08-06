import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentAppWrapper } from '../StudentAppWrapper';
import { createDefaultConfig } from '../../../constants/examDefaults';
import * as errorLogger from '../../../app/error/errorLogger';
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

// A runtime-backed attempt whose pre-check has NOT completed yet: the student
// is on the briefing (phase 'pre-check') and the silent persist is pending.
function createPreCheckPendingAttemptSnapshot(): StudentAttempt {
  const attempt = createWritingAttemptSnapshot();
  return {
    ...attempt,
    integrity: {
      ...attempt.integrity,
      preCheck: null,
    },
  };
}

// The runtime the proctor has not started yet: waiting in the lobby.
function createNotStartedRuntimeSnapshot(): ExamSessionRuntime {
  return {
    ...createWritingRuntimeSnapshot(),
    status: 'not_started',
    activeSectionKey: null,
    currentSectionKey: null,
    currentSectionRemainingSeconds: 0,
    sections: [],
  };
}

function buildBackendAttemptFromPreCheck(attempt: StudentAttempt, preCheck: unknown) {
  return {
    id: attempt.id,
    scheduleId: attempt.scheduleId,
    studentKey: attempt.studentKey,
    examId: attempt.examId,
    examTitle: attempt.examTitle,
    candidateId: attempt.candidateId,
    candidateName: attempt.candidateName,
    candidateEmail: attempt.candidateEmail,
    phase: attempt.phase,
    currentModule: attempt.currentModule,
    currentQuestionId: attempt.currentQuestionId,
    answers: attempt.answers,
    writingAnswers: attempt.writingAnswers,
    flags: attempt.flags,
    violationsSnapshot: attempt.violations,
    integrity: { preCheck, deviceFingerprintHash: attempt.integrity.deviceFingerprintHash },
    recovery: { syncState: 'saved' },
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}

// Mocks the precheck POST while keeping the generic credential-refresh
// envelope used by the other StudentApp tests for every other endpoint.
function installPreCheckFetchMock(
  attempt: StudentAttempt,
  responder?: (init: RequestInit) => Response | Promise<Response>,
): Array<{ init: RequestInit }> {
  const precheckRequests: Array<{ init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === `/api/v1/student/sessions/${attempt.scheduleId}/precheck`) {
      precheckRequests.push({ init: init ?? {} });
      if (responder) {
        return responder(init ?? {});
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { preCheck?: unknown };
      return new Response(
        JSON.stringify({
          success: true,
          data: buildBackendAttemptFromPreCheck(attempt, body.preCheck),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          attempt: {
            attemptToken: 'test-token',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  global.fetch = fetchMock as typeof fetch;
  return precheckRequests;
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
                    blanks: [
                      { id: 'blank-1', correctAnswer: 'quick', position: 0 },
                      { id: 'blank-2', correctAnswer: 'lazy', position: 1 },
                    ],
                    answerRule: 'ONE_WORD',
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

  it('returned to the same question when the unanswered-submission confirmation was cancelled (FEX-040 cancel)', async () => {
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
    expect(screen.getByRole('heading', { name: 'Confirm Submission' })).toBeInTheDocument();
    expect(screen.getByText('You have 1 unanswered question')).toBeInTheDocument();

    // Cancel (Review Answers) closes the dialog without submitting or moving.
    await user.click(screen.getByRole('button', { name: 'Review Answers' }));

    expect(screen.queryByRole('heading', { name: 'Confirm Submission' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Examination Complete!/i)).not.toBeInTheDocument();
    // The student is still on the same question (q1) in the live exam.
    expect(screen.getByLabelText('Answer for question 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();

    // Opening the confirmation again proves the exam is still active on the
    // same question — cancelling never submitted or navigated.
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByRole('heading', { name: 'Confirm Submission' })).toBeInTheDocument();
  });

  it('wired answered, total, and flagged counts into the unanswered confirmation dialog (FEX-040 counts)', async () => {
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
                  {
                    id: 'q2',
                    prompt: 'Question 2',
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

    // Answer q1 and flag it: 2 questions total, 1 answered, 1 flagged.
    await user.type(screen.getByLabelText('Answer for question 1'), 'mars');
    // The reading module renders a flag control per question; flag the first
    // (the current question q1).
    await user.click(screen.getAllByRole('button', { name: 'Flag question' })[0]);

    await user.click(screen.getByRole('button', { name: 'Finish' }));

    expect(screen.getByRole('heading', { name: 'Confirm Submission' })).toBeInTheDocument();
    expect(screen.getByText('You have 1 unanswered question')).toBeInTheDocument();
    const answeredRow = screen.getByText('Answered:').closest('div');
    expect(answeredRow).not.toBeNull();
    expect(answeredRow).toHaveTextContent('1/2');
    expect(screen.getByText(/You have 1 flagged question/)).toBeInTheDocument();
    const flaggedRow = screen.getByText('Flagged:').closest('div');
    expect(flaggedRow).not.toBeNull();
    expect(flaggedRow?.textContent).toBe('Flagged:1');

    // Let the pending autosave work settle inside act so no timer fires after
    // the test body ends.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  });

  it('did not submit the section while the runtime was paused, keeping the student locked in the exam (FEX-042 runtime pauses)', async () => {
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
        // A completed pre-check is required for the paused runtime to open
        // the exam workspace with the blocking overlay.
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
        state={examState}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={attemptSnapshot}
        runtimeSnapshot={{ ...createReadingRuntimeSnapshot(), status: 'paused' as const }}
      />,
    );

    // The pause blocking overlay is up; the Finish control sits underneath it.
    expect(screen.getByRole('heading', { name: 'Cohort paused' })).toBeInTheDocument();
    const finishButton = screen.getByRole('button', { name: 'Finish' });
    expect(finishButton).toBeInTheDocument();

    // The overlay intercepts the pointer (userEvent hit-tests the topmost
    // element, matching the real browser): the confirmation dialog never
    // opens while the runtime is paused.
    await user.click(finishButton);
    expect(screen.queryByRole('heading', { name: 'Confirm Submission' })).not.toBeInTheDocument();

    // No submission and no completion can happen while paused: the pause
    // overlay stays and the student remains on the same question.
    expect(screen.queryByText(/Examination Complete!/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cohort paused' })).toBeInTheDocument();
    expect(screen.getByLabelText('Answer for question 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
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

  it('showed the Offline status in the header and kept answer entry working while offline (FEX-032)', async () => {
    vi.useFakeTimers();
    try {
      const offlineAttempt: StudentAttempt = {
        ...createReadingAttemptSnapshot(),
        recovery: {
          ...createReadingAttemptSnapshot().recovery,
          syncState: 'offline',
        },
      };
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      render(
        <StudentAppWrapper
          state={readingState}
          onExit={() => {}}
          scheduleId={offlineAttempt.scheduleId}
          attemptSnapshot={offlineAttempt}
          runtimeSnapshot={createReadingRuntimeSnapshot()}
        />,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // FEX-032: while offline typing, the blocking machine stays disengaged
      // (blocking.reason is null) — the header autoSaveStatus badge is the
      // ONLY visible offline surface.
      expect(screen.getByText('Offline')).toBeInTheDocument();

      const input = screen.getByLabelText('Answer for question 1') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: 'OFFLINE_TYPED' } });
      });
      expect(input.value).toBe('OFFLINE_TYPED');

      // The typed answer reaches the durable queue even while offline
      // (pendingMutationCount 0→1 is pinned at the provider level; here the
      // durable mirror write is the app-level observable).
      await act(async () => {
        vi.advanceTimersByTime(120);
        await Promise.resolve();
      });
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalled();
      const queuedMutations = vi
        .mocked(studentAttemptRepository.savePendingMutations)
        .mock.calls.flatMap((call) => call[1] ?? []);
      expect(queuedMutations).toContainEqual(
        expect.objectContaining({
          type: 'answer',
          payload: expect.objectContaining({
            questionId: 'rq-1',
            value: 'OFFLINE_TYPED',
          }),
        }),
      );

      // The Offline indicator survives the durable write and the queued
      // (offline) flush cycle.
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('Offline')).toBeInTheDocument();
      expect((screen.getByLabelText('Answer for question 1') as HTMLInputElement).value)
        .toBe('OFFLINE_TYPED');
    } finally {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      vi.useRealTimers();
    }
  });

  it('released the Offline header status only after the reconnect flush synchronized (FEX-032)', async () => {
    vi.useFakeTimers();
    try {
      window.sessionStorage.clear();
      window.sessionStorage.setItem(
        'ielts_student_attempt_credentials_v1',
        JSON.stringify([
          {
            attemptId: 'attempt-reading-1',
            scheduleId: 'sched-1',
            attemptToken: 'token-1',
            expiresAt: '2026-01-02T00:00:00.000Z',
          },
        ]),
      );

      const offlineAttempt: StudentAttempt = {
        ...createReadingAttemptSnapshot(),
        recovery: {
          ...createReadingAttemptSnapshot().recovery,
          syncState: 'offline',
        },
      };
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: false,
      });

      render(
        <StudentAppWrapper
          state={readingState}
          onExit={() => {}}
          scheduleId={offlineAttempt.scheduleId}
          attemptSnapshot={offlineAttempt}
          runtimeSnapshot={createReadingRuntimeSnapshot()}
        />,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('Offline')).toBeInTheDocument();

      const input = screen.getByLabelText('Answer for question 1') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: 'RECONNECT_TYPED' } });
      });
      await act(async () => {
        vi.advanceTimersByTime(120);
        await Promise.resolve();
      });
      expect(studentAttemptRepository.savePendingMutations).toHaveBeenCalled();

      // Connection returns: the queue replays and only a successful flush
      // releases the Offline state (Offline → Syncing… → Saved). Drive the
      // recovery loop's microtask chain and its 0ms/backoff timers explicitly
      // (waitFor does not auto-advance Vitest fake timers here).
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        for (let i = 0; i < 12; i++) {
          await Promise.resolve();
        }
      });
      for (let round = 0; round < 5; round++) {
        await act(async () => {
          vi.advanceTimersByTime(100);
          for (let i = 0; i < 8; i++) {
            await Promise.resolve();
          }
        });
      }

      expect(screen.queryByText('Offline')).not.toBeInTheDocument();
      expect(screen.getByText('Saved')).toBeInTheDocument();
      expect(studentAttemptRepository.clearPendingMutations).toHaveBeenCalled();

      // The replay pushed the latest offline answer into the persisted
      // attempt, and the latest answer stayed visible in the workspace.
      expect(
        vi
          .mocked(studentAttemptRepository.saveAttempt)
          .mock.calls.some((call) => (call[0] as StudentAttempt).answers?.['rq-1'] === 'RECONNECT_TYPED'),
      ).toBe(true);
      expect((screen.getByLabelText('Answer for question 1') as HTMLInputElement).value)
        .toBe('RECONNECT_TYPED');
    } finally {
      Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value: true,
      });
      vi.useRealTimers();
    }
  });

  it('blocked new answer and flag input with a storage warning while keeping the visible answer (FEX-033)', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(studentAttemptRepository as any, 'savePendingMutations').mockRejectedValue(
        new Error('quota exceeded'),
      );
      // Seed a device fingerprint so the mount-time continuity check does not
      // produce the first (failing) durable write before the typed answer.
      const readingAttempt: StudentAttempt = {
        ...createReadingAttemptSnapshot(),
        integrity: {
          ...createReadingAttemptSnapshot().integrity,
          deviceFingerprintHash: 'fp-1',
        },
      };

      render(
        <StudentAppWrapper
          state={readingState}
          onExit={() => {}}
          scheduleId={readingAttempt.scheduleId}
          attemptSnapshot={readingAttempt}
          runtimeSnapshot={createReadingRuntimeSnapshot()}
        />,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const input = screen.getByLabelText('Answer for question 1') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: 'FIRST' } });
      });
      expect(input.value).toBe('FIRST');

      // The durable write fails: the storage_unavailable overlay appears with
      // the title and the explanation copy.
      await act(async () => {
        vi.advanceTimersByTime(120);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(
        screen.getByRole('heading', { name: 'Answer storage unavailable' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Your browser cannot safely store new answers/i),
      ).toBeInTheDocument();

      // FEX-033: input mutation is blocked once safe durability is unavailable
      // — the workspace controls are locked and further edits are refused.
      const workspaceFieldset = input.closest('fieldset');
      expect(workspaceFieldset).not.toBeNull();
      expect((workspaceFieldset as HTMLFieldSetElement).disabled).toBe(true);

      await act(async () => {
        fireEvent.change(input, { target: { value: 'SECOND' } });
        fireEvent.click(screen.getByTitle('Flag question'));
        await Promise.resolve();
      });

      // The existing visible answer is NOT cleared and does NOT change, and
      // the flag toggle is refused too.
      expect(input.value).toBe('FIRST');
      expect(screen.queryByTitle('Unflag question')).not.toBeInTheDocument();
      expect(screen.getByTitle('Flag question')).toBeInTheDocument();
    } finally {
      vi.mocked(studentAttemptRepository.savePendingMutations).mockRestore();
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

  it('releases the storage-unavailable blocking overlay once the pending submission saves and confirms (M7)', async () => {
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
      vi.spyOn(studentAttemptRepository as any, 'savePendingSubmission')
        .mockRejectedValueOnce(new Error('storage blocked'))
        .mockResolvedValue();

      render(
        <StudentAppWrapper
          state={readingState}
          onExit={() => {}}
          scheduleId={readingAttempt.scheduleId}
          attemptSnapshot={readingAttempt}
          runtimeSnapshot={createReadingRuntimeSnapshot()}
        />,
      );

      // Bootstrap resumes the durable record; the resume attempt fails AND the
      // durable save fails: the full-screen blocking overlay must appear.
      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText('Answer storage unavailable')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Submission pending' }),
      ).toBeInTheDocument();

      // Retry now succeeds and the pending record clears: storage is usable
      // again, so the blocking overlay must NOT remain until reload (M7).
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });

      expect(screen.queryByText('Answer storage unavailable')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Submission pending' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/IELTS Examination Complete!/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays on the briefing while pre-check persistence is pending, then enters the lobby (FEX-002)', async () => {
    let resolvePreCheck: ((response: Response) => void) | null = null;
    const deferred = new Promise<Response>((resolve) => {
      resolvePreCheck = resolve;
    });
    const attempt = createPreCheckPendingAttemptSnapshot();
    installPreCheckFetchMock(attempt, (init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { preCheck?: unknown };
      return deferred.then(
        () =>
          new Response(
            JSON.stringify({
              success: true,
              data: buildBackendAttemptFromPreCheck(attempt, body.preCheck),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
    });

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={attempt}
        runtimeSnapshot={createNotStartedRuntimeSnapshot()}
      />,
    );

    // The lobby must NOT render before the silent persist resolves: the
    // student stays on the briefing shell with its "Preparing your
    // connection…" status, never the lobby waiting message.
    expect(screen.getByRole('heading', { name: 'Waiting for the exam to start' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your connection');
    expect(screen.getByRole('status')).not.toHaveTextContent(
      'Waiting for the proctor to start the exam',
    );

    await act(async () => {
      resolvePreCheck?.(new Response(null, { status: 200 }));
    });

    // Persistence succeeded -> the same shell now shows the waiting status.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Waiting for the proctor to start the exam',
      ),
    );
    expect(screen.queryByRole('button', { name: /start exam/i })).not.toBeInTheDocument();
  });

  it('keeps the briefing and retries automatically when pre-check persistence fails (FEX-002)', async () => {
    // The failed precheck POST is expected; silence the apiClient error log.
    const logErrorSpy = vi
      .spyOn(errorLogger, 'logError')
      .mockImplementation(() => {});
    const attempt = createPreCheckPendingAttemptSnapshot();
    let precheckCallCount = 0;
    const precheckRequests = installPreCheckFetchMock(attempt, (init) => {
      precheckCallCount += 1;
      if (precheckCallCount === 1) {
        return new Response(
          JSON.stringify({ success: false, error: { message: 'server down' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { preCheck?: unknown };
      return new Response(
        JSON.stringify({
          success: true,
          data: buildBackendAttemptFromPreCheck(attempt, body.preCheck),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    render(
      <StudentAppWrapper
        state={state}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={attempt}
        runtimeSnapshot={createNotStartedRuntimeSnapshot()}
      />,
    );

    // Failure keeps the student on the briefing; the lobby never appears.
    await waitFor(() => expect(precheckRequests).toHaveLength(1));
    expect(screen.getByRole('heading', { name: 'Waiting for the exam to start' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your connection');
    expect(screen.getByText(/having trouble reaching the server/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent(
      'Waiting for the proctor to start the exam',
    );

    // The automatic retry (same silent flow) succeeds -> lobby.
    await waitFor(
      () =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'Waiting for the proctor to start the exam',
        ),
      { timeout: 4_000 },
    );
    expect(precheckRequests).toHaveLength(2);
    // The retry preserves the same idempotency identity.
    const keys = precheckRequests.map(
      (request) => (request.init.headers as Record<string, string>)?.['Idempotency-Key'],
    );
    expect(keys[0]).toMatch(/^attempt-[\w-]+:/);
    expect(keys[0]).toBe(keys[1]);
    logErrorSpy.mockRestore();
  });

  it('renders the lobby without answer inputs, section content, or a student start action (FEX-003)', async () => {
    render(
      <StudentAppWrapper
        state={readingState}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={createWritingAttemptSnapshot()}
        runtimeSnapshot={createNotStartedRuntimeSnapshot()}
      />,
    );

    // Flush the mount-time hydration microtasks inside act().
    await act(async () => {});

    // The waiting shell is visible.
    expect(screen.getByRole('heading', { name: 'Waiting for the exam to start' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the proctor to start the exam');
    expect(
      screen.getByText("You're checked in and waiting for the exam to start. Please keep this page open."),
    ).toBeInTheDocument();

    // No answer inputs are mounted.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.querySelector('input, select, textarea')).toBeNull();

    // No section content (passage or question text) is present in the DOM.
    expect(screen.queryByText('Read and answer.')).not.toBeInTheDocument();
    expect(screen.queryByText('Type one word')).not.toBeInTheDocument();
    expect(screen.queryByText('Passage 1')).not.toBeInTheDocument();

    // No student start action exists.
    expect(screen.queryByRole('button', { name: /start exam/i })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('automatically opens the workspace when the runtime goes live while the student waits (FEX-003)', async () => {
    const attempt = createWritingAttemptSnapshot();
    const { rerender } = render(
      <StudentAppWrapper
        state={readingState}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={attempt}
        runtimeSnapshot={createNotStartedRuntimeSnapshot()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Waiting for the exam to start' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the proctor to start the exam');

    // The proctor starts the cohort: the next poll delivers a live runtime.
    rerender(
      <StudentAppWrapper
        state={readingState}
        onExit={() => {}}
        scheduleId="sched-1"
        attemptSnapshot={attempt}
        runtimeSnapshot={createReadingRuntimeSnapshot()}
      />,
    );

    // The workspace opens automatically — no student action needed.
    expect(await screen.findByText('Read and answer.')).toBeInTheDocument();
    expect(screen.getByText('Type one word')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Waiting for the exam to start' }),
    ).not.toBeInTheDocument();
  });

  describe('FEX-010 authoritative phase mapping / FEX-012 stale runtime protection (F-2)', () => {
    function buildStructurallyCompleteRuntime(key: 'writing' | 'reading'): ExamSessionRuntime {
      const base = key === 'writing' ? createWritingRuntimeSnapshot() : createReadingRuntimeSnapshot();
      return {
        ...base,
        status: 'completed',
        actualEndAt: '2026-01-01T01:00:00.000Z',
        activeSectionKey: null,
        currentSectionRemainingSeconds: 0,
        sections: base.sections.map((section) => ({
          ...section,
          status: 'completed',
          actualEndAt: '2026-01-01T01:00:00.000Z',
          completionReason: 'auto_timeout',
        })),
        updatedAt: '2026-01-01T01:00:00.000Z',
      };
    }

    it.each([
      {
        name: 'pre-check missing + nonterminal runtime -> briefing (Preparing your connection…)',
        installPreCheckGate: true,
        assert: async () => {
          expect(
            screen.getByRole('heading', { name: 'Waiting for the exam to start' }),
          ).toBeInTheDocument();
          expect(screen.getByRole('status')).toHaveTextContent('Preparing your connection');
          expect(screen.getByRole('status')).not.toHaveTextContent(
            'Waiting for the proctor to start the exam',
          );
          expect(screen.queryByText('Read and answer.')).not.toBeInTheDocument();
        },
      },
      {
        name: 'pre-check complete + not_started runtime -> waiting room',
        attempt: createWritingAttemptSnapshot,
        runtime: createNotStartedRuntimeSnapshot,
        assert: async () => {
          expect(
            screen.getByRole('heading', { name: 'Waiting for the exam to start' }),
          ).toBeInTheDocument();
          expect(screen.getByRole('status')).toHaveTextContent(
            'Waiting for the proctor to start the exam',
          );
          expect(screen.queryAllByRole('button')).toHaveLength(0);
        },
      },
      {
        name: 'pre-check complete + live runtime -> exam workspace',
        attempt: () => createReadingAttemptSnapshot(),
        runtime: createReadingRuntimeSnapshot,
        assert: async () => {
          expect(await screen.findByText('Read and answer.')).toBeInTheDocument();
          expect(screen.getByText('Type one word')).toBeInTheDocument();
          expect(
            screen.queryByRole('heading', { name: 'Waiting for the exam to start' }),
          ).not.toBeInTheDocument();
        },
      },
      {
        name: 'pre-check complete + paused runtime -> exam workspace with blocking overlay',
        attempt: () => createReadingAttemptSnapshot(),
        runtime: () => ({ ...createReadingRuntimeSnapshot(), status: 'paused' as const }),
        assert: async () => {
          expect(await screen.findByText('Read and answer.')).toBeInTheDocument();
          expect(screen.getByRole('heading', { name: 'Cohort paused' })).toBeInTheDocument();
          expect(
            screen.getByText(/your current section will resume when the cohort restarts/i),
          ).toBeInTheDocument();
        },
      },
      {
        name: 'completed-but-structurally-incomplete runtime -> no false success, no workspace',
        attempt: () => createWritingAttemptSnapshot(),
        runtime: () => ({ ...createWritingRuntimeSnapshot(), status: 'completed' as const }),
        assert: async () => {
          expect(screen.queryByText(/examination complete/i)).not.toBeInTheDocument();
          // The runtime claims completion but nothing verifies it: the student
          // stays on the waiting shell, never a success screen and never the
          // exam workspace.
          expect(
            screen.getByRole('heading', { name: 'Waiting for the exam to start' }),
          ).toBeInTheDocument();
          expect(screen.queryByRole('timer', { name: /time remaining/i })).not.toBeInTheDocument();
        },
      },
      {
        name: 'pre-check complete + structurally complete runtime -> finalization/post-exam',
        attempt: () => createWritingAttemptSnapshot(),
        runtime: () => buildStructurallyCompleteRuntime('writing'),
        assert: async () => {
          expect(
            await screen.findByRole('heading', { name: /examination complete/i }),
          ).toBeInTheDocument();
          expect(
            screen.queryByRole('heading', { name: /session terminated/i }),
          ).not.toBeInTheDocument();
        },
      },
      {
        name: 'proctor-terminated attempt -> terminated view regardless of runtime state',
        attempt: () => ({
          ...createWritingAttemptSnapshot(),
          proctorStatus: 'terminated' as const,
          proctorNote: 'Session terminated due to integrity review',
        }),
        runtime: () => createWritingRuntimeSnapshot(),
        assert: async () => {
          expect(
            await screen.findByRole('heading', { name: /session terminated/i }),
          ).toBeInTheDocument();
          expect(screen.queryByText(/examination complete/i)).not.toBeInTheDocument();
          expect(screen.queryByRole('timer', { name: /time remaining/i })).not.toBeInTheDocument();
        },
      },
    ] as Array<{
      name: string;
      attempt?: (() => StudentAttempt) | undefined;
      runtime?: (() => ExamSessionRuntime) | undefined;
      installPreCheckGate?: boolean;
      assert: () => Promise<void>;
    }>)('$name', async ({ attempt, runtime, installPreCheckGate, assert }) => {
      if (installPreCheckGate) {
        // Keep the silent pre-check persist pending so the briefing shell
        // stays visible (the lobby must not appear before persistence).
        const deferred = new Promise<Response>(() => undefined);
        installPreCheckFetchMock(createPreCheckPendingAttemptSnapshot(), () => deferred);
      }
      render(
        <StudentAppWrapper
          state={readingState}
          onExit={() => undefined}
          scheduleId="sched-1"
          attemptSnapshot={attempt?.() ?? createPreCheckPendingAttemptSnapshot()}
          runtimeSnapshot={runtime?.() ?? createReadingRuntimeSnapshot()}
        />,
      );
      await assert();
    });

    it('keeps the finalization UI when a nonterminal runtime is re-delivered after terminal completion (FEX-012)', async () => {
      const attempt = createWritingAttemptSnapshot();
      const { rerender } = render(
        <StudentAppWrapper
          state={state}
          onExit={() => undefined}
          scheduleId={attempt.scheduleId}
          attemptSnapshot={attempt}
          runtimeSnapshot={buildStructurallyCompleteRuntime('writing')}
        />,
      );

      expect(
        await screen.findByRole('heading', { name: /examination complete/i }),
      ).toBeInTheDocument();

      // A stale out-of-order live runtime must not bounce the student back
      // into the exam workspace: verified terminal state is absorbing.
      rerender(
        <StudentAppWrapper
          state={state}
          onExit={() => undefined}
          scheduleId={attempt.scheduleId}
          attemptSnapshot={attempt}
          runtimeSnapshot={createWritingRuntimeSnapshot()}
        />,
      );

      expect(
        screen.getByRole('heading', { name: /examination complete/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('timer', { name: /time remaining/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();
    });
  });
});
