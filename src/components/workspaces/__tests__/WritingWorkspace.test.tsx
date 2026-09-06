import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../services/examAdapterService';
import type { ExamState } from '../../../types';
import { WritingWorkspace } from '../WritingWorkspace';

function renderWorkspace(state: ExamState) {
  const setState = vi.fn();
  const utils = render(<WritingWorkspace state={state} setState={setState} />);
  return { ...utils, setState };
}

function resolveNextState(state: ExamState, setState: ReturnType<typeof vi.fn>): ExamState {
  expect(setState).toHaveBeenCalled();
  const arg = setState.mock.calls.at(-1)?.[0] as unknown as
    | ExamState
    | ((previous: ExamState) => ExamState);
  expect(arg).toBeDefined();
  return typeof arg === 'function' ? (arg as (previous: ExamState) => ExamState)(state) : (arg as ExamState);
}

function getTaskCards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-task-id]')) as HTMLElement[];
}

// The GradingRubricPanel weight number inputs are the last criterion-count
// inputs in DOM order; this slice helper keeps assertions stable against added fields.
function getRubricWeightInputs(container: HTMLElement, criterionCount = 4): HTMLInputElement[] {
  const numberInputs = Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
  return numberInputs.slice(-criterionCount);
}

afterEach(() => {
  window.localStorage.clear();
});

