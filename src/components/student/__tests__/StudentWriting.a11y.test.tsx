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

  it('resizes writing panes using the workspace bounds', () => {
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

    const workspace = screen.getByTestId('writing-split-workspace');
    expect(workspace).toHaveStyle({
      '--writing-prompt-pane-width': '50%',
      '--writing-editor-pane-width': 'calc(50% - var(--split-divider-width))',
      '--split-divider-width': '16px',
    });

    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      bottom: 600,
      height: 600,
      left: 100,
      right: 1100,
      top: 0,
      width: 1000,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.mouseDown(screen.getByTestId('writing-pane-resizer'), { clientX: 600 });
    fireEvent.mouseMove(document, { clientX: 700 });
    fireEvent.mouseUp(document);

    expect(workspace).toHaveStyle({
      '--writing-prompt-pane-width': '60%',
      '--writing-editor-pane-width': 'calc(40% - var(--split-divider-width))',
    });
  });

  it('matches tablet resizer dimensions used in reading and listening', () => {
    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
        tabletMode
      />,
    );

    const workspace = screen.getByTestId('writing-split-workspace');
    const resizer = screen.getByTestId('writing-pane-resizer');

    expect(workspace).toHaveStyle({
      '--writing-prompt-pane-width': '50%',
      '--writing-editor-pane-width': 'calc(50%)',
      '--split-divider-width': '32px',
    });
    expect(resizer).toHaveClass('w-11');
    expect(resizer).toHaveClass('absolute');
    expect(resizer.querySelector('.w-14')).toBeInTheDocument();
    expect(resizer.querySelector('.h-\\[5\\.5rem\\]')).toBeInTheDocument();
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

    expect(footer).toHaveClass('student-exam-footer');
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
    expect(screen.queryByText(/word count warning/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+\s*\/\s*\d+\s*words/i)).not.toBeInTheDocument();
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

  it('shows word count above the writing editor', () => {
    const { container } = render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{ task1: 'one two three' }}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    const wordCount = screen.getByLabelText(/current word count/i);
    const bottomWordCount = container.querySelector('.border-t.border-gray-200.p-3');

    expect(wordCount).toHaveTextContent('Word Count');
    expect(wordCount).toHaveTextContent('3');
    expect(wordCount.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bottomWordCount).not.toBeInTheDocument();
  });

  it('blocks save interactions on Task 1 stimulus media', () => {
    const state = createExamState();
    state.writing.task1Chart = {
      id: 'chart-1',
      type: 'bar',
      title: 'Task 1 chart',
      labels: ['A'],
      values: [10],
      imageSrc: '/chart.png',
    };

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

    const stimulus = screen.getByText(/stimulus chart/i).closest('.rounded-3xl');
    if (!stimulus) {
      throw new Error('Expected stimulus chart container');
    }

    for (const eventName of ['contextmenu', 'dragstart', 'drop']) {
      const event = new Event(eventName, { bubbles: true, cancelable: true });
      fireEvent(stimulus, event);
      expect(event.defaultPrevented).toBe(true);
    }
  });
});
