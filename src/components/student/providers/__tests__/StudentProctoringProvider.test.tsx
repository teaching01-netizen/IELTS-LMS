import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProctoringProvider, useProctoring } from '../StudentProctoringProvider';
import { StudentAttemptProvider } from '../StudentAttemptProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';
import { studentAttemptRepository as studentAttemptRepositoryInstance } from '../../../../services/studentAttemptRepository';
import { resetStudentAttemptPendingMutationIndexedDbForTests } from '../../../../services/studentAttemptRepository';
import type { ExamConfig, ExamState } from '../../../../types';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import { saveStudentAuditEvent } from '@services/studentAuditService';

vi.mock('@services/studentAuditService', () => ({
  saveStudentAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

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

function renderHarness(
  config: ExamConfig = mockConfig,
  attemptOverrides: Partial<StudentAttempt> = {},
) {
  const baseAttemptSnapshot: StudentAttempt = {
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
  const attemptSnapshot: StudentAttempt = {
    ...baseAttemptSnapshot,
    ...attemptOverrides,
    integrity: {
      ...baseAttemptSnapshot.integrity,
      ...(attemptOverrides.integrity ?? {}),
    },
    recovery: {
      ...baseAttemptSnapshot.recovery,
      ...(attemptOverrides.recovery ?? {}),
    },
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

function renderRuntimeBackedPreCheckHarness(config: ExamConfig = mockConfig) {
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
      runtimeBacked
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

  return renderHook(
    () => ({
      proctoring: useProctoring(),
      runtime: useStudentRuntime(),
    }),
    { wrapper },
  );
}

describe('StudentProctoringProvider', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    await resetStudentAttemptPendingMutationIndexedDbForTests();

    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });

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

  it('persists the same violation id that is added to runtime state', async () => {
    sessionStorage.setItem(
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
    const savePendingMutations = vi
      .spyOn(studentAttemptRepositoryInstance, 'savePendingMutations')
      .mockResolvedValue();
    const harness = renderHarness();

    act(() => {
      harness.result.current.proctoring.handleViolation(
        'TEST_CRITICAL',
        'Critical violation',
        'critical',
      );
    });

    const runtimeViolation = harness.result.current.runtime.state.violations[0];
    expect(runtimeViolation).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(savePendingMutations).toHaveBeenCalled();

    const violationMutation = savePendingMutations.mock.calls
      .flatMap(([, mutations]) => mutations)
      .find((mutation) => mutation.type === 'violation');

    expect(violationMutation?.payload).toMatchObject({
      violationId: runtimeViolation?.id,
      violationType: 'TEST_CRITICAL',
      violations: [
        expect.objectContaining({
          id: runtimeViolation?.id,
          type: 'TEST_CRITICAL',
          severity: 'critical',
          description: 'Critical violation',
        }),
      ],
    });
  });

  it('includes violationId when publishing a VIOLATION_DETECTED audit event', () => {
    sessionStorage.setItem(
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
    const harness = renderHarness();

    act(() => {
      harness.result.current.proctoring.handleViolation(
        'TEST_CRITICAL',
        'Critical violation',
        'critical',
      );
    });

    const runtimeViolation = harness.result.current.runtime.state.violations[0];
    expect(runtimeViolation).toBeDefined();

    expect(saveStudentAuditEvent).toHaveBeenCalledWith(
      'sched-1',
      'VIOLATION_DETECTED',
      expect.objectContaining({
        violationId: runtimeViolation?.id,
        violationType: 'TEST_CRITICAL',
      }),
      'attempt-1',
    );
  });

  it('applies cooldowns per violation type', () => {
    const harness = renderHarness();

    act(() => {
      harness.result.current.proctoring.handleViolation('TEST_VIOLATION', 'First violation');
      harness.result.current.proctoring.handleViolation('TEST_VIOLATION', 'Second violation');
    });

    expect(harness.result.current.runtime.state.violations).toHaveLength(1);
  });

  it('does not terminate the exam for non-critical violations when severity thresholds are configured', () => {
    const harness = renderHarness({
      ...mockConfig,
      security: {
        ...mockConfig.security,
        severityThresholds: {
          lowLimit: 5,
          mediumLimit: 3,
          highLimit: 2,
          criticalAction: 'terminate',
        },
      },
    });

    act(() => {
      harness.result.current.proctoring.handleViolation(
        'TAB_SWITCH',
        'Tab switched',
        'high',
      );
    });

    expect(harness.result.current.runtime.state.phase).toBe('exam');
  });

  it('terminates the exam for critical violations', () => {
    const harness = renderHarness({
      ...mockConfig,
      security: {
        ...mockConfig.security,
        severityThresholds: {
          lowLimit: 5,
          mediumLimit: 3,
          highLimit: 2,
          criticalAction: 'terminate',
        },
      },
    });

    act(() => {
      harness.result.current.proctoring.handleViolation(
        'TEST_CRITICAL',
        'Critical violation',
        'critical',
      );
    });

    expect(harness.result.current.runtime.state.phase).toBe('post-exam');
  });

  it('pauses the exam when high severity violations hit the configured threshold', () => {
    const harness = renderHarness({
      ...mockConfig,
      progression: {
        ...mockConfig.progression,
        allowPause: true,
      },
      security: {
        ...mockConfig.security,
        severityThresholds: {
          lowLimit: 5,
          mediumLimit: 3,
          highLimit: 2,
          criticalAction: 'terminate',
        },
      },
    });

    expect(() => {
      act(() => {
        harness.result.current.proctoring.handleViolation(
          'TAB_SWITCH',
          'Tab switched',
          'high',
        );
        harness.result.current.proctoring.handleViolation(
          'SECONDARY_SCREEN',
          'Multiple screens detected',
          'high',
        );
      });
    }).not.toThrow();

    expect(harness.result.current.runtime.state.phase).toBe('exam');
    expect(harness.result.current.runtime.state.blocking.active).toBe(true);
    expect(harness.result.current.runtime.state.blocking.reason).toBe('proctor_paused');
  });

  it('terminates the exam when pause is disabled and high severity violations hit the configured threshold', () => {
    const harness = renderHarness({
      ...mockConfig,
      progression: {
        ...mockConfig.progression,
        allowPause: false,
      },
      security: {
        ...mockConfig.security,
        severityThresholds: {
          lowLimit: 5,
          mediumLimit: 3,
          highLimit: 2,
          criticalAction: 'terminate',
        },
      },
    });

    act(() => {
      harness.result.current.proctoring.handleViolation('TAB_SWITCH', 'Tab switched', 'high');
      harness.result.current.proctoring.handleViolation('SECONDARY_SCREEN', 'Multiple screens detected', 'high');
    });

    expect(harness.result.current.runtime.state.phase).toBe('post-exam');
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
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(true);
  });

  it('logs a tab-switch warning on window blur when the tab is hidden', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'warn' },
    });

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      window.dispatchEvent(new Event('blur'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(true);
  });

  it('does not log a tab-switch warning on blur-only browser popup focus loss', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'warn' },
    });

    act(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      window.dispatchEvent(new Event('blur'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(false);
  });

  it('does not log an iPad tab-switch warning when the writing editor causes window blur while typing', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
      configurable: true,
    });

    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'warn' },
    });
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.tabIndex = 0;
    Object.defineProperty(editor, 'isContentEditable', {
      value: true,
      configurable: true,
    });
    document.body.appendChild(editor);

    act(() => {
      editor.focus();
      window.dispatchEvent(new Event('blur'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(false);

    editor.remove();
  });

  it('activates anti-cheat after runtime-backed pre-check completes (late entry)', async () => {
    const harness = renderRuntimeBackedPreCheckHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'warn' },
    });

    expect(harness.result.current.runtime.state.phase).toBe('pre-check');

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      window.dispatchEvent(new Event('blur'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(false);

    act(() => {
      harness.result.current.runtime.actions.setPhase('exam');
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
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
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(harness.result.current.runtime.state.phase).toBe('post-exam');
  });

  it('does not terminate the exam on close/reload signals (pagehide) even when tab-switch policy is terminate', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'terminate' },
    });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(harness.result.current.runtime.state.phase).toBe('exam');
    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(false);
  });

  it('does not log a tab-switch warning when refresh emits visibilitychange before beforeunload', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'warn' },
    });

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('beforeunload'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(false);
  });

  it('does not log a tab-switch warning when refresh emits blur before beforeunload', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, tabSwitchRule: 'warn' },
    });

    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('beforeunload'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TAB_SWITCH'),
    ).toBe(false);
  });

  it('warns before unload when unsynced attempt changes exist', () => {
    renderHarness(
      mockConfig,
      {
        recovery: {
          pendingMutationCount: 2,
          syncState: 'saving',
        },
      },
    );

    const beforeUnloadEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    act(() => {
      window.dispatchEvent(beforeUnloadEvent);
    });

    expect(beforeUnloadEvent.defaultPrevented).toBe(true);
  });

  it('does not warn before unload when attempt is already saved', () => {
    renderHarness();

    const beforeUnloadEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    act(() => {
      window.dispatchEvent(beforeUnloadEvent);
    });

    expect(beforeUnloadEvent.defaultPrevented).toBe(false);
  });

  it('ignores legacy fullscreen config without requesting fullscreen or recording fullscreen exits', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
    });

    const harness = renderHarness({
      ...mockConfig,
      security: {
        ...mockConfig.security,
        requireFullscreen: true,
        fullscreenAutoReentry: true,
        fullscreenMaxViolations: 1,
      },
    });

    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
      document.dispatchEvent(new Event('fullscreenchange'));
      await Promise.resolve();
    });

    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'FULLSCREEN_EXIT'),
    ).toBe(false);
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

  it('marks the document as notranslate during the exam when preventTranslation is enabled', async () => {
    renderHarness({
      ...mockConfig,
      security: {
        ...mockConfig.security,
        preventTranslation: true,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.documentElement.getAttribute('translate')).toBe('no');
    expect(document.documentElement.classList.contains('notranslate')).toBe(true);
    expect(document.documentElement.classList.contains('student-translation-guard-active')).toBe(true);
    expect(document.head.querySelector('#student-notranslate-meta')).toMatchObject({
      name: 'google',
      content: 'notranslate',
    });
  });

  it('removes notranslate markers on unmount', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: {
        ...mockConfig.security,
        preventTranslation: true,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.documentElement.getAttribute('translate')).toBe('no');
    expect(document.head.querySelector('#student-notranslate-meta')).not.toBeNull();

    harness.unmount();

    expect(document.documentElement.getAttribute('translate')).toBeNull();
    expect(document.documentElement.classList.contains('notranslate')).toBe(false);
    expect(document.documentElement.classList.contains('student-translation-guard-active')).toBe(false);
    expect(document.head.querySelector('#student-notranslate-meta')).toBeNull();
  });

  it('self-heals marker tampering and records only one cooldown-deduplicated violation', async () => {
    const harness = renderHarness();

    await act(async () => {
      document.documentElement.removeAttribute('translate');
      document.documentElement.classList.remove('notranslate', 'student-translation-guard-active');
      document.querySelector('#student-notranslate-meta')?.remove();
      await Promise.resolve();
    });

    expect(document.documentElement).toHaveAttribute('translate', 'no');
    expect(document.documentElement).toHaveClass('notranslate', 'student-translation-guard-active');
    expect(document.head.querySelector('#student-notranslate-meta')).toMatchObject({
      name: 'google',
      content: 'notranslate',
    });
    expect(
      harness.result.current.runtime.state.violations.filter(
        (violation) => violation.type === 'TRANSLATION_DETECTED',
      ),
    ).toHaveLength(1);
  });

  it('replaces invalid same-id nodes and restores the genuine meta to document head', async () => {
    renderHarness();

    await act(async () => {
      const invalidMarker = document.createElement('div');
      invalidMarker.id = 'student-notranslate-meta';
      document.getElementById('student-notranslate-meta')?.replaceWith(invalidMarker);
      await Promise.resolve();
    });

    let marker = document.getElementById('student-notranslate-meta');
    expect(marker).toBeInstanceOf(HTMLMetaElement);
    expect(marker?.parentElement).toBe(document.head);
    expect(marker).toMatchObject({ name: 'google', content: 'notranslate' });

    await act(async () => {
      document.body.appendChild(marker!);
      await Promise.resolve();
    });

    marker = document.getElementById('student-notranslate-meta');
    expect(marker).toBeInstanceOf(HTMLMetaElement);
    expect(marker?.parentElement).toBe(document.head);
    expect(document.body.querySelector('#student-notranslate-meta')).toBeNull();
  });

  it('cleans all owned markers when translation prevention is disabled or the exam phase exits', async () => {
    const harness = renderHarness();

    act(() => {
      harness.result.current.runtime.actions.setPhase('completed');
    });

    expect(document.documentElement).not.toHaveAttribute('translate');
    expect(document.documentElement).not.toHaveClass('notranslate', 'student-translation-guard-active');
    expect(document.head.querySelector('#student-notranslate-meta')).toBeNull();

    harness.unmount();
    renderHarness({
      ...mockConfig,
      security: { ...mockConfig.security, preventTranslation: false },
    });

    expect(document.documentElement).not.toHaveAttribute('translate');
    expect(document.documentElement).not.toHaveClass('notranslate', 'student-translation-guard-active');
    expect(document.head.querySelector('#student-notranslate-meta')).toBeNull();
  });

  it('records a translation violation when translation markers are detected', async () => {
    const harness = renderHarness({
      ...mockConfig,
      security: {
        ...mockConfig.security,
        preventTranslation: true,
      },
    });

    act(() => {
      document.documentElement.classList.add('translated-ltr');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(
      harness.result.current.runtime.state.violations.some((violation) => violation.type === 'TRANSLATION_DETECTED'),
    ).toBe(true);
  });
});
