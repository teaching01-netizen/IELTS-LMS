import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { StudentWriting } from '../StudentWriting';

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

describe('StudentWriting a11y', () => {
  it('renders an accessible writing editor', () => {
    const { container } = render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    const editor = container.querySelector('[contenteditable="true"]');
    if (!editor) {
      throw new Error('Expected writing editor to render');
    }
    expect(editor.getAttribute('class')).toMatch(/focus-visible/);
  });

  it('shows builder-authored HTML prompts as plain text in the writing exam', () => {
    const state = createExamState();
    state.writing.task1Prompt = '<p>Describe the chart <strong>in detail</strong>.</p>';

    const { container } = render(
      <StudentWriting
        state={state}
        writingAnswers={{}}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getByText(/Describe the chart in detail\./)).toBeInTheDocument();
    expect(container).not.toHaveTextContent('<p>');
    expect(container).not.toHaveTextContent('<strong>');
  });

  it('renders writing task navigation and review inside a footer', () => {
    const state = createExamState();
    state.config.sections.writing.tasks = [
      {
        id: 'task1',
        label: 'Task 1',
        taskType: 'task1',
        minWords: 150,
        recommendedTime: 20,
      },
      {
        id: 'task2',
        label: 'Task 2',
        taskType: 'task2',
        minWords: 250,
        recommendedTime: 40,
      },
    ];
    const onNavigate = vi.fn();

    render(
      <StudentWriting
        state={state}
        writingAnswers={{}}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={onNavigate}
      />,
    );

    const footer = screen.getByRole('contentinfo', {
      name: /writing task navigation and submission/i,
    });

    expect(within(footer).getByRole('button', { name: 'Task 1' })).toBeInTheDocument();
    fireEvent.click(within(footer).getByRole('button', { name: 'Task 2' }));
    expect(onNavigate).toHaveBeenCalledWith('task2');
    expect(within(footer).getByRole('button', { name: /review & submit/i })).toBeInTheDocument();
  });

  it('opens the review modal from the writing footer', () => {
    const state = createExamState();

    render(
      <StudentWriting
        state={state}
        writingAnswers={{}}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /review & submit/i }));

    expect(screen.getByRole('heading', { name: /review your responses/i })).toBeInTheDocument();
  });

  it('does not expose a writing highlight toolbar button', () => {
    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /highlight selected text/i }),
    ).not.toBeInTheDocument();
  });
});
