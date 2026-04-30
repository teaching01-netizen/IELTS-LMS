import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import type { ExamState } from '../../../../types';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import { KeyboardProvider } from '../StudentKeyboardProvider';
import { ProctoringProvider } from '../StudentProctoringProvider';
import { StudentAttemptProvider } from '../StudentAttemptProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';
import { StudentUIProvider, useStudentUI } from '../StudentUIProvider';

function createExamState(): ExamState {
  return {
    title: 'Test Exam',
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
          content: 'Test content',
          blocks: [],
        },
      ],
    },
    listening: {
      parts: [
        {
          id: 'l1',
          title: 'Part 1',
          pins: [],
          blocks: [],
        },
      ],
    },
    writing: {
      task1Prompt: 'Task 1 prompt',
      task2Prompt: 'Task 2 prompt',
      tasks: [],
      customPromptTemplates: [],
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: [],
    },
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

describe('StudentKeyboardProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderHarness(overrideState?: (nextState: ExamState) => void) {
    let runtimeContext: ReturnType<typeof useStudentRuntime> | null = null;
    let uiContext: ReturnType<typeof useStudentUI> | null = null;
    const state = createExamState();
    overrideState?.(state);
    const attemptSnapshot = createAttemptSnapshot();

    function Probe() {
      runtimeContext = useStudentRuntime();
      uiContext = useStudentUI();

      return (
        <>
          <textarea data-testid="editor" />
          <input data-testid="objective-input" />
          <div data-testid="highlight-target" data-student-highlightable="true">
            Passage text
          </div>
        </>
      );
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
      get runtime() {
        return runtimeContext!;
      },
      get ui() {
        return uiContext!;
      },
      editor: screen.getByTestId('editor'),
      objectiveInput: screen.getByTestId('objective-input'),
      highlightTarget: screen.getByTestId('highlight-target'),
    };
  }

  it('blocks clipboard shortcuts during exam phase', () => {
    const harness = renderHarness();
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations.at(-1)?.type).toBe('RESTRICTED_SHORTCUT');
  });

  it('allows clipboard shortcuts when config disables clipboard blocking', () => {
    const harness = renderHarness((state) => {
      state.config.security.blockClipboard = false;
    });
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('defaults to blocking clipboard shortcuts when flag is missing', () => {
    const harness = renderHarness((state) => {
      delete (state.config.security as any).blockClipboard;
    });
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations.at(-1)?.type).toBe('RESTRICTED_SHORTCUT');
  });

  it('blocks context menu interactions during exam phase', () => {
    const harness = renderHarness();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations.at(-1)?.type).toBe('CONTEXT_MENU_BLOCKED');
  });

  it('blocks drag and drop interactions during exam phase', () => {
    const harness = renderHarness();
    const event = new Event('dragstart', {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations.at(-1)?.type).toBe('DRAG_DROP_BLOCKED');
  });

  it('allows dragstart inside highlightable reading/listening text when highlight mode is active', () => {
    const harness = renderHarness();

    act(() => {
      harness.runtime.actions.setCurrentModule('reading');
      harness.ui.actions.toggleHighlightMode();
    });

    const event = new Event('dragstart', {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      harness.highlightTarget.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('allows same-editor select-all shortcuts', () => {
    const harness = renderHarness();
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      harness.editor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('preserves normal typing inside editable inputs', () => {
    const harness = renderHarness();
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      harness.objectiveInput.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });
});
