import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';
import type { ExamConfig, ExamState } from '../../../../types';
import type { ExamSessionRuntime } from '../../../../types/domain';
import type { StudentAttempt } from '../../../../types/studentAttempt';

const mockConfig: ExamConfig = {
  general: {
    preset: 'Academic',
    type: 'Academic',
    ieltsMode: false,
    title: 'Test Exam',
    summary: 'Test summary',
    instructions: 'Test instructions',
  },
  sections: {
    listening: {
      enabled: true,
      label: 'Listening',
      duration: 30,
      order: 0,
      gapAfterMinutes: 0,
      partCount: 4,
      bandScoreTable: {},
      allowedQuestionTypes: ['TFNG'],
    },
    reading: {
      enabled: true,
      label: 'Reading',
      duration: 60,
      order: 1,
      gapAfterMinutes: 0,
      passageCount: 3,
      bandScoreTable: {},
      allowedQuestionTypes: ['TFNG'],
    },
    writing: {
      enabled: true,
      label: 'Writing',
      duration: 60,
      order: 2,
      gapAfterMinutes: 0,
      tasks: [],
      rubricWeights: { taskResponse: 25, coherence: 25, lexical: 25, grammar: 25 },
      allowedQuestionTypes: [],
    },
    speaking: {
      enabled: true,
      label: 'Speaking',
      duration: 15,
      order: 3,
      gapAfterMinutes: 0,
      parts: [],
      rubricWeights: { fluency: 25, lexical: 25, grammar: 25, pronunciation: 25 },
      allowedQuestionTypes: [],
    },
  },
  standards: {
    passageWordCount: { optimalMin: 700, optimalMax: 1000, warningMin: 500, warningMax: 1200 },
    writingTasks: {
      task1: { minWords: 150, recommendedTime: 20 },
      task2: { minWords: 250, recommendedTime: 40 },
    },
    rubricDeviationThreshold: 10,
    rubricWeights: {
      writing: { taskResponse: 25, coherence: 25, lexical: 25, grammar: 25 },
      speaking: { fluency: 25, lexical: 25, grammar: 25, pronunciation: 25 },
    },
    bandScoreTables: {
      listening: {},
      readingAcademic: {},
      readingGeneralTraining: {},
    },
  },
  progression: {
    autoSubmit: true,
    lockAfterSubmit: true,
    allowPause: false,
    showWarnings: true,
    warningThreshold: 3,
  },
  delivery: {
    launchMode: 'proctor_start',
    transitionMode: 'auto_with_proctor_override',
    allowedExtensionMinutes: [5, 10],
  },
  scoring: {
    overallRounding: 'nearest-0.5',
  },
  security: {
    tabSwitchRule: 'warn',
    detectSecondaryScreen: true,
    blockClipboard: true,
    antiScreenshotGuardEnabled: true,
    preventAutofill: true,
    preventAutocorrect: true,
    preventTranslation: true,
    proctoringFlags: {
      webcam: true,
      audio: true,
      screen: true,
    },
  },
};

const mockExamState: ExamState = {
  title: 'Test Exam',
  type: 'Academic',
  activeModule: 'listening',
  activePassageId: 'passage-1',
  activeListeningPartId: 'part-1',
  config: mockConfig,
  reading: { passages: [] },
  listening: { parts: [] },
  writing: {
    task1Prompt: '',
    task2Prompt: '',
    tasks: [],
    customPromptTemplates: [],
  },
  speaking: {
    part1Topics: [],
    cueCard: '',
    part3Discussion: [],
  },
};

