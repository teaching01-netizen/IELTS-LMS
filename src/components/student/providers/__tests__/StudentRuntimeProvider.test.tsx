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

  it('automatically promotes the waiting lobby when runtime hydration becomes paused (FEX-003)', () => {
    const inactive = { ...createRuntimeSnapshot('listening'), status: 'not_started' as const, currentSectionKey: null, activeSectionKey: null, sections: [] };
    const attempt = buildCompletedPreCheckAttempt();
    function Phase() { return <span data-testid="phase">{useStudentRuntime().state.phase}</span>; }
    const { rerender } = render(<StudentRuntimeProvider state={mockExamState} onExit={vi.fn()} attemptSnapshot={attempt} runtimeBacked runtimeSnapshot={inactive}><Phase /></StudentRuntimeProvider>);
    expect(screen.getByTestId('phase')).toHaveTextContent('lobby');
    // A paused runtime is still an active runtime: the student leaves the
    // lobby automatically (the paused overlay itself is pinned elsewhere).
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={attempt}
        runtimeBacked
        runtimeSnapshot={{ ...createRuntimeSnapshot('listening'), status: 'paused' }}
      >
        <Phase />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
  });

  it('locks the exam while a live runtime is missing its active section', () => {
    const runtimeSnapshot = {
      ...createRuntimeSnapshot('reading'),
      activeSectionKey: 'reading' as const,
      currentSectionKey: 'reading' as const,
      sections: [],
    };

    const { result } = renderRuntime({
      attemptSnapshot: { ...buildCompletedPreCheckAttempt(), phase: 'exam' },
      runtimeBacked: true,
      runtimeSnapshot,
    });

    expect(result.current.state.runtimeContractIssue).toBe('missing_active_section');
    expect(result.current.state.blocking.reason).toBe('waiting_for_runtime');
    expect(result.current.state.answerControlsLocked).toBe(true);
  });

  it('locks the exam while a live runtime carries a stale paused timestamp', () => {
    const runtimeSnapshot = {
      ...createRuntimeSnapshot('reading'),
      sections: [
        {
          ...createRuntimeSnapshot('reading').sections[0],
          pausedAt: '2026-01-01T00:00:01.000Z',
        },
      ],
    };

    const { result } = renderRuntime({
      attemptSnapshot: { ...buildCompletedPreCheckAttempt(), phase: 'exam' },
      runtimeBacked: true,
      runtimeSnapshot,
    });

    expect(result.current.state.runtimeContractIssue).toBe('stale_paused_at');
    expect(result.current.state.blocking.reason).toBe('waiting_for_runtime');
    expect(result.current.state.answerControlsLocked).toBe(true);
  });

  it('updates runtime-backed display time only when the visible second changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    try {
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
    } finally {
      // Restore the timer spies: leaving them installed corrupts window.setTimeout
      // for later tests in this file that rely on real timers.
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('counts down each visible second from the absolute deadline to zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 10,
        currentSectionDeadlineAt: '2026-01-01T00:00:10.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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

      expect(screen.getByTestId('remaining')).toHaveTextContent('10');
      for (let expected = 9; expected >= 0; expected -= 1) {
        act(() => {
          vi.advanceTimersByTime(1_000);
        });
        expect(screen.getByTestId('remaining')).toHaveTextContent(String(expected));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the server clock offset when the device clock starts behind', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 130,
        currentSectionDeadlineAt: '2026-01-01T00:02:10.000Z',
        serverNow: '2026-01-01T00:02:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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

      expect(screen.getByTestId('remaining')).toHaveTextContent('10');
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByTestId('remaining')).toHaveTextContent('5');
    } finally {
      vi.useRealTimers();
    }
  });

  it('smooths small server clock corrections without re-anchoring the deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const firstSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 140,
        currentSectionDeadlineAt: '2026-01-01T00:02:20.000Z',
        serverNow: '2026-01-01T00:02:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      const { rerender } = render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={firstSnapshot}
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

      expect(screen.getByTestId('remaining')).toHaveTextContent('20');

      act(() => {
        rerender(
          <StudentRuntimeProvider
            state={mockExamState}
            onExit={() => undefined}
            runtimeBacked
            runtimeSnapshot={{
              ...firstSnapshot,
              serverNow: '2026-01-01T00:02:04.000Z',
              currentSectionRemainingSeconds: 136,
            }}
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
      });

      expect(screen.getByTestId('remaining')).toHaveTextContent('19');
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps the runtime-backed ticker advancing through equal-revision snapshot churn', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 10,
        currentSectionDeadlineAt: '2026-01-01T00:00:10.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
        revision: 7,
      };
      const attemptSnapshot = {
        ...buildCompletedPreCheckAttempt(),
        phase: 'exam' as const,
        currentModule: 'writing' as const,
        currentQuestionId: 'task1',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      const { rerender } = render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
          attemptSnapshot={attemptSnapshot}
        >
          <DisplayProbe />
        </StudentRuntimeProvider>,
      );

      expect(screen.getByTestId('remaining')).toHaveTextContent('10');

      for (let elapsedMs = 0; elapsedMs < 1_200; elapsedMs += 100) {
        act(() => {
          rerender(
            <StudentRuntimeProvider
              state={mockExamState}
              onExit={() => undefined}
              runtimeBacked
              runtimeSnapshot={{ ...runtimeSnapshot }}
              attemptSnapshot={attemptSnapshot}
            >
              <DisplayProbe />
            </StudentRuntimeProvider>,
          );
          vi.advanceTimersByTime(100);
        });
      }

      expect(screen.getByTestId('remaining')).toHaveTextContent('9');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retain a timer anchor from a suspended render', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const suspendedPromise = new Promise<never>(() => undefined);
    const attemptSnapshot = {
      ...buildCompletedPreCheckAttempt(),
      phase: 'exam' as const,
      currentModule: 'writing' as const,
      currentQuestionId: 'task1',
    };
    const committedRuntime = {
      ...createRuntimeSnapshot('writing'),
      currentSectionRemainingSeconds: 10,
      currentSectionDeadlineAt: '2026-01-01T00:00:10.000Z',
      serverNow: '2026-01-01T00:00:00.000Z',
    };

    function DisplayProbe({ suspend }: { suspend: boolean }) {
      if (suspend) {
        throw suspendedPromise;
      }

      const { state } = useStudentRuntime();
      return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
    }

    try {
      const { rerender } = render(
        <React.Suspense fallback={<div data-testid="suspended">Suspended</div>}>
          <StudentRuntimeProvider
            state={mockExamState}
            onExit={() => undefined}
            runtimeBacked
            runtimeSnapshot={committedRuntime}
            attemptSnapshot={attemptSnapshot}
          >
            <DisplayProbe suspend={false} />
          </StudentRuntimeProvider>
        </React.Suspense>,
      );

      expect(screen.getByTestId('remaining')).toHaveTextContent('10');

      act(() => {
        React.startTransition(() => {
          rerender(
            <React.Suspense fallback={<div data-testid="suspended">Suspended</div>}>
              <StudentRuntimeProvider
                state={mockExamState}
                onExit={() => undefined}
                runtimeBacked
                runtimeSnapshot={{
                  ...committedRuntime,
                  currentSectionRemainingSeconds: 5,
                  currentSectionDeadlineAt: '2026-01-01T00:00:05.000Z',
                }}
                attemptSnapshot={attemptSnapshot}
              >
                <DisplayProbe suspend />
              </StudentRuntimeProvider>
            </React.Suspense>,
          );
        });
      });

      act(() => {
        rerender(
          <React.Suspense fallback={<div data-testid="suspended">Suspended</div>}>
            <StudentRuntimeProvider
              state={mockExamState}
              onExit={() => undefined}
              runtimeBacked
              runtimeSnapshot={committedRuntime}
              attemptSnapshot={attemptSnapshot}
            >
              <DisplayProbe suspend={false} />
            </StudentRuntimeProvider>
          </React.Suspense>,
        );
      });

      expect(screen.getByTestId('remaining')).toHaveTextContent('10');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the committed deadline and answer lock intact after a shorter-deadline render is abandoned', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const suspendedPromise = new Promise<never>(() => undefined);
    const attemptSnapshot = {
      ...buildCompletedPreCheckAttempt(),
      phase: 'exam' as const,
      currentModule: 'writing' as const,
      currentQuestionId: 'task1',
    };
    const committedRuntime = {
      ...createRuntimeSnapshot('writing'),
      currentSectionRemainingSeconds: 10,
      currentSectionDeadlineAt: '2026-01-01T00:00:10.000Z',
      serverNow: '2026-01-01T00:00:00.000Z',
    };
    // The discarded render carries a deadline that has ALREADY expired. If the
    // timer anchor were mutated during that abandoned render, the committed
    // tree would inherit the expired deadline: countdown zero, answers locked.
    const discardedRuntime = {
      ...committedRuntime,
      currentSectionRemainingSeconds: 0,
      currentSectionDeadlineAt: '2026-01-01T00:00:00.000Z',
    };

    function TimerProbe({ suspend }: { suspend: boolean }) {
      if (suspend) {
        throw suspendedPromise;
      }

      const { state } = useStudentRuntime();
      return (
        <div>
          <span data-testid="remaining">{state.displayTimeRemaining}</span>
          <span data-testid="locked">{String(state.answerControlsLocked)}</span>
        </div>
      );
    }

    try {
      const { rerender } = render(
        <React.Suspense fallback={<div data-testid="suspended">Suspended</div>}>
          <StudentRuntimeProvider
            state={mockExamState}
            onExit={() => undefined}
            runtimeBacked
            runtimeSnapshot={committedRuntime}
            attemptSnapshot={attemptSnapshot}
          >
            <TimerProbe suspend={false} />
          </StudentRuntimeProvider>
        </React.Suspense>,
      );

      expect(screen.getByTestId('remaining')).toHaveTextContent('10');
      expect(screen.getByTestId('locked')).toHaveTextContent('false');

      // Begin rendering the expired-deadline snapshot, then abandon it before
      // it commits (the child suspends mid-render).
      act(() => {
        React.startTransition(() => {
          rerender(
            <React.Suspense fallback={<div data-testid="suspended">Suspended</div>}>
              <StudentRuntimeProvider
                state={mockExamState}
                onExit={() => undefined}
                runtimeBacked
                runtimeSnapshot={discardedRuntime}
                attemptSnapshot={attemptSnapshot}
              >
                <TimerProbe suspend />
              </StudentRuntimeProvider>
            </React.Suspense>,
          );
        });
      });

      // The committed tree still owns the 10s deadline: countdown and answer
      // lock must follow the committed snapshot, never the discarded one.
      act(() => {
        rerender(
          <React.Suspense fallback={<div data-testid="suspended">Suspended</div>}>
            <StudentRuntimeProvider
              state={mockExamState}
              onExit={() => undefined}
              runtimeBacked
              runtimeSnapshot={committedRuntime}
              attemptSnapshot={attemptSnapshot}
            >
              <TimerProbe suspend={false} />
            </StudentRuntimeProvider>
          </React.Suspense>,
        );
      });

      expect(screen.getByTestId('remaining')).toHaveTextContent('10');
      expect(screen.getByTestId('locked')).toHaveTextContent('false');

      // The ticker continues from the committed anchor: five seconds later the
      // countdown shows 5, not a countdown inherited from the discarded render.
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByTestId('remaining')).toHaveTextContent('5');
      expect(screen.getByTestId('locked')).toHaveTextContent('false');

      // Positive control: when the committed deadline really expires, the
      // countdown hits zero and answers lock — the probe measures the real gate.
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.getByTestId('remaining')).toHaveTextContent('0');
      expect(screen.getByTestId('locked')).toHaveTextContent('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the adjusted server clock for a malformed deadline fallback', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const validRuntime = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 70,
        currentSectionDeadlineAt: '2026-01-01T00:01:10.000Z',
        serverNow: '2026-01-01T00:01:00.000Z',
      };
      const attemptSnapshot = {
        ...buildCompletedPreCheckAttempt(),
        phase: 'exam' as const,
        currentModule: 'writing' as const,
        currentQuestionId: 'task1',
      };
      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      const { rerender } = render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={validRuntime}
          attemptSnapshot={attemptSnapshot}
        >
          <DisplayProbe />
        </StudentRuntimeProvider>,
      );

      expect(screen.getByTestId('remaining')).toHaveTextContent('10');

      act(() => {
        rerender(
          <StudentRuntimeProvider
            state={mockExamState}
            onExit={() => undefined}
            runtimeBacked
            runtimeSnapshot={{
              ...validRuntime,
              currentSectionRemainingSeconds: 5,
              currentSectionDeadlineAt: 'not-a-date',
              serverNow: 'not-a-date',
            }}
            attemptSnapshot={attemptSnapshot}
          >
            <DisplayProbe />
          </StudentRuntimeProvider>,
        );
      });

      expect(screen.getByTestId('remaining')).toHaveTextContent('5');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the runtime ticker independent from an attempt update storm', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 10,
        currentSectionDeadlineAt: '2026-01-01T00:00:10.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
      };
      const attemptSnapshot = {
        ...buildCompletedPreCheckAttempt(),
        phase: 'exam' as const,
        currentModule: 'writing' as const,
        currentQuestionId: 'task1',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      const { rerender } = render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
          attemptSnapshot={attemptSnapshot}
        >
          <DisplayProbe />
        </StudentRuntimeProvider>,
      );

      for (let elapsedMs = 0; elapsedMs < 1_200; elapsedMs += 50) {
        act(() => {
          rerender(
            <StudentRuntimeProvider
              state={mockExamState}
              onExit={() => undefined}
              runtimeBacked
              runtimeSnapshot={runtimeSnapshot}
              attemptSnapshot={{
                ...attemptSnapshot,
                answers: { q1: String(elapsedMs) },
                updatedAt: new Date(elapsedMs).toISOString(),
              }}
            >
              <DisplayProbe />
            </StudentRuntimeProvider>,
          );
          vi.advanceTimersByTime(50);
        });
      }

      expect(screen.getByTestId('remaining')).toHaveTextContent('9');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the countdown continuous through rapid non-timer runtime revisions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const baseRuntimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 10,
        currentSectionDeadlineAt: '2026-01-01T00:00:10.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
        revision: 1,
      };
      const attemptSnapshot = {
        ...buildCompletedPreCheckAttempt(),
        phase: 'exam' as const,
        currentModule: 'writing' as const,
        currentQuestionId: 'task1',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      const { rerender } = render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={baseRuntimeSnapshot}
          attemptSnapshot={attemptSnapshot}
        >
          <DisplayProbe />
        </StudentRuntimeProvider>,
      );

      for (let elapsedMs = 0; elapsedMs < 1_200; elapsedMs += 100) {
        act(() => {
          rerender(
            <StudentRuntimeProvider
              state={mockExamState}
              onExit={() => undefined}
              runtimeBacked
              runtimeSnapshot={{
                ...baseRuntimeSnapshot,
                revision: 2 + elapsedMs / 100,
                updatedAt: new Date(elapsedMs).toISOString(),
                cohortName: `Cohort ${elapsedMs}`,
              }}
              attemptSnapshot={attemptSnapshot}
            >
              <DisplayProbe />
            </StudentRuntimeProvider>,
          );
          vi.advanceTimersByTime(100);
        });
      }

      expect(screen.getByTestId('remaining')).toHaveTextContent('9');
    } finally {
      vi.useRealTimers();
    }
  });

  it('anchors the display on a missing deadline and emits the missing-deadline metric', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const metricNames: string[] = [];
    const metricListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ name?: string }>;
      if (customEvent.detail?.name) {
        metricNames.push(customEvent.detail.name);
      }
    };
    window.addEventListener('student-observability-metric', metricListener as EventListener);

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionDeadlineAt: null,
        currentSectionRemainingSeconds: 5,
        serverNow: '2026-01-01T00:00:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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

      expect(screen.getByTestId('remaining')).toHaveTextContent('5');

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByTestId('remaining')).toHaveTextContent('4');

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByTestId('remaining')).toHaveTextContent('3');

      expect(metricNames).toContain('student_timer_missing_deadline_total');
    } finally {
      window.removeEventListener('student-observability-metric', metricListener as EventListener);
      vi.useRealTimers();
    }
  });

  it('emits the missing-deadline metric and refresh call exactly once across polls that only move sampling metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const metricNames: string[] = [];
    const metricListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ name?: string }>;
      if (customEvent.detail?.name) {
        metricNames.push(customEvent.detail.name);
      }
    };
    window.addEventListener('student-observability-metric', metricListener as EventListener);

    const onRefreshRuntime = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    try {
      const firstPoll = {
        ...createRuntimeSnapshot('writing'),
        currentSectionDeadlineAt: null,
        currentSectionRemainingSeconds: 5,
        serverNow: '2026-01-01T00:00:00.000Z',
        revision: 7,
      };
      // Real poll responses advance the sampling metadata (serverNow) and the
      // remaining-seconds value, but the deadline episode is unchanged.
      const secondPoll = {
        ...firstPoll,
        currentSectionRemainingSeconds: 3,
        serverNow: '2026-01-01T00:00:02.000Z',
        updatedAt: '2026-01-01T00:00:02.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      const { rerender } = render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          onRefreshRuntime={onRefreshRuntime}
          runtimeBacked
          runtimeSnapshot={firstPoll}
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

      act(() => {
        rerender(
          <StudentRuntimeProvider
            state={mockExamState}
            onExit={() => undefined}
            onRefreshRuntime={onRefreshRuntime}
            runtimeBacked
            runtimeSnapshot={secondPoll}
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
      });

      expect(
        metricNames.filter((name) => name === 'student_timer_missing_deadline_total'),
      ).toHaveLength(1);
      expect(onRefreshRuntime).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('student-observability-metric', metricListener as EventListener);
      vi.useRealTimers();
    }
  });

  it.each(['', 'not-a-date', '1234567890'])('anchors the display on invalid deadline %j and emits the invalid-deadline metric', (invalidDeadline) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const metricNames: string[] = [];
    const metricListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ name?: string }>;
      if (customEvent.detail?.name) {
        metricNames.push(customEvent.detail.name);
      }
    };
    window.addEventListener('student-observability-metric', metricListener as EventListener);

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionDeadlineAt: invalidDeadline,
        currentSectionRemainingSeconds: 5,
        serverNow: '2026-01-01T00:00:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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

      expect(screen.getByTestId('remaining')).toHaveTextContent('5');

      act(() => {
        vi.advanceTimersByTime(2_000);
      });

      // Anchored from serverNow + remaining seconds: 00:00:05 -> 00:00:03.
      expect(screen.getByTestId('remaining')).toHaveTextContent('3');
      expect(metricNames).toContain('student_timer_invalid_deadline_total');
    } finally {
      window.removeEventListener('student-observability-metric', metricListener as EventListener);
      vi.useRealTimers();
    }
  });

  it('continues the deadline countdown while the browser is offline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const onlineDescriptor = Object.getOwnPropertyDescriptor(navigator, 'onLine');

    try {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      });

      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 5,
        currentSectionDeadlineAt: '2026-01-01T00:00:05.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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

      for (let expected = 4; expected >= 0; expected -= 1) {
        act(() => {
          vi.advanceTimersByTime(1_000);
        });
        expect(screen.getByTestId('remaining')).toHaveTextContent(String(expected));
      }
    } finally {
      if (onlineDescriptor) {
        Object.defineProperty(navigator, 'onLine', onlineDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'onLine');
      }
      vi.useRealTimers();
    }
  });

  it('recalculates the deadline immediately after visibility restoration', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 10,
        currentSectionDeadlineAt: '2026-01-01T00:00:10.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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

      expect(screen.getByTestId('remaining')).toHaveTextContent('10');
      vi.setSystemTime(new Date('2026-01-01T00:00:08.000Z'));

      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      expect(screen.getByTestId('remaining')).toHaveTextContent('2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows zero immediately when the deadline expires during timer suspension', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 5,
        currentSectionDeadlineAt: '2026-01-01T00:00:05.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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

      vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
      act(() => {
        window.dispatchEvent(new Event('pageshow'));
      });

      expect(screen.getByTestId('remaining')).toHaveTextContent('0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('catches up to the absolute deadline after a delayed timer callback', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 5,
        currentSectionDeadlineAt: '2026-01-01T00:00:05.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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

      vi.setSystemTime(new Date('2026-01-01T00:00:06.000Z'));
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(screen.getByTestId('remaining')).toHaveTextContent('0');
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits student_timer_stall_total when the visible ticker stalls, and does not fire on a normal ticker or when offline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const metricNames: string[] = [];
    const metricListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ name?: string }>;
      if (customEvent.detail?.name) {
        metricNames.push(customEvent.detail.name);
      }
    };
    window.addEventListener('student-observability-metric', metricListener as EventListener);

    const originalOnLine = navigator.onLine;
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');

    try {
      const runtimeSnapshot = {
        ...createRuntimeSnapshot('writing'),
        currentSectionRemainingSeconds: 30,
        currentSectionDeadlineAt: '2026-01-01T00:00:30.000Z',
        serverNow: '2026-01-01T00:00:00.000Z',
      };

      function DisplayProbe() {
        const { state } = useStudentRuntime();
        return <div data-testid="remaining">{state.displayTimeRemaining}</div>;
      }

      render(
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={() => undefined}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
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

      // Baseline: 30 seconds on display.
      expect(screen.getByTestId('remaining')).toHaveTextContent('30');

      // Advance in small steps, flushing effects after every step (as real
      // browser tasks would). The ticker's derivedClockNowMs updates on each
      // second boundary; the stall interval fires every 500ms.
      const tick = (ms: number) => {
        act(() => {
          vi.advanceTimersByTime(ms);
        });
      };

      // Normal operation: the ticker advances every second, so the stall
      // detector must stay silent even though the interval fires repeatedly.
      tick(500);
      tick(500);
      expect(screen.getByTestId('remaining')).toHaveTextContent('29');
      tick(500);
      tick(500);
      expect(screen.getByTestId('remaining')).toHaveTextContent('28');
      tick(500);
      tick(500);
      expect(screen.getByTestId('remaining')).toHaveTextContent('27');
      tick(500);
      tick(500);
      expect(screen.getByTestId('remaining')).toHaveTextContent('26');
      tick(500);
      tick(500);
      expect(screen.getByTestId('remaining')).toHaveTextContent('25');
      tick(500);
      tick(500);
      expect(screen.getByTestId('remaining')).toHaveTextContent('24');
      expect(metricNames).not.toContain('student_timer_stall_total');

      // Stall: freeze the visible-second ticker. The ticker schedules its next
      // run via window.setTimeout; once frozen, derivedClockNowMs stops
      // updating while the 500ms stall interval keeps running. After >1500ms
      // of wall time the expected remaining countdown has moved but the
      // visible remaining has not -> stall emitted once.
      // Spy on the real timer backing: vi.useFakeTimers() replaces
      // window.setTimeout with a sinon fake, so capture it BEFORE faking.
      const realWindowSetTimeout = window.setTimeout.bind(window);
      const tickerTimeoutCalls = setTimeoutSpy.mock.calls.length;
      const frozenSetTimeout = vi.fn((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (setTimeoutSpy.mock.calls.length >= tickerTimeoutCalls + 1) {
          // Freeze further ticker reschedules: the pending tick runs once
          // more (updating the display to 23) but schedules nothing after.
          return 0 as unknown as number;
        }
        return realWindowSetTimeout(handler as () => void, delay, ...args);
      });
      setTimeoutSpy.mockImplementation(frozenSetTimeout as unknown as typeof window.setTimeout);

      // The last real tick landed at t=7000 (display 23) and reset the stall
      // detector's baseline there; the detector needs wallElapsed > 1500ms
      // since that baseline, so the stall is only detectable from t=9000 on.
      tick(500);
      tick(500);
      tick(500);
      tick(500);
      tick(500);
      tick(500);
      tick(500);
      tick(500);
      expect(metricNames).toContain('student_timer_stall_total');
      const stallCountAfterEmit = metricNames.filter(
        (name) => name === 'student_timer_stall_total',
      ).length;

      // Still stalled: must not double-emit.
      tick(500);
      tick(500);
      tick(500);
      tick(500);
      expect(
        metricNames.filter((name) => name === 'student_timer_stall_total').length,
      ).toBe(stallCountAfterEmit);

      // Offline: the stall detector must not fire.
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      try {
        tick(500);
        tick(500);
        tick(500);
        tick(500);
        tick(500);
        tick(500);
        expect(
          metricNames.filter((name) => name === 'student_timer_stall_total').length,
        ).toBe(stallCountAfterEmit);
      } finally {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => originalOnLine });
      }
    } finally {
      setTimeoutSpy.mockRestore();
      if (visibilityDescriptor) {
        Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
      }
      window.removeEventListener('student-observability-metric', metricListener as EventListener);
      vi.useRealTimers();
    }
  });

  it('keeps a live student in the exam phase when an older not_started runtime is re-delivered (FEX-012)', () => {
    const attempt = buildCompletedPreCheckAttempt();
    const notStartedRuntime: ExamSessionRuntime = {
      ...createRuntimeSnapshot('listening'),
      status: 'not_started',
      activeSectionKey: null,
      currentSectionKey: null,
      currentSectionRemainingSeconds: 0,
      waitingForNextSection: false,
      sections: [],
    };

    function Probe() {
      const runtime = useStudentRuntime();
      return (
        <>
          <span data-testid="phase">{runtime.state.phase}</span>
          <span data-testid="blocking">{runtime.state.blocking.reason ?? 'none'}</span>
        </>
      );
    }

    const { rerender } = render(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={attempt}
        runtimeBacked
        runtimeSnapshot={notStartedRuntime}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('lobby');

    // The proctor starts the cohort: the waiting lobby promotes to the exam.
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={attempt}
        runtimeBacked
        runtimeSnapshot={createRuntimeSnapshot('listening')}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');

    // An older out-of-order not_started response arrives after the live one:
    // the student must NOT be bounced back to the lobby. The exam phase is
    // monotonic; the stale status only locks the workspace (blocking overlay).
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={attempt}
        runtimeBacked
        runtimeSnapshot={notStartedRuntime}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
    expect(screen.getByTestId('blocking')).toHaveTextContent('not_started');
  });

  it('keeps the local module advance only while the runtime lags, and lets newer runtime revisions win (FEX-012)', () => {
    const attempt = buildCompletedPreCheckAttempt();
    const listeningRuntime = createRuntimeSnapshot('listening');
    const readingRuntime = createRuntimeSnapshot('reading');
    const writingRuntime = createRuntimeSnapshot('writing');
    const completedRuntime: ExamSessionRuntime = {
      ...createRuntimeSnapshot('writing'),
      status: 'completed',
      actualEndAt: '2026-01-01T01:00:00.000Z',
    };

    function Probe() {
      const runtime = useStudentRuntime();
      return (
        <>
          <span data-testid="phase">{runtime.state.phase}</span>
          <span data-testid="module">{runtime.state.currentModule}</span>
          <button type="button" onClick={() => runtime.actions.submitModule()}>
            Submit section
          </button>
        </>
      );
    }

    const { rerender } = render(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={attempt}
        runtimeBacked
        runtimeSnapshot={listeningRuntime}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
    expect(screen.getByTestId('module')).toHaveTextContent('listening');

    // Local advance: the student submits the listening section and moves to
    // reading locally while the runtime has not advanced yet.
    fireEvent.click(screen.getByRole('button', { name: 'Submit section' }));
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
    expect(screen.getByTestId('module')).toHaveTextContent('reading');

    // An older runtime revision still pointing at the submitted section must
    // not yank the student back: the transient local advance is preserved.
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={attempt}
        runtimeBacked
        runtimeSnapshot={{ ...listeningRuntime, revision: 1 }}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
    expect(screen.getByTestId('module')).toHaveTextContent('reading');

    // A newer revision that caught up to reading applies normally: the local
    // advance converges with the runtime position.
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={attempt}
        runtimeBacked
        runtimeSnapshot={{ ...readingRuntime, revision: 2 }}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
    expect(screen.getByTestId('module')).toHaveTextContent('reading');

    // A newer revision that jumped ahead (writing) wins over the transient
    // local advance: the runtime position is authoritative.
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={attempt}
        runtimeBacked
        runtimeSnapshot={{ ...writingRuntime, revision: 3 }}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
    expect(screen.getByTestId('module')).toHaveTextContent('writing');

    // A newer terminal revision wins unconditionally: the local advance can
    // never override verified completion.
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={attempt}
        runtimeBacked
        runtimeSnapshot={{ ...completedRuntime, revision: 4 }}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('post-exam');
  });

  it('keeps a pending pre-check on the briefing while the runtime is already live, and promotes only when the pre-check completes (FEX-010 hydrate_attempt gate)', () => {
    const pendingAttempt = { ...baseAttempt, phase: 'pre-check' };
    const completedAttempt = buildCompletedPreCheckAttempt();

    function Probe() {
      const runtime = useStudentRuntime();
      return (
        <>
          <span data-testid="phase">{runtime.state.phase}</span>
          <span data-testid="module">{runtime.state.currentModule}</span>
        </>
      );
    }

    // Mount with a pending pre-check while the runtime is already live: the
    // student must stay on the briefing — an active runtime never promotes a
    // briefing that has not been completed (FEX-010).
    const { rerender } = render(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={pendingAttempt}
        runtimeBacked
        runtimeSnapshot={createRuntimeSnapshot('listening')}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('pre-check');

    // A fresh attempt revision (new updatedAt) re-fires the attempt hydration
    // effect; the gate still holds: pending pre-check + live runtime stays on
    // the briefing (FEX-010).
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={{ ...pendingAttempt, updatedAt: '2026-01-01T00:02:00.000Z' }}
        runtimeBacked
        runtimeSnapshot={createRuntimeSnapshot('listening')}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('pre-check');

    // The pre-check completes and the next attempt revision arrives: the
    // pending briefing now converges with the already-live runtime instead of
    // deadlocking — promotion to the exam phase succeeds (FEX-012).
    rerender(
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        attemptSnapshot={{ ...completedAttempt, updatedAt: '2026-01-01T00:03:00.000Z' }}
        runtimeBacked
        runtimeSnapshot={createRuntimeSnapshot('listening')}
      >
        <Probe />
      </StudentRuntimeProvider>,
    );
    expect(screen.getByTestId('phase')).toHaveTextContent('exam');
    expect(screen.getByTestId('module')).toHaveTextContent('listening');
  });
});
