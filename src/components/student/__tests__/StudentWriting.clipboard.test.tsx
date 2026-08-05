import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { ProtectedInput } from '../ProtectedInput';
import { StudentWriting } from '../StudentWriting';

const saveStudentAuditEventMock = vi.fn();

vi.mock('../../../services/studentAuditService', () => ({
  saveStudentAuditEvent: (...args: unknown[]) => saveStudentAuditEventMock(...args),
}));

function createExamState(): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  config.sections.writing.tasks = [
    {
      id: 'task1',
      label: 'Task 1',
      taskType: 'task1',
      minWords: 150,
      recommendedTime: 20,
    },
  ];

  return {
    title: 'Test Exam',
    type: 'Academic',
    activeModule: 'writing',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: { passages: [] },
    listening: { parts: [] },
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

describe('StudentWriting clipboard', () => {
  afterEach(() => {
    saveStudentAuditEventMock.mockReset();
    vi.restoreAllMocks();
  });

  it('blocks paste in the writing editor and emits an audit event', () => {
    const state = createExamState();
    const onWritingChange = vi.fn();
    render(
      <StudentWriting
        state={state}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={vi.fn()}
        currentQuestionId={null}
        onNavigate={vi.fn()}
        security={{ preventAutofill: true, preventAutocorrect: true }}
        sessionId="sched-1"
        studentId="attempt-1"
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    fireEvent(editor, pasteEvent);

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(onWritingChange).not.toHaveBeenCalled();
    expect(saveStudentAuditEventMock).toHaveBeenCalledWith(
      'sched-1',
      'PASTE_BLOCKED',
      {
        targetName: 'TEXTAREA',
        targetType: 'writing-editor',
        isContentEditable: false,
      },
      'attempt-1',
    );
  });

  it('blocks copy, cut, drop, and context menu in the writing editor', () => {
    const state = createExamState();
    render(
      <StudentWriting
        state={state}
        writingAnswers={{}}
        onWritingChange={vi.fn()}
        onSubmit={vi.fn()}
        currentQuestionId={null}
        onNavigate={vi.fn()}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });

    for (const eventName of ['copy', 'cut', 'drop', 'contextmenu']) {
      const event = new Event(eventName, { bubbles: true, cancelable: true });
      fireEvent(editor, event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('does not block paste, copy, or drop on controls outside the writing editor policy', () => {
    const state = createExamState();
    render(
      <>
        <StudentWriting
          state={state}
          writingAnswers={{}}
          onWritingChange={vi.fn()}
          onSubmit={vi.fn()}
          currentQuestionId={null}
          onNavigate={vi.fn()}
          sessionId="sched-1"
          studentId="attempt-1"
        />
        <ProtectedInput
          security={{ preventAutofill: true, preventAutocorrect: true }}
          aria-label="objective answer"
        />
      </>,
    );

    const objectiveInput = screen.getByRole('textbox', { name: 'objective answer' });

    // The clipboard guard is scoped to the writing editor surface only: the
    // same gestures on an objective answer control stay unblocked and emit
    // no PASTE_BLOCKED audit event.
    for (const eventName of ['paste', 'copy', 'drop']) {
      const event = new Event(eventName, { bubbles: true, cancelable: true });
      fireEvent(objectiveInput, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(saveStudentAuditEventMock).not.toHaveBeenCalled();
  });
});
