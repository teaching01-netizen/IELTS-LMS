import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';
import type { ExamConfig, ExamState, ViolationSeverity } from '../../../../types';
import type { ExamSessionRuntime } from '../../../../types/domain';
import type { StudentAttempt } from '../../../../types/studentAttempt';

// Mock ExamConfig
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
    requireFullscreen: true,
    tabSwitchRule: 'warn',
    detectSecondaryScreen: true,
    blockClipboard: true,
    preventAutofill: true,
    preventAutocorrect: true,
    preventTranslation: true,
    fullscreenAutoReentry: true,
    fullscreenMaxViolations: 3,
    proctoringFlags: {
      webcam: true,
      audio: true,
      screen: true,
    },
  },
};

// Mock ExamState
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

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <StudentRuntimeProvider state={mockExamState} onExit={vi.fn()}>
    {children}
  </StudentRuntimeProvider>
);

const hydratedAttempt: StudentAttempt = {
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
  violations: [
    {
      id: 'violation-1',
      type: 'TAB_SWITCH',
      severity: 'medium',
      timestamp: '2026-01-01T00:00:00.000Z',
      description: 'Tab hidden',
    },
  ],
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

function withCompletedPrecheck(attempt: StudentAttempt): StudentAttempt {
  return {
    ...attempt,
    integrity: {
      ...attempt.integrity,
      preCheck: {
        completedAt: '2026-01-01T00:00:00.000Z',
        browserFamily: 'chrome',
        browserVersion: 120,
        screenDetailsSupported: true,
        heartbeatReady: true,
        acknowledgedSafariLimitation: false,
        checks: [],
      },
    },
  };
}

function createRuntimeSnapshot(
  sectionKey: ExamSessionRuntime['currentSectionKey'],
  remainingSeconds = 120,
): ExamSessionRuntime {
  const now = '2026-01-01T00:00:00.000Z';

  return {
    id: 'runtime-1',
    scheduleId: hydratedAttempt.scheduleId,
    examId: hydratedAttempt.examId,
    examTitle: hydratedAttempt.examTitle,
    cohortName: 'Cohort A',
    deliveryMode: 'proctor_start',
    status: 'live',
    actualStartAt: now,
    actualEndAt: null,
    activeSectionKey: sectionKey,
    currentSectionKey: sectionKey,
    currentSectionRemainingSeconds: remainingSeconds,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    sections: [
      {
        sectionKey,
        label: sectionKey ? sectionKey[0].toUpperCase() + sectionKey.slice(1) : 'Section',
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

describe('StudentRuntimeProvider - Violation Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addViolation action', () => {
    it('should add a violation to the violations array', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.addViolation('TAB_SWITCH', 'medium', 'Tab switching detected');
      });

      expect(result.current.state.violations).toHaveLength(1);
      expect(result.current.state.violations[0]).toMatchObject({
        type: 'TAB_SWITCH',
        severity: 'medium',
        description: 'Tab switching detected',
      });
      expect(result.current.state.violations[0].id).toMatch(/^v-\d+-[a-z0-9]+$/);
      expect(result.current.state.violations[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should increment fullscreenViolationCount for FULLSCREEN_EXIT violations', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.addViolation('FULLSCREEN_EXIT', 'high', 'Fullscreen exited');
      });

      expect(result.current.state.fullscreenViolationCount).toBe(1);

      act(() => {
        result.current.actions.addViolation('FULLSCREEN_EXIT', 'high', 'Fullscreen exited again');
      });

      expect(result.current.state.fullscreenViolationCount).toBe(2);
    });

    it('should not increment fullscreenViolationCount for other violation types', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.addViolation('TAB_SWITCH', 'medium', 'Tab switching detected');
      });

      expect(result.current.state.fullscreenViolationCount).toBe(0);

      act(() => {
        result.current.actions.addViolation('SECONDARY_SCREEN', 'high', 'Multiple screens detected');
      });

      expect(result.current.state.fullscreenViolationCount).toBe(0);
    });

    it('should support all severity levels', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.addViolation('TEST_LOW', 'low', 'Low severity');
        result.current.actions.addViolation('TEST_MEDIUM', 'medium', 'Medium severity');
        result.current.actions.addViolation('TEST_HIGH', 'high', 'High severity');
        result.current.actions.addViolation('TEST_CRITICAL', 'critical', 'Critical severity');
      });

      expect(result.current.state.violations).toHaveLength(4);
      expect(result.current.state.violations[0].severity).toBe('low');
      expect(result.current.state.violations[1].severity).toBe('medium');
      expect(result.current.state.violations[2].severity).toBe('high');
      expect(result.current.state.violations[3].severity).toBe('critical');
    });
  });

  describe('clearViolations action', () => {
    it('should clear all violations from the array', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.addViolation('TAB_SWITCH', 'medium', 'Tab switching detected');
        result.current.actions.addViolation('FULLSCREEN_EXIT', 'high', 'Fullscreen exited');
      });

      expect(result.current.state.violations).toHaveLength(2);

      act(() => {
        result.current.actions.clearViolations();
      });

      expect(result.current.state.violations).toHaveLength(0);
    });

    it('should reset fullscreenViolationCount to zero', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.addViolation('FULLSCREEN_EXIT', 'high', 'Fullscreen exited');
        result.current.actions.addViolation('FULLSCREEN_EXIT', 'high', 'Fullscreen exited again');
      });

      expect(result.current.state.fullscreenViolationCount).toBe(2);

      act(() => {
        result.current.actions.clearViolations();
      });

      expect(result.current.state.fullscreenViolationCount).toBe(0);
    });
  });

  describe('terminateExam action', () => {
    it('should set phase to post-exam', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      // Start the exam first
      act(() => {
        result.current.actions.startExam();
      });

      expect(result.current.state.phase).toBe('exam');

      // Terminate the exam
      act(() => {
        result.current.actions.terminateExam();
      });

      expect(result.current.state.phase).toBe('post-exam');
    });

    it('should preserve violations when terminating', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.addViolation('TAB_SWITCH', 'medium', 'Tab switching detected');
        result.current.actions.terminateExam();
      });

      expect(result.current.state.violations).toHaveLength(1);
      expect(result.current.state.phase).toBe('post-exam');
    });
  });

  describe('violation state persistence', () => {
    it('should maintain violation count across multiple violations', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        for (let i = 0; i < 5; i++) {
          result.current.actions.addViolation(`VIOLATION_${i}`, 'medium', `Violation ${i}`);
        }
      });

      expect(result.current.state.violations).toHaveLength(5);
      expect(result.current.state.fullscreenViolationCount).toBe(0);

      // Add fullscreen violations
      act(() => {
        result.current.actions.addViolation('FULLSCREEN_EXIT', 'high', 'Fullscreen exited 1');
        result.current.actions.addViolation('FULLSCREEN_EXIT', 'high', 'Fullscreen exited 2');
      });

      expect(result.current.state.violations).toHaveLength(7);
      expect(result.current.state.fullscreenViolationCount).toBe(2);
    });

    it('should generate unique violation IDs', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.addViolation('VIOLATION_1', 'medium', 'First');
        result.current.actions.addViolation('VIOLATION_2', 'medium', 'Second');
      });

      const ids = result.current.state.violations.map(v => v.id);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe('integration with other actions', () => {
    it('should allow violations during exam phase', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.startExam();
        result.current.actions.addViolation('TAB_SWITCH', 'medium', 'Tab switching detected');
      });

      expect(result.current.state.phase).toBe('exam');
      expect(result.current.state.violations).toHaveLength(1);
    });

    it('should allow violations in pre-check phase', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.addViolation('TEST', 'low', 'Test violation');
      });

      expect(result.current.state.phase).toBe('pre-check');
      expect(result.current.state.violations).toHaveLength(1);
    });

    it('should allow violations in lobby phase', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper });

      act(() => {
        result.current.actions.setPhase('lobby');
        result.current.actions.addViolation('TEST', 'low', 'Test violation');
      });

      expect(result.current.state.phase).toBe('lobby');
      expect(result.current.state.violations).toHaveLength(1);
    });
  });

  describe('attempt hydration and blocking state', () => {
    const hydratedWrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider state={mockExamState} onExit={vi.fn()} attemptSnapshot={hydratedAttempt}>
        {children}
      </StudentRuntimeProvider>
    );

    it('hydrates answers, flags, writing answers, position, and violations from attempt snapshot', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper: hydratedWrapper });

      expect(result.current.state.phase).toBe('exam');
      expect(result.current.state.currentModule).toBe('writing');
      expect(result.current.state.currentQuestionId).toBe('task-2');
      expect(result.current.state.answers).toEqual({ q1: 'A' });
      expect(result.current.state.writingAnswers).toEqual({ 'task-2': '<p>Draft</p>' });
      expect(result.current.state.flags).toEqual({ q1: true });
      expect(result.current.state.violations).toHaveLength(1);
      expect(result.current.state.attemptSyncState).toBe('saved');
    });

    it('preserves locally-recorded violations across attempt re-hydration refreshes', () => {
      let attemptSnapshot = hydratedAttempt;
      const wrapperWithAttempt = ({ children }: { children: React.ReactNode }) => (
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={vi.fn()}
          attemptSnapshot={attemptSnapshot}
        >
          {children}
        </StudentRuntimeProvider>
      );

      const { result, rerender } = renderHook(() => useStudentRuntime(), { wrapper: wrapperWithAttempt });

      act(() => {
        result.current.actions.addViolation('CLIPBOARD_BLOCKED', 'medium', 'Clipboard blocked');
      });

      const localViolation = result.current.state.violations.find(
        (violation) => violation.type === 'CLIPBOARD_BLOCKED',
      );
      expect(localViolation).toBeDefined();

      const refreshedAttempt: StudentAttempt = {
        ...hydratedAttempt,
        // Simulate the backend returning an older snapshot that doesn't include the local violation yet.
        violations: hydratedAttempt.violations,
        updatedAt: '2026-01-01T00:00:01.000Z',
      };

      act(() => {
        attemptSnapshot = refreshedAttempt;
        rerender();
      });

      expect(
        result.current.state.violations.some((violation) => violation.id === localViolation?.id),
      ).toBe(true);
    });

    it('supports explicit blocking reasons and sync-state updates', () => {
      const { result } = renderHook(() => useStudentRuntime(), { wrapper: hydratedWrapper });

      act(() => {
        result.current.actions.setBlockingReason('offline');
        result.current.actions.setAttemptSyncState('syncing_reconnect');
      });

      expect(result.current.state.blocking.reason).toBe('offline');
      expect(result.current.state.attemptSyncState).toBe('syncing_reconnect');
    });

    it('keeps the backend runtime section when a runtime-backed attempt snapshot is stale', () => {
      const attemptSnapshot = withCompletedPrecheck({
        ...hydratedAttempt,
        currentModule: 'listening',
        currentQuestionId: 'listening-q1',
      });
      const runtimeSnapshot = createRuntimeSnapshot('reading', 1800);
      const stateWithQuestions: ExamState = {
        ...mockExamState,
        reading: {
          passages: [
            {
              id: 'reading-passage-1',
              title: 'Reading Passage 1',
              text: '',
              blocks: [
                {
                  id: 'reading-q1',
                  type: 'SINGLE_MCQ',
                  instruction: 'Choose one.',
                  stem: 'Reading question',
                  options: [{ id: 'a', text: 'A', isCorrect: true }],
                },
              ],
            },
          ],
        },
        listening: {
          parts: [
            {
              id: 'listening-part-1',
              title: 'Listening Part 1',
              audioUrl: '',
              transcript: '',
              blocks: [
                {
                  id: 'listening-q1',
                  type: 'SINGLE_MCQ',
                  instruction: 'Choose one.',
                  stem: 'Listening question',
                  options: [{ id: 'a', text: 'A', isCorrect: true }],
                },
              ],
            },
          ],
        },
      };

      const runtimeBackedWrapper = ({ children }: { children: React.ReactNode }) => (
        <StudentRuntimeProvider
          state={stateWithQuestions}
          onExit={vi.fn()}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
          attemptSnapshot={attemptSnapshot}
        >
          {children}
        </StudentRuntimeProvider>
      );

      const { result } = renderHook(() => useStudentRuntime(), { wrapper: runtimeBackedWrapper });

      expect(result.current.state.currentModule).toBe('reading');
      expect(result.current.state.currentQuestionId).toBe('reading-q1');
    });

    it('advances immediately to the next section after submitting a runtime-backed module', () => {
      const attemptSnapshot = withCompletedPrecheck({
        ...hydratedAttempt,
        currentModule: 'listening',
        currentQuestionId: 'listening-q1',
      });
      const runtimeSnapshot = createRuntimeSnapshot('listening', 1800);
      const stateWithQuestions: ExamState = {
        ...mockExamState,
        reading: {
          passages: [
            {
              id: 'reading-passage-1',
              title: 'Reading Passage 1',
              text: '',
              blocks: [
                {
                  id: 'reading-q1',
                  type: 'SINGLE_MCQ',
                  instruction: 'Choose one.',
                  stem: 'Reading question',
                  options: [{ id: 'a', text: 'A', isCorrect: true }],
                },
              ],
            },
          ],
        },
        listening: {
          parts: [
            {
              id: 'listening-part-1',
              title: 'Listening Part 1',
              audioUrl: '',
              transcript: '',
              blocks: [
                {
                  id: 'listening-q1',
                  type: 'SINGLE_MCQ',
                  instruction: 'Choose one.',
                  stem: 'Listening question',
                  options: [{ id: 'a', text: 'A', isCorrect: true }],
                },
              ],
            },
          ],
        },
      };

      const runtimeBackedWrapper = ({ children }: { children: React.ReactNode }) => (
        <StudentRuntimeProvider
          state={stateWithQuestions}
          onExit={vi.fn()}
          runtimeBacked
          runtimeSnapshot={runtimeSnapshot}
          attemptSnapshot={attemptSnapshot}
        >
          {children}
        </StudentRuntimeProvider>
      );

      const { result } = renderHook(() => useStudentRuntime(), { wrapper: runtimeBackedWrapper });

      act(() => {
        result.current.actions.submitModule();
      });

      expect(result.current.state.currentModule).toBe('reading');
      expect(result.current.state.currentQuestionId).toBe('reading-q1');
      expect(result.current.state.waitingForCohortAdvance).toBe(false);
    });
  });
});

