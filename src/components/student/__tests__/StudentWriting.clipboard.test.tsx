import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
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

  it('does not emit paste audit events (clipboard enforcement lives at document level)', () => {
    const state = createExamState();
    const { container } = render(
      <StudentWriting
        state={state}
        writingAnswers={{}}
        onWritingChange={vi.fn()}
        onSubmit={vi.fn()}
        currentQuestionId={null}
        onNavigate={vi.fn()}
        security={{ preventAutofill: true, preventAutocorrect: true }}
        sessionId="sched-1"
        studentId="attempt-1"
      />,
    );

    const editor = container.querySelector('[contenteditable="true"]');
    if (!editor) {
      throw new Error('Expected writing editor to render');
    }

    fireEvent.paste(editor);

    expect(saveStudentAuditEventMock).not.toHaveBeenCalled();
  });
});

