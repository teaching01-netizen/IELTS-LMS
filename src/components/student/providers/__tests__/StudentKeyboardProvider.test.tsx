import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import type { ExamState } from '../../../../types';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import { KeyboardProvider } from '../StudentKeyboardProvider';
import { ProctoringProvider } from '../StudentProctoringProvider';
import { StudentAttemptProvider, useStudentAttempt } from '../StudentAttemptProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';
import { StudentUIProvider, useStudentUI } from '../StudentUIProvider';

const saveStudentAuditEventMock = vi.fn();

vi.mock('@services/studentAuditService', () => ({
  saveStudentAuditEvent: (...args: unknown[]) => saveStudentAuditEventMock(...args),
}));

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
    saveStudentAuditEventMock.mockReset();
  });

  function renderHarness(overrideState?: (nextState: ExamState) => void) {
    let runtimeContext: ReturnType<typeof useStudentRuntime> | null = null;
    let uiContext: ReturnType<typeof useStudentUI> | null = null;
    let attemptContext: ReturnType<typeof useStudentAttempt> | null = null;
    const state = createExamState();
    overrideState?.(state);
    const attemptSnapshot = createAttemptSnapshot();

    function Probe() {
      runtimeContext = useStudentRuntime();
      uiContext = useStudentUI();
      attemptContext = useStudentAttempt();

      return (
        <>
          <textarea aria-label="Editor" data-testid="editor" />
          <input aria-label="Objective answer" data-testid="objective-input" />
          <div data-testid="highlight-target" data-student-highlightable="true">
            Passage text
          </div>
          <div data-testid="sat-text" data-sat-selection-protected="true">
            SAT passage text
          </div>
          <div
            data-testid="question-copy"
            data-student-question-callout-protected="true"
          >
            Question text
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
      get attempt() {
        return attemptContext!;
      },
      editor: screen.getByTestId('editor'),
      objectiveInput: screen.getByTestId('objective-input'),
      highlightTarget: screen.getByTestId('highlight-target'),
      satText: screen.getByTestId('sat-text'),
      questionCopy: screen.getByTestId('question-copy'),
    };
  }

  it('allows copy shortcut outside answer inputs during exam phase', () => {
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

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('keeps global keyboard listeners mounted while answers are updated', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const harness = renderHarness();
    const keydownAdds = addEventListenerSpy.mock.calls.filter(([type]) => type === 'keydown').length;
    const keydownRemoves = removeEventListenerSpy.mock.calls.filter(([type]) => type === 'keydown').length;

    act(() => {
      harness.attempt.actions.persistAnswer('q1', 'A');
    });

    expect(
      addEventListenerSpy.mock.calls.filter(([type]) => type === 'keydown'),
    ).toHaveLength(keydownAdds);
    expect(
      removeEventListenerSpy.mock.calls.filter(([type]) => type === 'keydown'),
    ).toHaveLength(keydownRemoves);
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

  it('defaults to allowing copy shortcut when clipboard flag is missing', () => {
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

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
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

  it('prevents context menus on protected question copy without recording a violation', () => {
    const harness = renderHarness();
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      harness.questionCopy.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations).toHaveLength(0);
    expect(saveStudentAuditEventMock).not.toHaveBeenCalled();
  });

  it.each(['editor', 'objectiveInput'] as const)(
    'blocks context menus on the %s answer control',
    (targetKey) => {
      const harness = renderHarness();
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        harness[targetKey].dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(harness.runtime.state.violations.at(-1)?.type).toBe('CONTEXT_MENU_BLOCKED');
    },
  );

  it('allows copy events from highlightable reading/listening text surfaces', () => {
    const harness = renderHarness();
    const event = new Event('copy', { bubbles: true, cancelable: true });

    act(() => {
      harness.highlightTarget.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('allows cut events from highlightable reading/listening text surfaces', () => {
    const harness = renderHarness();
    const event = new Event('cut', { bubbles: true, cancelable: true });

    act(() => {
      harness.highlightTarget.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  // The exemption these two cases used to assert WAS the bug: handing the
  // native menu back to the browser on passage text is exactly what let a
  // long-press on the reading pane expose Copy / Look Up / Search mid-exam.
  // Blocking the menu costs the surface nothing, because selection is kept
  // (`user-select: text`) and only the platform's menu goes away.
  it('blocks the context menu on highlightable reading text with highlight mode armed', () => {
    const harness = renderHarness();

    act(() => {
      harness.runtime.actions.setCurrentModule('reading');
      harness.ui.actions.toggleHighlightMode();
    });

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      harness.highlightTarget.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    // Blocked SILENTLY, like the protected question copy above: long-pressing a
    // passage is how a student selects the text they are about to highlight, so
    // charging it as a violation would flag ordinary exam behavior.
    expect(harness.runtime.state.violations).toHaveLength(0);
    expect(saveStudentAuditEventMock).not.toHaveBeenCalled();
  });

  it('blocks the context menu on highlightable text when highlight mode is off', () => {
    const harness = renderHarness();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      harness.highlightTarget.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  // SAT copy never carries `data-student-highlightable`; it is marked with
  // `data-sat-selection-protected` instead. Before this branch it fell through
  // to the generic exam handler, so resting a finger on the passage for two
  // seconds cost a CONTEXT_MENU_BLOCKED violation on top of the OS menu.
  it('blocks the context menu on SAT protected text during the exam without a violation', () => {
    const harness = renderHarness();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    act(() => {
      harness.satText.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations).toHaveLength(0);
    expect(saveStudentAuditEventMock).not.toHaveBeenCalled();
  });

  it('leaves the context menu to the browser on SAT protected text outside the exam phase', () => {
    const harness = renderHarness();
    act(() => {
      harness.runtime.actions.setPhase('pre-check');
    });

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      harness.satText.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('leaves the context menu to the browser on highlightable text outside the exam phase', () => {
    const harness = renderHarness();
    act(() => {
      harness.runtime.actions.setPhase('pre-check');
    });

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      harness.highlightTarget.dispatchEvent(event);
    });

    // Exam-scoped: check-in, lobby and post-exam keep native browser behavior.
    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('blocks paste shortcut inside answer inputs', () => {
    const harness = renderHarness();
    const event = new KeyboardEvent('keydown', {
      key: 'v',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      harness.editor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations.at(-1)?.type).toBe('CLIPBOARD_BLOCKED');
  });

  it('allows paste shortcut outside answer inputs', () => {
    const harness = renderHarness();
    const event = new KeyboardEvent('keydown', {
      key: 'v',
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

  it('allows dragstart during exam phase so native text selection behaves normally', () => {
    const harness = renderHarness();
    const event = new Event('dragstart', {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('allows drop interactions during exam phase', () => {
    const harness = renderHarness();
    const event = new Event('drop', {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('allows dragstart inside highlightable reading text when highlight mode is active', () => {
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

  it('allows dragstart inside highlightable reading text when highlight mode is off', () => {
    const harness = renderHarness();

    act(() => {
      harness.runtime.actions.setCurrentModule('reading');
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

  it('allows dragstart when browser targets a text node inside highlightable reading text', () => {
    const harness = renderHarness();

    act(() => {
      harness.runtime.actions.setCurrentModule('reading');
    });

    const textNode = harness.highlightTarget.firstChild;
    expect(textNode).not.toBeNull();
    const event = new Event('dragstart', {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      (textNode as Node).dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });

  it('allows dragstart inside highlightable listening text when highlight mode is active', () => {
    const harness = renderHarness();

    act(() => {
      harness.runtime.actions.setCurrentModule('listening');
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

  it('does not trigger single-key shortcuts while selecting text in a highlightable passage', () => {
    const harness = renderHarness();
    const textNode = harness.highlightTarget.firstChild;
    expect(textNode).not.toBeNull();
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      anchorNode: textNode,
      focusNode: textNode,
    } as Selection);

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(harness.attempt.state.attempt?.flags?.q1).toBeUndefined();
    expect(event.defaultPrevented).toBe(false);
    getSelectionSpy.mockRestore();
  });

  it('blocks undo shortcuts inside editable inputs without recording a restricted-shortcut violation', () => {
    const harness = renderHarness();
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      harness.editor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations).toHaveLength(0);
    expect(saveStudentAuditEventMock).toHaveBeenCalledWith(
      'sched-1',
      'UNDO_BLOCKED',
      expect.objectContaining({
        surface: 'student-global',
        via: 'keydown',
      }),
      'attempt-1',
    );
  });

  it('records a screenshot-attempt violation for PrintScreen', () => {
    const harness = renderHarness();
    const event = new KeyboardEvent('keydown', {
      key: 'PrintScreen',
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(harness.runtime.state.violations.at(-1)?.type).toBe('SCREENSHOT_ATTEMPT');
  });

  it('deduplicates rapid screenshot shortcut bursts', () => {
    const harness = renderHarness();
    const first = new KeyboardEvent('keydown', {
      key: 'PrintScreen',
      bubbles: true,
      cancelable: true,
    });
    const second = new KeyboardEvent('keydown', {
      key: 'PrintScreen',
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(first);
      document.dispatchEvent(second);
    });

    const screenshotViolations = harness.runtime.state.violations.filter(
      (violation) => violation.type === 'SCREENSHOT_ATTEMPT',
    );
    expect(screenshotViolations).toHaveLength(1);
  });

  it('does not enforce screenshot blocking when anti-screenshot guard is disabled', () => {
    const harness = renderHarness((state) => {
      state.config.security.antiScreenshotGuardEnabled = false;
    });
    const event = new KeyboardEvent('keydown', {
      key: 'PrintScreen',
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(harness.runtime.state.violations).toHaveLength(0);
  });
});