describe('StudentRuntimeProvider - Verified terminal guards', () => {
  it('does not enter post-exam when runtime is completed but structurally incomplete', () => {
    const attemptSnapshot: StudentAttempt = {
      ...hydratedAttempt,
      integrity: {
        ...hydratedAttempt.integrity,
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: attemptSnapshot.scheduleId,
      examId: attemptSnapshot.examId,
      examTitle: attemptSnapshot.examTitle,
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'completed',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'writing',
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 0,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 0,
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
      updatedAt: '2026-01-01T01:00:00.000Z',
    };

    const runtimeBackedWrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        runtimeBacked
        runtimeSnapshot={runtimeSnapshot}
        attemptSnapshot={attemptSnapshot}
      >
        {children}
      </StudentRuntimeProvider>
    );

    const { result } = renderHook(() => useStudentRuntime(), { wrapper: runtimeBackedWrapper });
    expect(result.current.state.phase).toBe('exam');
  });

  it('ignores unverified attempt post-exam phases', () => {
    const attemptSnapshot: StudentAttempt = {
      ...hydratedAttempt,
      phase: 'post-exam',
      proctorStatus: 'active',
      submittedAt: null,
      integrity: {
        ...hydratedAttempt.integrity,
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: attemptSnapshot.scheduleId,
      examId: attemptSnapshot.examId,
      examTitle: attemptSnapshot.examTitle,
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
          order: 0,
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

    const runtimeBackedWrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        runtimeBacked
        runtimeSnapshot={runtimeSnapshot}
        attemptSnapshot={attemptSnapshot}
      >
        {children}
      </StudentRuntimeProvider>
    );

    const { result } = renderHook(() => useStudentRuntime(), { wrapper: runtimeBackedWrapper });
    expect(result.current.state.phase).toBe('exam');
  });

  it('enters post-exam when the attempt has submittedAt even if runtime is live', () => {
    const attemptSnapshot: StudentAttempt = {
      ...hydratedAttempt,
      phase: 'exam',
      submittedAt: '2026-01-01T00:30:00.000Z',
      integrity: {
        ...hydratedAttempt.integrity,
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
      },
    };

    const runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: attemptSnapshot.scheduleId,
      examId: attemptSnapshot.examId,
      examTitle: attemptSnapshot.examTitle,
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
          order: 0,
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

    const runtimeBackedWrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        runtimeBacked
        runtimeSnapshot={runtimeSnapshot}
        attemptSnapshot={attemptSnapshot}
      >
        {children}
      </StudentRuntimeProvider>
    );

    const { result } = renderHook(() => useStudentRuntime(), { wrapper: runtimeBackedWrapper });
    expect(result.current.state.phase).toBe('post-exam');
  });
});

