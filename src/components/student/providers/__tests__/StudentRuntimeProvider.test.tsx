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

  it('keeps the local current question when a non-runtime attempt rehydrates with a stale position', () => {
    const staleAttempt: StudentAttempt = {
      ...baseAttempt,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    let captured: ReturnType<typeof useStudentRuntime> | null = null;
    function RuntimeCapture() {
      captured = useStudentRuntime();
      return <div data-testid="current-question">{captured.state.currentQuestionId ?? 'null'}</div>;
    }

    const { rerender } = render(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={staleAttempt}
      >
        <RuntimeCapture />
      </StudentRuntimeProvider>,
    );

    expect(screen.getByTestId('current-question')).toHaveTextContent('task-2');

    // The student navigates within the section; the local position is authoritative.
    act(() => {
      captured?.actions.setCurrentQuestionId('task-1');
    });
    expect(screen.getByTestId('current-question')).toHaveTextContent('task-1');

    // A later attempt snapshot still carries the older persisted position (the
    // position mutation has not been flushed to the server yet). Re-hydrating
    // must not warp the student back to the stale question in the same section.
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={{ ...staleAttempt, updatedAt: '2026-01-01T00:00:30.000Z' }}
      >
        <RuntimeCapture />
      </StudentRuntimeProvider>,
    );

    expect(screen.getByTestId('current-question')).toHaveTextContent('task-1');
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

  it('keeps a completed runtime-backed pre-check in lobby while stale not-started snapshots arrive', () => {
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
              runtime.actions.setPhase('lobby');
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
    expect(screen.getByTestId('phase')).toHaveTextContent('lobby');

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

    expect(screen.getByTestId('phase')).toHaveTextContent('lobby');
  });

  it('boots completed runtime-backed pre-check in lobby until the runtime is live', () => {
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

    expect(result.current.state.phase).toBe('lobby');
  });

  it.each(['exam', 'post-exam'] as const)('normalizes stale %s attempt phase to lobby while runtime is inactive', (phase) => {
    const runtimeNotStarted = { ...createRuntimeSnapshot('listening'), status: 'not_started' as const, currentSectionKey: null, activeSectionKey: null, sections: [] };
    const { result } = renderRuntime({ attemptSnapshot: { ...buildCompletedPreCheckAttempt(), phase }, runtimeBacked: true, runtimeSnapshot: runtimeNotStarted });
    expect(result.current.state.phase).toBe('lobby');
  });

  it.each(['not_started', 'cancelled'] as const)('rejects stale active keys when runtime status is %s', (status) => {
    const hostile = { ...createRuntimeSnapshot('listening'), status, currentSectionKey: 'listening' as const, activeSectionKey: 'listening' as const };
    const { result } = renderRuntime({ attemptSnapshot: { ...buildCompletedPreCheckAttempt(), phase: 'exam' }, runtimeBacked: true, runtimeSnapshot: hostile });
    expect(result.current.state.phase).toBe('lobby');
  });

  it('automatically promotes the waiting lobby when runtime hydration becomes live', () => {
    const inactive = { ...createRuntimeSnapshot('listening'), status: 'not_started' as const, currentSectionKey: null, activeSectionKey: null, sections: [] };
    const attempt = buildCompletedPreCheckAttempt();
    function Phase() { return <span data-testid="phase">{useStudentRuntime().state.phase}</span>; }
    const { rerender } = render(<StudentRuntimeProvider state={mockExamState} onExit={vi.fn()} attemptSnapshot={attempt} runtimeBacked runtimeSnapshot={inactive}><Phase /></StudentRuntimeProvider>);
    expect(screen.getByTestId('phase')).toHaveTextContent('lobby');
    rerender(
      <StudentRuntimeProvider state={mockExamState} onExit={vi.fn()} attemptSnapshot={attempt} runtimeBacked runtimeSnapshot={createRuntimeSnapshot('listening')}>
        <Phase />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
  });

  it('updates runtime-backed display time only when the visible second changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    function DisplayProbe() {
      const { state } = useStudentRuntime();
      return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
    }

    render(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={() => undefined}
        runtimeBacked
        runtimeSnapshot={createRuntimeSnapshot('writing')}
        attemptSnapshot={{
          ...buildCompletedPreCheckAttempt(),
          phase: 'exam',
          currentModule: 'writing',
          currentQuestionId: 'task1',
        }}
      >
        <DisplayProbe />
      </StudentRuntimeProvider>,
    );

    expect(screen.getByTestId('remaining')).toHaveTextContent('120');
    await act(async () => {
      await Promise.resolve();
    });
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 250);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);

    const scheduledSecondTicks = setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 1_000).length;
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 1_000)).toHaveLength(
      scheduledSecondTicks,
    );

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(
      setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 1_000).length,
    ).toBeGreaterThan(scheduledSecondTicks);
    vi.useRealTimers();
  });

  it('does not recreate the non-runtime timer interval for every tick', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    renderRuntime({
      attemptSnapshot: {
        ...baseAttempt,
        phase: 'exam',
        currentModule: 'reading',
      },
    });

    const initialIntervalCount = setIntervalSpy.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(initialIntervalCount);
    vi.useRealTimers();
  });
});