describe('WritingWorkspace', () => {
  it('stores a Google Drive chart image URL instead of using file upload', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const setState = vi.fn();
    const driveUrl = 'https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing';

    const { container } = render(<WritingWorkspace state={state} setState={setState} />);

    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();

    const chartImageUrlInput = screen.getByLabelText(/chart image url/i);
    fireEvent.change(chartImageUrlInput, { target: { value: driveUrl } });

    const nextState = setState.mock.calls.at(-1)?.[0];
    expect(nextState.writing.tasks?.[0]?.chart?.imageSrc).toBe(driveUrl);
  });

  it('renders both writing tasks with word targets and task type badges', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container } = renderWorkspace(state);

    // Headings/badges also render inside the side task panel, so scope to the cards.
    const cards = getTaskCards(container);
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText('Task 1')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('Task 2')).toBeInTheDocument();
    expect(screen.getByText('150 words · 20 min')).toBeInTheDocument();
    expect(screen.getByText('250 words · 40 min')).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('Task 1 Academic')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('Task 2 Essay')).toBeInTheDocument();
  });

  it('renders the side task panel and collapses/expands it with localStorage persistence', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container } = renderWorkspace(state);

    expect(screen.getByText('Writing Tasks')).toBeInTheDocument();
    expect(screen.getByLabelText('Collapse task panel')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Collapse task panel'));
    expect(window.localStorage.getItem('writing-task-panel-collapsed')).toBe('true');
    expect(screen.getByLabelText('Expand task panel')).toBeInTheDocument();
    expect(screen.queryByLabelText('Collapse task panel')).not.toBeInTheDocument();
    // The panel stays mounted but is squeezed to zero width when collapsed.
    expect(container.querySelector('.w-0')).not.toBeNull();

    fireEvent.click(screen.getByLabelText('Expand task panel'));
    expect(window.localStorage.getItem('writing-task-panel-collapsed')).toBe('false');
    expect(screen.getByText('Writing Tasks')).toBeInTheDocument();
  });

  it('adds a Task 2 essay through the side panel add menu', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.click(screen.getByRole('button', { name: /add task/i }));
    fireEvent.click(screen.getByRole('button', { name: /task 2 essay/i }));

    const next = resolveNextState(state, setState);
    expect(next.config.sections.writing.tasks).toHaveLength(3);
    expect(next.config.sections.writing.tasks[2]).toMatchObject({
      id: 'task3',
      label: 'Task 3',
      taskType: 'task2-essay',
      minWords: 250,
      recommendedTime: 40,
    });
  });

  it('adds a Task 1 Academic task with Task 1 defaults', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.click(screen.getByRole('button', { name: /add task/i }));
    fireEvent.click(screen.getByRole('button', { name: /task 1 academic/i }));

    const next = resolveNextState(state, setState);
    expect(next.config.sections.writing.tasks).toHaveLength(3);
    expect(next.config.sections.writing.tasks[2]).toMatchObject({
      id: 'task3',
      taskType: 'task1-academic',
      minWords: 150,
      recommendedTime: 20,
    });
  });

  it('reorders tasks with the side panel move controls', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.click(screen.getByRole('button', { name: 'Move Task 1 down' }));

    const next = resolveNextState(state, setState);
    expect(next.config.sections.writing.tasks.map((task) => task.id)).toEqual(['task2', 'task1']);
  });

  it('renames a task through the side panel configure form', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.click(screen.getByRole('button', { name: 'Configure Task 1' }));
    const labelInputs = screen.getAllByDisplayValue('Task 1');
    fireEvent.change(labelInputs[0] as HTMLInputElement, { target: { value: 'Intro Task' } });

    const next = resolveNextState(state, setState);
    expect(next.config.sections.writing.tasks[0]?.label).toBe('Intro Task');
  });

  it('deletes a task after confirming in the side panel dialog', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Task 1' }));
    expect(screen.getByRole('alertdialog', { name: /confirm delete writing task/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const next = resolveNextState(state, setState);
    expect(next.config.sections.writing.tasks.map((task) => task.id)).toEqual(['task2']);
  });

  it('toggles the side panel configure form for a task', () => {
    // NOTE: handleEditTask/scrollIntoView in the workspace is unreachable from
    // the UI — WritingTaskPanel accepts onEditTask but never invokes it — so
    // this covers the reachable Configure toggle instead.
    const state = createInitialExamState('Exam', 'Academic');
    renderWorkspace(state);

    expect(screen.queryByDisplayValue('Task 1 Academic')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Configure Task 1' }));
    const typeSelect = screen.getByDisplayValue('Task 1 Academic') as HTMLSelectElement;
    expect(typeSelect.tagName).toBe('SELECT');
    fireEvent.click(screen.getByRole('button', { name: 'Configure Task 1' }));
    expect(screen.queryByDisplayValue('Task 1 Academic')).not.toBeInTheDocument();
  });

  it('opens the template library, filters it, and inserts a template prompt', async () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);
    const cards = getTaskCards(container);
    const templateButtons = screen.getAllByRole('button', { name: /templates/i });

    fireEvent.click(templateButtons[0] as HTMLButtonElement);
    expect(await screen.findByText('Prompt Templates')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search topic, category, or wording')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search topic, category, or wording'), {
      target: { value: 'no-such-template-xyz' },
    });
    expect(screen.queryByText('Education Trends')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search topic, category, or wording'), {
      target: { value: '' },
    });
    const dialog = screen.getByRole('dialog', { name: 'Prompt Templates' });
    fireEvent.click(within(dialog).getByRole('button', { name: /education trends/i }));

    const next = resolveNextState(state, setState);
    expect(next.writing.tasks?.[0]?.prompt).toBe(
      'The line graph below shows tertiary enrolment rates in five countries between 2000 and 2025.',
    );
    void cards;
  });

  it('saves the current prompt as a custom template', async () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.click(screen.getAllByRole('button', { name: /templates/i })[0] as HTMLButtonElement);
    expect(await screen.findByText('Prompt Templates')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Template title'), {
      target: { value: 'My Custom Prompt' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save current prompt/i }));

    const next = resolveNextState(state, setState);
    expect(next.writing.customPromptTemplates).toHaveLength(1);
    expect(next.writing.customPromptTemplates?.[0]).toMatchObject({ title: 'My Custom Prompt' });
  });

  it('toggles the model answer editor and saves its value', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);
    const cards = screen.getAllByText('Model Answer');
    expect(cards.length).toBeGreaterThan(0);

    const showButtons = screen.getAllByRole('button', { name: 'Show' });
    fireEvent.click(showButtons[0] as HTMLButtonElement);

    const editor = screen.getByPlaceholderText(/enter a model answer for task 1/i);
    expect(editor).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: 'This is a band 9 reference answer.' } });

    const next = resolveNextState(state, setState);
    expect(next.writing.tasks?.[0]?.modelAnswer).toBe('This is a band 9 reference answer.');
  });

  it('edits the prompt through the contentEditable editor', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    const editor = screen.getByRole('textbox', { name: 'Prompt editor for Task 1' });
    editor.focus();
    (editor as HTMLDivElement).innerHTML = '<p>Updated prompt text</p>';
    fireEvent.input(editor);

    const next = resolveNextState(state, setState);
    expect(next.writing.tasks?.[0]?.prompt).toBe('<p>Updated prompt text</p>');
  });

  it('applies bold formatting from the prompt toolbar', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    const docRecord = document as unknown as Record<string, unknown>;
    if (typeof docRecord.execCommand !== 'function') {
      docRecord.execCommand = () => true;
    }
    const execSpy = vi
      .spyOn(
        document as unknown as { execCommand: (command: string, showUI: boolean, value?: string) => boolean },
        'execCommand',
      )
      .mockImplementation(() => true);
    try {
      const editor = screen.getByRole('textbox', { name: 'Prompt editor for Task 1' });
      (editor as HTMLDivElement).innerHTML = 'formatted prompt';
      fireEvent.click(screen.getAllByTitle('Bold')[0] as HTMLButtonElement);

      expect(execSpy).toHaveBeenCalledWith('bold', false, undefined);
      const next = resolveNextState(state, setState);
      expect(next.writing.tasks?.[0]?.prompt).toBe('formatted prompt');
    } finally {
      execSpy.mockRestore();
    }
  });

  it('updates chart title, type, labels, and values for Task 1', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);
    const card = getTaskCards(container)[0] as HTMLElement;
    const scoped = within(card);

    fireEvent.change(scoped.getByDisplayValue('Museum visitors (millions)'), {
      target: { value: 'Updated chart title' },
    });
    expect(resolveNextState(state, setState).writing.tasks?.[0]?.chart?.title).toBe('Updated chart title');

    setState.mockClear();
    fireEvent.change(scoped.getByDisplayValue('Bar'), { target: { value: 'line' } });
    expect(resolveNextState(state, setState).writing.tasks?.[0]?.chart?.type).toBe('line');

    setState.mockClear();
    fireEvent.change(scoped.getByPlaceholderText('Labels: A, B, C'), {
      target: { value: 'X, Y' },
    });
    expect(resolveNextState(state, setState).writing.tasks?.[0]?.chart?.labels).toEqual(['X', 'Y']);

    setState.mockClear();
    fireEvent.change(scoped.getByPlaceholderText('Values: 3, 6, 4'), {
      target: { value: '10, 20' },
    });
    expect(resolveNextState(state, setState).writing.tasks?.[0]?.chart?.values).toEqual([10, 20]);
  });

  it('renders a chart builder preview that switches to an image preview once a URL is set', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const driveUrl = 'https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing';
    const withImage: ExamState = {
      ...state,
      writing: {
        ...state.writing,
        tasks: (state.writing.tasks ?? []).map((task, index) =>
          index === 0 && task.chart
            ? { ...task, chart: { ...task.chart, imageSrc: driveUrl } }
            : task,
        ),
      },
    };
    const { container, unmount } = renderWorkspace(withImage);
    const image = container.querySelector('img[alt="Museum visitors (millions)"]') as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image?.src).toContain('drive.google.com/thumbnail');
    unmount();

    const plain = createInitialExamState('Exam', 'Academic');
    const noImage: ExamState = {
      ...plain,
      writing: {
        ...plain.writing,
        tasks: (plain.writing.tasks ?? []).map((task, index) =>
          index === 0 && task.chart ? { ...task, chart: { ...task.chart, imageSrc: undefined } } : task,
        ),
      },
    };
    const rerendered = renderWorkspace(noImage);
    expect(rerendered.container.querySelector('[data-writing-chart-type="bar"]')).not.toBeNull();
    rerendered.unmount();
  });

  it('renders table and line chart previews when the chart type changes', () => {
    const base = createInitialExamState('Exam', 'Academic');
    const withType = (type: 'table' | 'line'): ExamState => ({
      ...base,
      writing: {
        ...base.writing,
        tasks: (base.writing.tasks ?? []).map((task, index) =>
          index === 0 && task.chart
            ? { ...task, chart: { ...task.chart, imageSrc: undefined, type } }
            : task,
        ),
      },
    });

    const tabled = renderWorkspace(withType('table'));
    expect(tabled.container.querySelector('[data-writing-chart-type="table"]')).not.toBeNull();
    tabled.unmount();

    const lined = renderWorkspace(withType('line'));
    expect(lined.container.querySelector('[data-writing-chart-type="line"]')).not.toBeNull();
    lined.unmount();
  });

  it('updates letter settings for a Task 1 General task', () => {
    const base = createInitialExamState('Exam', 'General Training');
    expect(base.config.sections.writing.tasks[0]?.taskType).toBe('task1-general');
    const { setState } = renderWorkspace(base);

    expect(screen.getByText('Letter Settings')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Formal'), { target: { value: 'informal' } });
    expect(resolveNextState(base, setState).writing.tasks?.[0]?.letterType).toBe('informal');

    setState.mockClear();
    fireEvent.change(screen.getByPlaceholderText('e.g., The Manager, Dear John, etc.'), {
      target: { value: 'The Council' },
    });
    expect(resolveNextState(base, setState).writing.tasks?.[0]?.recipient).toBe('The Council');

    setState.mockClear();
    fireEvent.change(screen.getByPlaceholderText('e.g., Complaint, Request, Information, etc.'), {
      target: { value: 'Complaint' },
    });
    expect(resolveNextState(base, setState).writing.tasks?.[0]?.letterPurpose).toBe('Complaint');
  });

  it('updates the Task 1 word requirement through the standards sync path', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);
    const card = getTaskCards(container)[0] as HTMLElement;
    const wordInput = within(card).getByDisplayValue('150') as HTMLInputElement;

    fireEvent.change(wordInput, { target: { value: '160' } });

    const next = resolveNextState(state, setState);
    expect(next.config.standards.writingTasks.task1.minWords).toBe(160);
    expect(next.config.sections.writing.tasks[0]?.minWords).toBe(160);
  });

  it('updates the Task 2 time requirement through the standards sync path', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);
    const card = getTaskCards(container)[1] as HTMLElement;
    const timeInput = within(card).getByDisplayValue('40') as HTMLInputElement;

    fireEvent.change(timeInput, { target: { value: '45' } });

    const next = resolveNextState(state, setState);
    expect(next.config.standards.writingTasks.task2.recommendedTime).toBe(45);
    expect(next.config.sections.writing.tasks[1]?.recommendedTime).toBe(45);
  });

  it('updates word-count guidance fields (optimal min/max and max limit)', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);
    const card = getTaskCards(container)[0] as HTMLElement;
    const scoped = within(card);

    fireEvent.change(scoped.getAllByPlaceholderText('Auto')[0] as HTMLInputElement, { target: { value: '160' } });
    expect(resolveNextState(state, setState).config.sections.writing.tasks[0]?.optimalMin).toBe(160);
  });

  it('clears word-count guidance back to undefined', () => {
    const base = createInitialExamState('Exam', 'Academic');
    const withGuidance: ExamState = {
      ...base,
      config: {
        ...base.config,
        sections: {
          ...base.config.sections,
          writing: {
            ...base.config.sections.writing,
            tasks: base.config.sections.writing.tasks.map((task, index) =>
              index === 0 ? { ...task, optimalMin: 160 } : task,
            ),
          },
        },
      },
    };
    const { container, setState } = renderWorkspace(withGuidance);
    const card = getTaskCards(container)[0] as HTMLElement;
    // Clearing the field falls back to undefined (empty string -> undefined).
    fireEvent.change(within(card).getAllByPlaceholderText('Auto')[0] as HTMLInputElement, {
      target: { value: '' },
    });
    expect(
      resolveNextState(withGuidance, setState).config.sections.writing.tasks[0]?.optimalMin,
    ).toBeUndefined();
  });

  it('updates the optimal max and max limit guidance fields', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);
    const card = getTaskCards(container)[0] as HTMLElement;
    const autos = within(card).getAllByPlaceholderText('Auto');
    const noLimit = within(card).getByPlaceholderText('No limit');

    fireEvent.change(autos[1] as HTMLInputElement, { target: { value: '220' } });
    expect(resolveNextState(state, setState).config.sections.writing.tasks[0]?.optimalMax).toBe(220);

    setState.mockClear();
    fireEvent.change(noLimit, { target: { value: '300' } });
    expect(resolveNextState(state, setState).config.sections.writing.tasks[0]?.maxWords).toBe(300);
  });

  it('renders and edits the writing rubric attachment', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);

    expect(screen.getByText('Writing Rubric Attachment')).toBeInTheDocument();
    const weights = getRubricWeightInputs(container);
    expect(weights).toHaveLength(4);
    expect(weights[0]?.value).toBe('25');

    fireEvent.change(weights[0] as HTMLInputElement, { target: { value: '30' } });
    const next = resolveNextState(state, setState);
    expect(next.config.standards.rubricWeights.writing.taskResponse).toBe(30);
    expect(next.writing.rubric?.custom).toBe(true);
    expect(
      next.writing.rubric?.criteria.find((criterion) => criterion.id === 'task-response')?.weight,
    ).toBe(30);
  });

  it('shows a deviation warning when rubric weights drift from official weighting', () => {
    const base = createInitialExamState('Exam', 'Academic');
    const drifted: ExamState = {
      ...base,
      config: {
        ...base.config,
        standards: {
          ...base.config.standards,
          rubricWeights: {
            ...base.config.standards.rubricWeights,
            writing: { taskResponse: 50, coherence: 10, lexical: 10, grammar: 10 },
          },
        },
      },
    };
    renderWorkspace(drifted);
    expect(screen.getByText(/weighting differs by more than/i)).toBeInTheDocument();
  });

  it('updates the grader preview rubric title', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    expect(screen.getByText('Grader Preview')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Institution rubric name'), {
      target: { value: 'Academy Writing Rubric' },
    });

    const next = resolveNextState(state, setState);
    expect(next.writing.rubric?.title).toBe('Academy Writing Rubric');
    expect(next.writing.rubric?.custom).toBe(true);
  });

  it('toggles analytics and renders word-count, completion, and rubric summaries', async () => {
    const state = createInitialExamState('Exam', 'Academic');
    renderWorkspace(state);

    expect(screen.getByText('Writing Analytics')).toBeInTheDocument();
    expect(screen.queryByText('Min Words')).not.toBeInTheDocument();

    // Two model-answer Show buttons precede the analytics toggle in DOM order.
    const showButtons = screen.getAllByRole('button', { name: 'Show' });
    fireEvent.click(showButtons[showButtons.length - 1] as HTMLButtonElement);

    expect(await screen.findByText('Min Words')).toBeInTheDocument();
    expect(screen.getByText('Optimal Range')).toBeInTheDocument();
    expect(screen.getByText('Total Time')).toBeInTheDocument();
    expect(screen.getByText('Task Completion')).toBeInTheDocument();
    expect(screen.getByText('Model Answers')).toBeInTheDocument();
    expect(screen.getByText('Rubric Weight Distribution')).toBeInTheDocument();
    // Default tasks: 150 + 250 min words, 20 + 40 minutes.
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('60m')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(screen.queryByText('Min Words')).not.toBeInTheDocument());
  });

  it('counts analytics completion once a model answer exists', async () => {
    const base = createInitialExamState('Exam', 'Academic');
    const withAnswer: ExamState = {
      ...base,
      writing: {
        ...base.writing,
        tasks: (base.writing.tasks ?? []).map((task, index) =>
          index === 0 ? { ...task, modelAnswer: 'Reference answer text' } : task,
        ),
      },
    };
    renderWorkspace(withAnswer);

    const completionShowButtons = screen.getAllByRole('button', { name: 'Show' });
    fireEvent.click(completionShowButtons[completionShowButtons.length - 1] as HTMLButtonElement);
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1 attached')).toBeInTheDocument();
    expect(screen.getByText('1 configured')).toBeInTheDocument();
  });

  it('reflects an externally updated prompt in the editor without clobbering focus', async () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { rerender } = renderWorkspace(state);
    const editor = screen.getByRole('textbox', { name: 'Prompt editor for Task 1' });

    await act(async () => {
      rerender(<WritingWorkspace state={state} setState={vi.fn()} />);
    });
    expect((editor as HTMLDivElement).innerHTML).toContain('visitors to three museums');

    const updated: ExamState = {
      ...state,
      writing: {
        ...state.writing,
        tasks: (state.writing.tasks ?? []).map((task) =>
          task.taskId === 'task1' ? { ...task, prompt: '<p>Externally replaced prompt</p>' } : task,
        ),
      },
    };
    await act(async () => {
      rerender(<WritingWorkspace state={updated} setState={vi.fn()} />);
    });
    expect((editor as HTMLDivElement).innerHTML).toContain('Externally replaced prompt');
  });
});
