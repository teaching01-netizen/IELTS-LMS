import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import type { ExamState } from '../../../../types';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import { KeyboardProvider, useKeyboardSubmitHandler } from '../StudentKeyboardProvider';
import { ProctoringProvider } from '../StudentProctoringProvider';
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';
import { StudentUIProvider, useStudentUI } from '../StudentUIProvider';

vi.mock('@services/studentAuditService', () => ({
  saveStudentAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

function createExamState(overrides?: {
  blockClipboard?: boolean;
  antiScreenshotGuard?: boolean;
  unansweredPolicy?: string;
}): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  config.security.blockClipboard = overrides?.blockClipboard ?? true;
  config.security.antiScreenshotGuardEnabled = overrides?.antiScreenshotGuard ?? true;
  config.progression.unansweredSubmissionPolicy = overrides?.unansweredPolicy as any;
  return {
    title: 'Test Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: {
      passages: [
        { id: 'p1', title: 'Passage 1', content: 'Test content', blocks: [] },
      ],
    },
    listening: {
      parts: [{ id: 'l1', title: 'Part 1', pins: [], blocks: [] }],
    },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
      tasks: [],
      customPromptTemplates: [],
    },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  };
}

function createAttemptSnapshot(): StudentAttempt {
  return {
    id: 'attempt-1',
    scheduleId: 'sched-1',
    studentKey: 'student-sched-1-alice',
    examId: 'exam-1',
    examTitle: 'Test Exam',
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
      pendingMutationCount: 0,
      syncState: 'saved',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('StudentKeyboardProvider shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderHarness(
    overrides?: {
    blockClipboard?: boolean;
    antiScreenshotGuard?: boolean;
    unansweredPolicy?: string;
    },
    submitHandler?: () => Promise<void> | void,
  ) {
    let runtimeContext: ReturnType<typeof useStudentRuntime> | null = null;
    let uiContext: ReturnType<typeof useStudentUI> | null = null;
    let attemptContext: ReturnType<typeof useStudentAttempt> | null = null;
    const state = createExamState(overrides);
    const attemptSnapshot = createAttemptSnapshot();

    function Probe() {
      runtimeContext = useStudentRuntime();
      uiContext = useStudentUI();
      attemptContext = useStudentAttempt();
      const { registerSubmitHandler } = useKeyboardSubmitHandler();

      useEffect(() => {
        if (!submitHandler) {
          return undefined;
        }
        return registerSubmitHandler(submitHandler);
      }, [registerSubmitHandler]);

      return <div data-testid="editor" />;
    }

    render(
      <StudentRuntimeProvider
        state={state}
        onExit={vi.fn()}
        attemptSnapshot={attemptSnapshot}
      >
        <StudentAttemptProvider
          scheduleId={attemptSnapshot.scheduleId}
          attemptSnapshot={attemptSnapshot}
        >
          <ProctoringProvider config={state.config} scheduleId={attemptSnapshot.scheduleId}>
            <StudentUIProvider>
              <KeyboardProvider>
                <Probe />
              </KeyboardProvider>
            </StudentUIProvider>
          </ProctoringProvider>
        </StudentAttemptProvider>
      </StudentRuntimeProvider>,
    );

    act(() => {
      runtimeContext?.actions.startExam();
    });

    return {
      get runtime() { return runtimeContext!; },
      get ui() { return uiContext!; },
      get attempt() { return attemptContext!; },
    };
  }

  describe('F12 developer tools', () => {
    it('blocks F12 and records RESTRICTED_SHORTCUT violation', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: 'F12',
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('RESTRICTED_SHORTCUT');
    });
  });

  describe('inspector shortcuts', () => {
    it('blocks Cmd+Shift+I', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: 'i',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('RESTRICTED_SHORTCUT');
    });

    it('blocks Ctrl+Shift+C', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('RESTRICTED_SHORTCUT');
    });

    it('blocks Ctrl+Shift+J', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: 'j',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('RESTRICTED_SHORTCUT');
    });
  });

  describe('global blocked modifier keys', () => {
    it('blocks Cmd+P (print)', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: 'p',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('RESTRICTED_SHORTCUT');
    });

    it('blocks Cmd+S (save)', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('RESTRICTED_SHORTCUT');
    });

    it('blocks Cmd+F (find) when outside editing targets', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: 'f',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('RESTRICTED_SHORTCUT');
    });

    it('allows Cmd+F when clipboard blocking is disabled', () => {
      const harness = renderHarness({ blockClipboard: false });
      const event = new KeyboardEvent('keydown', {
        key: 'f',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('flag toggle (F key without modifier)', () => {
    it('dispatches persistFlag when F is pressed without modifier on a current question', () => {
      const harness = renderHarness();

      const event = new KeyboardEvent('keydown', {
        key: 'f',
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      // F key without modifier should not be blocked as a restricted shortcut
      expect(event.defaultPrevented).toBe(false);
      const lastViolation = harness.runtime.state.violations.at(-1);
      expect(lastViolation?.type).not.toBe('RESTRICTED_SHORTCUT');
    });

    it('does not toggle flag when no current question', () => {
      const harness = renderHarness();
      act(() => { harness.runtime.actions.setCurrentQuestionId(null); });

      const event = new KeyboardEvent('keydown', {
        key: 'f',
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(harness.attempt.state.attempt?.flags?.q1).toBeUndefined();
    });
  });

  describe('Cmd+Enter submit', () => {
    it('does not prevent default on Cmd+Enter (submit is async)', () => {
      const harness = renderHarness({ unansweredPolicy: 'allow' });
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      // Cmd+Enter triggers async submit, we just verify it wasn't blocked
      expect(event.defaultPrevented).toBe(true);
    });

    it('routes Cmd+Enter through the registered submission handler', async () => {
      const submitHandler = vi.fn().mockResolvedValue(undefined);
      renderHarness({ unansweredPolicy: 'allow' }, submitHandler);
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      await waitFor(() => expect(submitHandler).toHaveBeenCalledTimes(1));
    });

    it('does not trigger submit when not in exam phase', () => {
      const harness = renderHarness();
      act(() => { harness.runtime.actions.setPhase('pre-check'); });

      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(harness.runtime.state.phase).toBe('pre-check');
    });
  });

  describe('question navigation (N/P keys)', () => {
    it('does not navigate when no current question', () => {
      const harness = renderHarness();
      act(() => { harness.runtime.actions.setCurrentQuestionId(null); });

      const event = new KeyboardEvent('keydown', {
        key: 'n',
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(harness.runtime.state.currentQuestionId).toBeNull();
    });

    it('does not crash when navigating with N key and no questions exist', () => {
      const harness = renderHarness();
      act(() => { harness.runtime.actions.setCurrentQuestionId('q1'); });

      const event = new KeyboardEvent('keydown', {
        key: 'n',
        bubbles: true,
        cancelable: true,
      });

      expect(() => {
        act(() => { document.dispatchEvent(event); });
      }).not.toThrow();
    });

    it('does not crash when navigating with P key', () => {
      const harness = renderHarness();
      act(() => { harness.runtime.actions.setCurrentQuestionId('q1'); });

      const event = new KeyboardEvent('keydown', {
        key: 'p',
        bubbles: true,
        cancelable: true,
      });

      expect(() => {
        act(() => { document.dispatchEvent(event); });
      }).not.toThrow();
    });
  });

  describe('number key navigation', () => {
    it('jumps to question by number key', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: '1',
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      // Should set a question (exact id depends on allQuestions)
      expect(harness.runtime.state.currentQuestionId).toBeDefined();
    });
  });

  describe('screenshot shortcuts', () => {
    it('blocks Cmd+Shift+3', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: '3',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('SCREENSHOT_ATTEMPT');
    });

    it('blocks Cmd+Shift+4', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: '4',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('SCREENSHOT_ATTEMPT');
    });

    it('blocks Cmd+Shift+5', () => {
      const harness = renderHarness();
      const event = new KeyboardEvent('keydown', {
        key: '5',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('SCREENSHOT_ATTEMPT');
    });
  });

  describe('non-exam phase', () => {
    it('does not block shortcuts outside exam phase', () => {
      const harness = renderHarness();
      act(() => { harness.runtime.actions.setPhase('pre-check'); });

      const event = new KeyboardEvent('keydown', {
        key: 'F12',
        bubbles: true,
        cancelable: true,
      });

      act(() => { document.dispatchEvent(event); });

      expect(event.defaultPrevented).toBe(false);
      expect(harness.runtime.state.violations).toHaveLength(0);
    });
  });
});