describe('StudentRuntimeProvider - Runtime timer smoothing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncs down when a runtime snapshot reports a lower backend remaining time in the same section', async () => {
    const attemptSnapshot: StudentAttempt = {
      ...hydratedAttempt,
      integrity: {
        ...hydratedAttempt.integrity,
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
      },
    };

    let runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: attemptSnapshot.scheduleId,
      examId: attemptSnapshot.examId,
      examTitle: attemptSnapshot.examTitle,
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'writing',
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 79,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 0,
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

    const runtimeBackedWrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        runtimeBacked
        runtimeSnapshot={runtimeSnapshot}
        attemptSnapshot={attemptSnapshot}
      >
        {children}
      </StudentRuntimeProvider>
    );

    const { result, rerender } = renderHook(() => useStudentRuntime(), {
      wrapper: runtimeBackedWrapper,
    });

    expect(result.current.state.phase).toBe('exam');
    expect(result.current.state.displayTimeRemaining).toBe(79);

    await act(async () => {
      runtimeSnapshot = {
        ...runtimeSnapshot,
        currentSectionRemainingSeconds: 74,
        updatedAt: '2026-01-01T00:00:05.000Z',
      };
      rerender();
    });

    expect(result.current.state.displayTimeRemaining).toBe(74);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.state.displayTimeRemaining).toBe(73);
  });

  it('jumps up immediately when a runtime snapshot increases remaining time (extension)', async () => {
    const attemptSnapshot: StudentAttempt = {
      ...hydratedAttempt,
      integrity: {
        ...hydratedAttempt.integrity,
        preCheck: {
          completedAt: '2026-01-01T00:00:00.000Z',
          browserFamily: 'chrome',
          browserVersion: 120,
          screenDetailsSupported: true,
          heartbeatReady: true,
          acknowledgedSafariLimitation: false,
          checks: [],
        },
      },
    };

    let runtimeSnapshot: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: attemptSnapshot.scheduleId,
      examId: attemptSnapshot.examId,
      examTitle: attemptSnapshot.examTitle,
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'writing',
      currentSectionKey: 'writing',
      currentSectionRemainingSeconds: 79,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [
        {
          sectionKey: 'writing',
          label: 'Writing',
          order: 0,
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

    const runtimeBackedWrapper = ({ children }: { children: React.ReactNode }) => (
      <StudentRuntimeProvider
        state={mockExamState}
        onExit={vi.fn()}
        runtimeBacked
        runtimeSnapshot={runtimeSnapshot}
        attemptSnapshot={attemptSnapshot}
      >
        {children}
      </StudentRuntimeProvider>
    );

    const { result, rerender } = renderHook(() => useStudentRuntime(), {
      wrapper: runtimeBackedWrapper,
    });

    expect(result.current.state.phase).toBe('exam');
    expect(result.current.state.displayTimeRemaining).toBe(79);

    await act(async () => {
      runtimeSnapshot = {
        ...runtimeSnapshot,
        currentSectionRemainingSeconds: 90,
        updatedAt: '2026-01-01T00:00:01.000Z',
      };
      rerender();
    });

    expect(result.current.state.displayTimeRemaining).toBe(90);
  });
});

