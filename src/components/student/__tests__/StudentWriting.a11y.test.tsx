import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';
import { StudentWriting } from '../StudentWriting';
import { StudentHighlightPersistenceProvider } from '../highlightV2Persistence';
import {
  createInMemoryHighlightSelectionPort,
  StudentHighlightSelectionPortProvider,
} from '../highlightSelectionPort';
import { StudentUIProvider, useStudentUI } from '../providers/StudentUIProvider';

function HighlightModeControls() {
  const { actions } = useStudentUI();
  return (
    <>
      <button type="button" onClick={() => actions.setHighlightToolMode('highlight')}>Use highlight</button>
      <button type="button" onClick={() => actions.setHighlightToolMode('erase')}>Use erase</button>
    </>
  );
}

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
  it('applies and erases a prompt highlight without making the writing editor highlightable', () => {
    const state = createExamState();
    state.writing.task1Prompt = '<p>Highlight <strong>this prompt</strong>.</p>';
    const port = createInMemoryHighlightSelectionPort({
      selection: { start: 0, end: 9, selectedText: 'Highlight' },
      selectionText: 'Highlight',
    });

    render(
      <StudentHighlightPersistenceProvider namespace="writing-interaction">
        <StudentHighlightSelectionPortProvider port={port}>
          <StudentUIProvider>
            <HighlightModeControls />
            <StudentWriting
              state={state}
              writingAnswers={{}}
              onWritingChange={() => undefined}
              onSubmit={() => undefined}
              currentQuestionId={null}
              onNavigate={() => undefined}
              highlightEnabled
              highlightColor="blue"
              highlightClassName="test-highlight"
            />
          </StudentUIProvider>
        </StudentHighlightSelectionPortProvider>
      </StudentHighlightPersistenceProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use highlight' }));
    act(() => port.emit());

    const prompt = screen.getByTestId('writing-task-prompt');
    const mark = prompt.querySelector('mark[data-highlighted="true"]');
    const editor = screen.getByRole('textbox', { name: /writing response/i });
    const promptScrollOwner = prompt.closest<HTMLElement>('[data-student-zoom-scroll]');
    expect(promptScrollOwner?.style.paddingBottom).toBe('');
    expect(promptScrollOwner?.style.scrollPaddingBottom).toBe('');
    expect(editor.style.paddingBottom).toBe('');
    expect(editor.style.scrollPaddingBottom).toBe('');
    expect(mark).toHaveTextContent('Highlight');
    expect(mark).toHaveClass('test-highlight');
    expect(editor.closest('[data-student-highlightable="true"]')).toBeNull();

    port.setSnapshot({
      selection: { start: 0, end: 9, selectedText: 'Highlight' },
      selectionText: 'Highlight',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use erase' }));
    act(() => port.emit());

    expect(prompt.querySelector('mark[data-highlighted="true"]')).toBeNull();
  });

  it('does not render Task 1 highlight ranges on Task 2 during a task switch', () => {
    const state = createExamState();
    state.config.sections.writing.tasks.push({
      id: 'task2',
      label: 'Task 2',
      taskType: 'task2',
      minWords: 250,
      recommendedTime: 40,
    });
    state.writing.task1Prompt = 'Alpha prompt';
    state.writing.task2Prompt = 'Bravo prompt';
    const port = createInMemoryHighlightSelectionPort({
      selection: { start: 0, end: 5, selectedText: 'Alpha' },
      selectionText: 'Alpha',
    });

    render(
      <StudentHighlightSelectionPortProvider port={port}>
        <StudentUIProvider>
          <HighlightModeControls />
          <StudentWriting
            state={state}
            writingAnswers={{}}
            onWritingChange={() => undefined}
            onSubmit={() => undefined}
            currentQuestionId={null}
            onNavigate={() => undefined}
            highlightEnabled
          />
        </StudentUIProvider>
      </StudentHighlightSelectionPortProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use highlight' }));
    act(() => port.emit());
    const taskOneSurface = screen
      .getByTestId('writing-task-prompt')
      .querySelector('[data-student-highlightable="true"]');
    expect(taskOneSurface?.querySelector('mark')).toHaveTextContent('Alpha');

    fireEvent.click(screen.getByRole('button', { name: 'Task 2' }));

    const taskTwoPrompt = screen.getByTestId('writing-task-prompt');
    const taskTwoSurface = taskTwoPrompt.querySelector('[data-student-highlightable="true"]');
    expect(taskTwoPrompt).toHaveTextContent('Bravo prompt');
    expect(taskTwoPrompt.querySelector('mark')).toBeNull();
    expect(taskTwoSurface).not.toBe(taskOneSurface);
  });

  it('renders an accessible writing editor', () => {
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

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor.getAttribute('class')).toMatch(/focus-visible/);
    expect(editor).toHaveClass('flex-1');
    expect(editor).toHaveClass('w-full');
    expect(editor).toHaveClass('overflow-y-auto');
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
    const resizer = screen.getByTestId('writing-pane-resizer');
    expect(workspace).toHaveStyle({
      '--writing-prompt-pane-width': '50%',
      '--writing-editor-pane-width': 'calc(50% - var(--split-divider-width))',
      '--split-divider-width': '16px',
    });
    expect(resizer.querySelector('.h-10.w-8')).toBeInTheDocument();

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

  it('renders a blank editor when a persisted writing answer is null', () => {
    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{ task1: null } as unknown as Record<string, string>}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getByRole('textbox', { name: /writing response/i })).toHaveValue('');
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
      '--split-divider-width': '8px',
    });
    expect(resizer).toHaveAttribute('role', 'slider');
    expect(resizer).toHaveAttribute('aria-valuenow', '50');
    expect(resizer).toHaveClass('w-8');
    expect(resizer).toHaveClass('absolute');
    expect(resizer.querySelector('.w-2')).toBeInTheDocument();
    expect(resizer.querySelector('.w-8')).toBeInTheDocument();
    expect(resizer.querySelector('.h-16')).toBeInTheDocument();
  });

  it('offsets tablet writing header and placeholder away from the splitter overlay', () => {
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

    const headerLabel = screen.getByText('Writing Response');
    const headerRow = headerLabel.closest('div');
    if (!headerRow) {
      throw new Error('Expected writing header row to render');
    }
    expect(headerRow).toHaveClass('pl-8');
    expect(headerRow).toHaveClass('pr-3');

    const placeholder = screen.getByText('Write your answer here…');
    expect(placeholder).toHaveClass('left-8');
    expect(placeholder).toHaveClass('md:left-8');
    expect(placeholder).toHaveClass('lg:left-8');
  });

  it('renders a single writing placeholder when empty and unfocused', () => {
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

    expect(screen.getAllByText('Write your answer here…')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: /writing response/i })).not.toHaveAttribute('placeholder');
  });

  it('hides placeholder on focus and typed content, then restores on clear + blur', () => {
    function Harness() {
      const [answers, setAnswers] = React.useState<Record<string, string>>({});
      return (
        <StudentWriting
          state={createExamState()}
          writingAnswers={answers}
          onWritingChange={(taskId, text) => {
            setAnswers((current) => ({ ...current, [taskId]: text }));
          }}
          onSubmit={() => undefined}
          currentQuestionId={null}
          onNavigate={() => undefined}
        />
      );
    }

    render(<Harness />);

    const editor = screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement;
    expect(screen.getAllByText('Write your answer here…')).toHaveLength(1);

    fireEvent.focus(editor);
    expect(screen.queryByText('Write your answer here…')).not.toBeInTheDocument();

    fireEvent.change(editor, { target: { value: 'hello world' } });
    fireEvent.blur(editor);
    expect(screen.queryByText('Write your answer here…')).not.toBeInTheDocument();

    fireEvent.change(editor, { target: { value: '' } });
    fireEvent.blur(editor);
    expect(screen.getAllByText('Write your answer here…')).toHaveLength(1);
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
      '--split-divider-width': '8px',
    });
    expect(resizer).toHaveAttribute('role', 'slider');
    expect(resizer).toHaveAttribute('aria-valuenow', '50');
    expect(resizer).toHaveClass('w-8');
    expect(resizer).toHaveClass('absolute');
    expect(resizer.querySelector('.w-2')).toBeInTheDocument();
    expect(resizer.querySelector('.w-8')).toBeInTheDocument();
    expect(resizer.querySelector('.h-16')).toBeInTheDocument();
  });

  it('offsets tablet writing header and editor content away from the splitter overlay', () => {
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

    const headerLabel = screen.getByText('Writing Response');
    const headerRow = headerLabel.closest('div');
    if (!headerRow) {
      throw new Error('Expected writing header row to render');
    }
    expect(headerRow).toHaveClass('pl-8');
    expect(headerRow).toHaveClass('pr-3');

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    expect(editor).toHaveClass('pl-8');
    expect(editor).toHaveClass('md:pl-8');
    expect(editor).toHaveClass('lg:pl-8');
  });

  it('preserves builder-authored HTML prompt formatting in the writing exam', () => {
    const state = createExamState();
    state.writing.task1Prompt = [
      '<p>You should spend about 20 minutes on this task.</p>',
      '<p><strong>Describe the chart in detail.</strong></p>',
      '<p>Write at least 150 words.</p>',
    ].join('');

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

    const prompt = screen.getByTestId('writing-task-prompt');
    expect(prompt.querySelectorAll('p')).toHaveLength(3);
    expect(prompt.querySelector('strong')).toHaveTextContent('Describe the chart in detail.');
  });

  it('keeps line breaks and whitespace for plain-text prompts', () => {
    const state = createExamState();
    state.writing.task1Prompt = 'Line 1\n\nLine 2 with  two spaces';

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

    expect(screen.getByTestId('writing-task-prompt').textContent).toContain('Line 1\n\nLine 2 with  two spaces');
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
    expect(within(footer).getByTestId('student-writing-footer-row')).toHaveClass(
      'overflow-x-auto',
    );
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

  it('normalizes Google Drive chart image URLs for browser display', () => {
    const state = createExamState();
    const driveUrl = 'https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing';
    state.writing.task1Chart = {
      id: 'chart-1',
      type: 'bar',
      title: 'Task 1 chart',
      labels: ['A'],
      values: [10],
      imageSrc: driveUrl,
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

    const stimulusImage = screen.getByRole('button', { name: /task 1 chart/i }).querySelector('img');
    expect(stimulusImage).toBeInTheDocument();
    expect(stimulusImage?.getAttribute('src')).toContain('drive.google.com/thumbnail');
    expect(stimulusImage?.getAttribute('src')).not.toBe(driveUrl);
  });
});
