import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProctoringProvider, useProctoring } from '../StudentProctoringProvider';
import { StudentAttemptProvider } from '../StudentAttemptProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';
import type { ExamConfig, ExamState } from '../../../types';
import type { StudentAttempt } from '../../../../types/studentAttempt';

const mockConfig: ExamConfig = {
  general: {
    preset: 'Academic',
    type: 'Academic',
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
    preventAutofill: true,
    preventAutocorrect: true,
    fullscreenAutoReentry: true,
    fullscreenMaxViolations: 3,
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

function renderHarness(config: ExamConfig = mockConfig) {
  const attemptSnapshot: StudentAttempt = {
    id: 'attempt-1',
    scheduleId: 'sched-1',
    studentKey: 'student-sched-1-alice',
    examId: 'exam-1',
    examTitle: 'Test Exam',
    candidateId: 'alice',
    candidateName: 'Alice Roe',
    candidateEmail: 'alice@example.com',
    phase: 'exam',
    currentModule: 'listening',
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

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <StudentRuntimeProvider
      state={mockExamState}
      onExit={vi.fn()}
      attemptSnapshot={attemptSnapshot}
    >
      <StudentAttemptProvider
        scheduleId={attemptSnapshot.scheduleId}
        attemptSnapshot={attemptSnapshot}
      >
        <ProctoringProvider config={config} scheduleId={attemptSnapshot.scheduleId}>
          {children}
        </ProctoringProvider>
      </StudentAttemptProvider>
    </StudentRuntimeProvider>
  );

  const harness = renderHook(
    () => ({
      proctoring: useProctoring(),
      runtime: useStudentRuntime(),
    }),
    { wrapper },
  );

  act(() => {
    harness.result.current.runtime.actions.startExam();
  });

  return harness;
}

describe('StudentProctoringProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    sessionStorage.clear();

    Object.defineProperty(document, 'fullscreenElement', {
      writable: true,
      configurable: true,
      value: null,
    });
    Object.defineProperty(document, 'hidden', {
      writable: true,
      configurable: true,
      value: false,
    });
    Object.defineProperty(window, 'getScreenDetails', {
      value: undefined,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a violation through the shared runtime', () => {
    const harness = renderHarness();

    act(() => {
      harness.result.current.proctoring.handleViolation(
        'TEST_VIOLATION',
        'Test violation message',
        'medium',
      );
    });

    expect(harness.result.current.runtime.state.violations).toHaveLength(1);
    expect(harness.result.current.runtime.state.violations[0]?.type).toBe('TEST_VIOLATION');
  });

  it('applies cooldowns per violation type', () => {
    const harness = renderHarness();

    act(() => {
      harness.result.current.proctoring.handleViolation('TEST_VIOLATION', 'First violation');
      harness.result.current.proctoring.handleViolation('TEST_VIOLATION', 'Second violation');
    });

    expect(harness.result.current.runtime.state.violations).toHaveLength(1);
  });

  it('logs a tab-switch warning when the tab is hidden', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'warn' },
    });

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(true);
  });

  it('logs a tab-switch warning on window blur', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'warn' },
    });

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(true);
  });

  it('terminates the exam when tab-switch policy is terminate', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'terminate' },
    });

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(harness.result.current.runtime.state.phase).toBe('post-exam');
  });

  it('requests fullscreen re-entry when fullscreen is lost', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
    });

    renderHarness();

    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
      document.dispatchEvent(new Event('fullscreenchange'));
      await Promise.resolve();
    });

    expect(requestFullscreen).toHaveBeenCalled();
  });

  it('requests fullscreen when the exam starts and fullscreen is required', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
    });

    renderHarness();

    await act(async () => {
      await Promise.resolve();
    });

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('terminates once fullscreen violations hit the configured limit', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, fullscreenMaxViolations: 1 },
    });

    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
      document.dispatchEvent(new Event('fullscreenchange'));
      await Promise.resolve();
    });

    expect(harness.result.current.runtime.state.phase).toBe('post-exam');
  });

  it('records a secondary-screen violation when multiple displays are detected', async () => {
    Object.defineProperty(window, 'getScreenDetails', {
      value: vi.fn().mockResolvedValue({ screens: [{}, {}] }),
      configurable: true,
    });

    const harness = renderHarness();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'SECONDARY_SCREEN'),
    ).toBe(true);
  });

  it('keeps Safari fallback silent and non-violating when screen details are unavailable', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      configurable: true,
    });

    const infoSpy = vi.spyOn(console, 'info');
    const harness = renderHarness();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'SECONDARY_SCREEN'),
    ).toBe(false);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('ignores screen-details permission denial without creating a violation', async () => {
    Object.defineProperty(window, 'getScreenDetails', {
      value: vi.fn().mockRejectedValue(new Error('Permission denied')),
      configurable: true,
    });

    const harness = renderHarness();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'SECONDARY_SCREEN'),
    ).toBe(false);
  });
});
