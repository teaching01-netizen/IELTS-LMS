import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import type { ExamState } from '../../../../types';
import { KeyboardProvider } from '../StudentKeyboardProvider';
import { ProctoringProvider } from '../StudentProctoringProvider';
import { StudentRuntimeProvider, useStudentRuntime } from '../StudentRuntimeProvider';

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

describe('StudentKeyboardProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderHarness() {
    let runtimeContext: ReturnType<typeof useStudentRuntime> | null = null;
    const state = createExamState();

    function Probe() {
      runtimeContext = useStudentRuntime();

      return (
        <>
          <textarea data-testid="editor" />
          <input data-testid="objective-input" />
        </>
      );
    }

    render(
      <StudentRuntimeProvider state={state} onExit={vi.fn()}>
        <ProctoringProvider config={state.config}>
          <KeyboardProvider>
            <Probe />
          </KeyboardProvider>
        </ProctoringProvider>
      </StudentRuntimeProvider>,
    );

    act(() => {
      runtimeContext?.actions.startExam();
    });

    return {
      get runtime() {
        return runtimeContext!;
      },
      editor: screen.getByTestId('editor'),
      objectiveInput: screen.getByTestId('objective-input'),
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