describe('StudentRuntimeProvider - Progression locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prevents navigating back to a submitted module when lockAfterSubmit is enabled', () => {
    const { result } = renderHook(() => useStudentRuntime(), { wrapper });

    act(() => {
      result.current.actions.startExam();
    });

    const firstModule = result.current.state.currentModule;

    act(() => {
      result.current.actions.submitModule();
    });

    const afterSubmitModule = result.current.state.currentModule;
    expect(afterSubmitModule).not.toBe(firstModule);

    act(() => {
      result.current.actions.setCurrentModule(firstModule);
    });

    expect(result.current.state.currentModule).toBe(afterSubmitModule);
  });
});

describe('StudentRuntimeProvider - Proctor Interventions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates proctor pause updates even while the attempt is syncing', async () => {
    const initialAttempt: StudentAttempt = {
      ...hydratedAttempt,
      phase: 'exam',
      proctorStatus: 'active',
      proctorNote: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    let updateAttemptSnapshot: ((next: StudentAttempt) => void) | null = null;

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      const [attemptSnapshot, setAttemptSnapshot] = React.useState(initialAttempt);

      React.useEffect(() => {
        updateAttemptSnapshot = setAttemptSnapshot;
        return () => {
          updateAttemptSnapshot = null;
        };
      }, []);

      return (
        <StudentRuntimeProvider
          state={mockExamState}
          onExit={vi.fn()}
          attemptSnapshot={attemptSnapshot}
        >
          {children}
        </StudentRuntimeProvider>
      );
    };

    const { result } = renderHook(() => useStudentRuntime(), { wrapper: Wrapper });

    act(() => {
      result.current.actions.setAttemptSyncState('saving');
    });

    await act(async () => {
      updateAttemptSnapshot?.({
        ...initialAttempt,
        updatedAt: '2026-01-01T00:00:02.000Z',
        proctorStatus: 'paused',
        proctorNote: 'Suspicious activity detected',
        proctorUpdatedAt: '2026-01-01T00:00:02.000Z',
        proctorUpdatedBy: 'Proctor',
      });
    });

    await waitFor(() => {
      expect(result.current.state.proctorStatus).toBe('paused');
      expect(result.current.state.blocking.reason).toBe('proctor_paused');
    });
  });
});