const baseAttempt: StudentAttempt = {
  id: 'attempt-1',
  scheduleId: 'sched-1',
  studentKey: 'student-sched-1-alice',
  examId: 'exam-1',
  examTitle: 'Test Exam',
  candidateId: 'alice',
  candidateName: 'Alice Roe',
  candidateEmail: 'alice@example.com',
  phase: 'exam',
  currentModule: 'writing',
  currentQuestionId: 'task-2',
  answers: { q1: 'A' },
  writingAnswers: { 'task-2': '<p>Draft</p>' },
  flags: { q1: true },
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
    pendingMutationCount: 0,
    syncState: 'saved',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function createRuntimeSnapshot(sectionKey: ExamSessionRuntime['currentSectionKey']): ExamSessionRuntime {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'runtime-1',
    scheduleId: baseAttempt.scheduleId,
    examId: baseAttempt.examId,
    examTitle: baseAttempt.examTitle,
    cohortName: 'Cohort A',
    deliveryMode: 'proctor_start',
    status: 'live',
    actualStartAt: now,
    actualEndAt: null,
    activeSectionKey: sectionKey,
    currentSectionKey: sectionKey,
    currentSectionRemainingSeconds: 120,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    sections: [
      {
        sectionKey,
        label: sectionKey,
        order: 0,
        plannedDurationMinutes: 60,
        gapAfterMinutes: 0,
        status: 'live',
        availableAt: now,
        actualStartAt: now,
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
        completionReason: undefined,
        projectedStartAt: now,
        projectedEndAt: '2026-01-01T01:00:00.000Z',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function renderRuntime(options?: {
  attemptSnapshot?: StudentAttempt | null;
  runtimeBacked?: boolean;
  runtimeSnapshot?: ExamSessionRuntime | null;
}) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <StudentRuntimeProvider
      state={mockExamState}
      onExit={vi.fn()}
      attemptSnapshot={options?.attemptSnapshot ?? null}
      runtimeBacked={options?.runtimeBacked ?? false}
      runtimeSnapshot={options?.runtimeSnapshot ?? null}
    >
      {children}
    </StudentRuntimeProvider>
  );

  return renderHook(() => useStudentRuntime(), { wrapper });
}

function buildCompletedPreCheckAttempt(): StudentAttempt {
  return {
    ...baseAttempt,
    phase: 'pre-check',
    integrity: {
      ...baseAttempt.integrity,
      preCheck: {
        completedAt: '2026-01-01T00:01:00.000Z',
        browserFamily: 'chrome',
        browserVersion: 124,
        screenDetailsSupported: true,
        heartbeatReady: true,
        acknowledgedSafariLimitation: false,
        checks: [],
      },
    },
  };
}

describe('StudentRuntimeProvider', () => {
  it('hydrates position and violations from attempt snapshot', () => {
    const hydratedAttempt: StudentAttempt = {
      ...baseAttempt,
      violations: [
        {
          id: 'violation-1',
          type: 'TAB_SWITCH',
          severity: 'medium',
          timestamp: '2026-01-01T00:00:00.000Z',
          description: 'Tab hidden',
        },
      ],
    };

    const { result } = renderRuntime({ attemptSnapshot: hydratedAttempt });

    expect(result.current.state.currentModule).toBe('writing');
    expect(result.current.state.currentQuestionId).toBe('task-2');
    expect(result.current.state.violations).toEqual(hydratedAttempt.violations);
  });

  it('treats reconnect/device continuity transitions as non-blocking runtime signals', () => {
    const { result } = renderRuntime();

    act(() => {
      result.current.actions.transitionBlocking('offline', true);
    });
    expect(result.current.state.blocking.reason).toBeNull();

    act(() => {
      result.current.actions.transitionBlocking('syncing_reconnect', true);
    });
    expect(result.current.state.blocking.reason).toBeNull();

    act(() => {
      result.current.actions.transitionBlocking('device_mismatch', true);
    });
    expect(result.current.state.blocking.reason).toBeNull();
  });

  it('keeps higher-priority proctor pause when lower-priority reason clears', () => {
    const { result } = renderRuntime();

    act(() => {
      result.current.actions.transitionBlocking('offline', true);
      result.current.actions.transitionBlocking('proctor_paused', true);
      result.current.actions.transitionBlocking('offline', false);
    });

    expect(result.current.state.blocking.reason).toBe('proctor_paused');
  });

  it('syncs proctor pause from attempt hydration', () => {
    const pausedAttempt: StudentAttempt = {
      ...baseAttempt,
      proctorStatus: 'paused',
    };
    const { result } = renderRuntime({ attemptSnapshot: pausedAttempt });
    expect(result.current.state.blocking.reason).toBe('proctor_paused');
  });

  it('adds and clears violations', () => {
    const { result } = renderRuntime();

    act(() => {
      result.current.actions.addViolation('TAB_SWITCH', 'high', 'Tab switched');
    });
    expect(result.current.state.violations).toHaveLength(1);

    act(() => {
      result.current.actions.clearViolations();
    });
    expect(result.current.state.violations).toHaveLength(0);
  });

  it('advances runtime-backed modules immediately on submit', () => {
    const { result } = renderRuntime({
      attemptSnapshot: baseAttempt,
      runtimeBacked: true,
      runtimeSnapshot: createRuntimeSnapshot('listening'),
    });

    expect(result.current.state.currentModule).toBe('listening');

    act(() => {
      result.current.actions.submitModule();
    });

    expect(result.current.state.currentModule).toBe('reading');
  });

  it('does not regress back to pre-check after continue when stale runtime-backed snapshots arrive', () => {
    const runtimeNotStarted: ExamSessionRuntime = {
      ...createRuntimeSnapshot('listening'),
      status: 'not_started',
      currentSectionKey: null,
      activeSectionKey: null,
      currentSectionRemainingSeconds: 0,
      waitingForNextSection: false,
      sections: [],
    };

    function Harness() {
      const runtime = useStudentRuntime();
      return (
        <>
          <span data-testid="phase">{runtime.state.phase}</span>
          <button
            type="button"
            onClick={() => {
              runtime.actions.setPhase('exam');
            }}
          >
            Continue
          </button>
        </>
      );
    }

    const initialAttempt = buildCompletedPreCheckAttempt();
    const { rerender } = render(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={initialAttempt}
        runtimeBacked
        runtimeSnapshot={runtimeNotStarted}
      >
        <Harness />
      </StudentRuntimeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');

    const staleRefreshAttempt: StudentAttempt = {
      ...initialAttempt,
      updatedAt: '2026-01-01T00:01:02.000Z',
    };

    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={staleRefreshAttempt}
        runtimeBacked
        runtimeSnapshot={runtimeNotStarted}
      >
        <Harness />
      </StudentRuntimeProvider>,
    );

    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
  });

  it('boots runtime-backed delivery in exam phase once pre-check is completed', () => {
    const runtimeNotStarted: ExamSessionRuntime = {
      ...createRuntimeSnapshot('listening'),
      status: 'not_started',
      currentSectionKey: null,
      activeSectionKey: null,
      currentSectionRemainingSeconds: 0,
      waitingForNextSection: false,
      sections: [],
    };

    const initialAttempt = buildCompletedPreCheckAttempt();
    const { result } = renderRuntime({
      attemptSnapshot: initialAttempt,
      runtimeBacked: true,
      runtimeSnapshot: runtimeNotStarted,
    });

    expect(result.current.state.phase).toBe('exam');
  });
});
