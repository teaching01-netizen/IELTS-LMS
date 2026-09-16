import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    {
      id: 'task2',
      label: 'Task 2',
      taskType: 'task2',
      minWords: 250,
      recommendedTime: 40,
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

function setWritingEditorText(editor: HTMLElement, value: string) {
  if (editor instanceof HTMLTextAreaElement) {
    fireEvent.change(editor, { target: { value } });
    return;
  }
  editor.textContent = value;
  fireEvent.input(editor);
}

function WritingHarnessWithTaskAlias() {
  const [writingAnswers, setWritingAnswers] = React.useState<Record<string, string>>({});
  const [currentQuestionId, setCurrentQuestionId] = React.useState<string | null>('task-1');

  return (
    <StudentWriting
      state={createExamState()}
      writingAnswers={writingAnswers}
      onWritingChange={(taskId, text) => {
        setWritingAnswers((prev) => ({ ...prev, [taskId]: text }));
      }}
      onSubmit={() => undefined}
      currentQuestionId={currentQuestionId}
      onNavigate={setCurrentQuestionId}
      showSubmitButton={false}
    />
  );
}

describe('StudentWriting lifecycle durability', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('commits the current editor draft on compositionend', () => {
    const onWritingChange = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    setWritingEditorText(editor, 'Composed draft');

    fireEvent.compositionEnd(editor);

    expect(onWritingChange).toHaveBeenCalledWith('task1', 'Composed draft');
  });

  it('commits the current editor draft when the page is hidden or unloaded', () => {
    const onWritingChange = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });

    setWritingEditorText(editor, 'Draft before pagehide');
    fireEvent(window, new Event('pagehide'));
    expect(onWritingChange).toHaveBeenCalledWith('task1', 'Draft before pagehide');

    onWritingChange.mockClear();
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    setWritingEditorText(editor, 'Draft before hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(onWritingChange).toHaveBeenCalledWith('task1', 'Draft before hidden');

    if (originalDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalDescriptor);
    }
  });

  it('commits the current editor draft on freeze and beforeunload', () => {
    const onWritingChange = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId={null}
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });

    setWritingEditorText(editor, 'Draft before freeze');
    fireEvent(document, new Event('freeze'));
    expect(onWritingChange).toHaveBeenCalledWith('task1', 'Draft before freeze');

    onWritingChange.mockClear();
    setWritingEditorText(editor, 'Draft before unload');
    fireEvent(window, new Event('beforeunload'));
    expect(onWritingChange).toHaveBeenCalledWith('task1', 'Draft before unload');
  });

  it('commits the current editor draft before switching writing tasks', () => {
    const onWritingChange = vi.fn();
    const onNavigate = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId="task1"
        onNavigate={onNavigate}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    setWritingEditorText(editor, 'Task 1 visible draft');

    fireEvent.click(screen.getByRole('button', { name: 'Task 2' }));

    expect(onWritingChange).toHaveBeenCalledWith('task1', 'Task 1 visible draft');
    expect(onNavigate).toHaveBeenCalledWith('task2');
  });

  it('commits the current editor draft before opening submit review', () => {
    const onWritingChange = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId="task1"
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    setWritingEditorText(editor, 'Final visible draft');

    fireEvent.click(screen.getByRole('button', { name: /review & submit/i }));

    expect(onWritingChange).toHaveBeenCalledWith('task1', 'Final visible draft');
  });

  it('commits blur draft and allows a subsequent edit after refocus', () => {
    vi.useFakeTimers();
    const onWritingChange = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId="task1"
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    setWritingEditorText(editor, 'blur value');
    fireEvent.blur(editor);

    fireEvent.focus(editor);
    setWritingEditorText(editor, 'late iPad value');
    vi.runAllTimers();

    expect(onWritingChange).toHaveBeenCalledWith('task1', 'blur value');
    expect(onWritingChange).toHaveBeenCalledWith('task1', 'late iPad value');
    expect(onWritingChange).toHaveBeenLastCalledWith('task1', 'late iPad value');
  });

  it('keeps committed blur value stable when value does not change', () => {
    vi.useFakeTimers();
    const onWritingChange = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId="task1"
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    setWritingEditorText(editor, 'stable value');
    fireEvent.blur(editor);

    vi.runAllTimers();

    expect(onWritingChange).toHaveBeenLastCalledWith('task1', 'stable value');
  });

  it('preserves exact whitespace and line breaks in writing input commits', () => {
    const onWritingChange = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId="task1"
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    const exact = '  line 1 with  spaces\n\n\tline 3 after blank\n  ';
    setWritingEditorText(editor, exact);
    fireEvent.blur(editor);

    expect(onWritingChange).toHaveBeenLastCalledWith('task1', exact);
  });

  it('preserves consecutive blank lines when committing textarea drafts', () => {
    const onWritingChange = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId="task1"
        onNavigate={() => undefined}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    fireEvent.change(editor, { target: { value: 'Line 1\n\nLine 3' } });
    fireEvent.blur(editor);

    expect(onWritingChange).toHaveBeenCalledWith('task1', 'Line 1\n\nLine 3');
  });

  it('preserves task 1 text when runtime task id uses dashed alias during task switches', () => {
    render(<WritingHarnessWithTaskAlias />);

    const editor = screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement;
    setWritingEditorText(editor, 'Boundary draft');

    fireEvent.click(screen.getByRole('button', { name: 'Task 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Task 1' }));

    expect((screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement).value).toBe(
      'Boundary draft',
    );
  });
  it('preserves the response when switching compact prompt and response panes', () => {
    const onWritingChange = vi.fn();

    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={onWritingChange}
        onSubmit={() => undefined}
        currentQuestionId="task1"
        onNavigate={() => undefined}
        layoutMode="compact"
        showSubmitButton={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show response' }));
    const editor = screen.getByRole('textbox', { name: /writing response/i });
    setWritingEditorText(editor, 'Compact response draft');

    fireEvent.click(screen.getByRole('button', { name: 'Show prompt' }));
    expect(screen.queryByRole('textbox', { name: /writing response/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('writing-task-prompt')).toHaveTextContent('Task 1 prompt');

    fireEvent.click(screen.getByRole('button', { name: 'Show response' }));
    expect(screen.getByRole('textbox', { name: /writing response/i })).toHaveValue('Compact response draft');
    expect(screen.queryByRole('button', { name: /review & submit/i })).not.toBeInTheDocument();
  });
  it('gives the compact prompt pane its own vertical scroll owner', () => {
    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId="task1"
        onNavigate={() => undefined}
        layoutMode="compact"
        showSubmitButton={false}
      />,
    );

    const promptScrollOwner = screen
      .getByTestId('writing-task-prompt')
      .closest<HTMLElement>('[data-student-zoom-scroll]');

    expect(promptScrollOwner).not.toBeNull();
    expect(promptScrollOwner).toHaveClass('flex-1', 'min-h-0', 'overflow-y-auto');
  });

  it('keeps the countdown visible without a runtime-clock provider (T2.5 isolation)', () => {
    // StudentWriting no longer subscribes to useStudentRuntimeClock itself; the
    // prompt-pane countdown leaves own the ticking subscription, so rendering
    // outside any RuntimeClockContext must still show a timer with the same
    // accessible label and must leave the typed draft untouched.
    render(
      <StudentWriting
        state={createExamState()}
        writingAnswers={{}}
        onWritingChange={() => undefined}
        onSubmit={() => undefined}
        currentQuestionId="task1"
        onNavigate={() => undefined}
        showSubmitButton={false}
      />,
    );

    const editor = screen.getByRole('textbox', { name: /writing response/i });
    setWritingEditorText(editor, 'Isolated draft');

    const timer = screen.getByRole('timer', { name: /time remaining in writing section/i });
    expect(timer).toBeInTheDocument();
    expect(timer).toHaveTextContent('60:00');
    expect(editor).toHaveValue('Isolated draft');
  });
});

/**
 * Bug 2 preservation: freshness is decided by explicit task identity and the
 * parent's acknowledgement, never by text length. Each case starts from a
 * stale prop so a length heuristic would pick the wrong side.
 */
describe('StudentWriting draft reconciliation (Bug 2 preservation)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function baseProps(onWritingChange: (taskId: string, text: string) => void, currentQuestionId = 'task1') {
    return {
      state: createExamState(),
      onWritingChange,
      onSubmit: () => undefined,
      currentQuestionId,
      onNavigate: () => undefined,
    };
  }

  it('commits a shorter focused correction at unmount despite a stale longer prop', () => {
    vi.useFakeTimers();
    const onWritingChange = vi.fn();
    const props = baseProps(onWritingChange);
    const view = render(<StudentWriting {...props} writingAnswers={{ task1: 'old long answer' }} />);
    const editor = screen.getByRole('textbox', { name: /writing response/i });

    fireEvent.focus(editor);
    setWritingEditorText(editor, 'new');
    view.rerender(<StudentWriting {...props} writingAnswers={{ task1: 'old long answer' }} />);

    // The longer stale prop never replaces the retained native edit.
    expect(editor).toHaveValue('new');
    view.unmount();
    expect(onWritingChange).toHaveBeenCalledWith('task1', 'new');
  });

  it('commits the retained shorter edit on blur despite a stale longer prop', () => {
    const onWritingChange = vi.fn();
    const props = baseProps(onWritingChange);
    const view = render(<StudentWriting {...props} writingAnswers={{ task1: 'long stale answer' }} />);
    const editor = screen.getByRole('textbox', { name: /writing response/i });

    fireEvent.focus(editor);
    setWritingEditorText(editor, 'short');
    view.rerender(<StudentWriting {...props} writingAnswers={{ task1: 'long stale answer' }} />);
    fireEvent.blur(editor);

    expect(onWritingChange).toHaveBeenLastCalledWith('task1', 'short');
    expect(editor).toHaveValue('short');
  });

  it('commits a delete-to-empty at unmount despite a stale prop holding the old answer', () => {
    vi.useFakeTimers();
    const onWritingChange = vi.fn();
    const props = baseProps(onWritingChange);
    const view = render(<StudentWriting {...props} writingAnswers={{ task1: 'previous answer' }} />);
    const editor = screen.getByRole('textbox', { name: /writing response/i });

    fireEvent.focus(editor);
    setWritingEditorText(editor, '');
    view.rerender(<StudentWriting {...props} writingAnswers={{ task1: 'previous answer' }} />);

    expect(editor).toHaveValue('');
    view.unmount();
    expect(onWritingChange).toHaveBeenCalledWith('task1', '');
  });

  it('keeps a same-length local edit when a stale prop arrives while unfocused', () => {
    vi.useFakeTimers();
    const onWritingChange = vi.fn();
    const props = baseProps(onWritingChange);
    const view = render(<StudentWriting {...props} writingAnswers={{ task1: 'OLD' }} />);
    const editor = screen.getByRole('textbox', { name: /writing response/i });

    setWritingEditorText(editor, 'NEW');
    view.rerender(<StudentWriting {...props} writingAnswers={{ task1: 'OLD' }} />);

    // Equal length is neither older nor newer — the local edit stays.
    expect(editor).toHaveValue('NEW');
    vi.runAllTimers();
    expect(onWritingChange).toHaveBeenCalledWith('task1', 'NEW');
  });

  it('keeps an append when a shorter stale prop arrives', () => {
    const onWritingChange = vi.fn();
    const props = baseProps(onWritingChange);
    const view = render(<StudentWriting {...props} writingAnswers={{ task1: 'first' }} />);
    const editor = screen.getByRole('textbox', { name: /writing response/i });

    setWritingEditorText(editor, 'first and more');
    view.rerender(<StudentWriting {...props} writingAnswers={{ task1: 'first' }} />);

    expect(editor).toHaveValue('first and more');
  });

  it('treats the echoed prop as acknowledgement: no re-commit, no revert, no duplicate send', () => {
    vi.useFakeTimers();
    const commits: Array<[string, string]> = [];

    function Harness() {
      const [answers, setAnswers] = React.useState<Record<string, string>>({ task1: 'server value' });
      return (
        <StudentWriting
          state={createExamState()}
          writingAnswers={answers}
          onWritingChange={(taskId, text) => {
            commits.push([taskId, text]);
            setAnswers((current) => ({ ...current, [taskId]: text }));
          }}
          onSubmit={() => undefined}
          currentQuestionId="task1"
          onNavigate={() => undefined}
          showSubmitButton={false}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement;
    expect(editor.value).toBe('server value');

    fireEvent.focus(editor);
    setWritingEditorText(editor, 'correction');
    fireEvent.blur(editor);
    expect(commits).toEqual([['task1', 'correction']]);

    vi.runAllTimers();
    expect(commits).toEqual([['task1', 'correction']]);
    expect(editor.value).toBe('correction');
  });
});

/**
 * Bug 4 preservation: the textarea is one uncontrolled node reused across
 * tasks, so task identity is explicit — the outgoing task is committed under
 * its own id, then the incoming task's text is loaded into the same editor even
 * while it holds focus.
 */
describe('StudentWriting task identity (Bug 4 preservation)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps each task answer under its own identity across a focused external switch', () => {
    const exam = createExamState();
    const commits: Array<[string, string]> = [];
    let navigate: (taskId: string) => void = () => undefined;

    function Harness() {
      const [answers, setAnswers] = React.useState<Record<string, string>>({
        task1: 'Answer one',
        task2: 'Answer two',
      });
      const [currentTaskId, setCurrentTaskId] = React.useState('task1');
      navigate = setCurrentTaskId;
      return (
        <StudentWriting
          state={exam}
          writingAnswers={answers}
          onWritingChange={(taskId, text) => {
            commits.push([taskId, text]);
            setAnswers((current) => ({ ...current, [taskId]: text }));
          }}
          onSubmit={() => undefined}
          currentQuestionId={currentTaskId}
          onNavigate={setCurrentTaskId}
        />
      );
    }

    render(<Harness />);
    const editor = screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement;
    expect(editor.value).toBe('Answer one');

    fireEvent.focus(editor);
    setWritingEditorText(editor, 'Answer one revised');
    // External navigation without a blur: the editor keeps the focus.
    act(() => navigate('task2'));

    // The switch loads Task 2's OWN text, and Task 1's edit was committed
    // under Task 1 — never as Task 2's answer.
    expect(editor.dataset.taskId).toBe('task2');
    expect(editor.value).toBe('Answer two');
    expect(commits).toEqual([['task1', 'Answer one revised']]);

    // A further keystroke, then blur, stays on Task 2.
    setWritingEditorText(editor, 'Answer two revised');
    fireEvent.blur(editor);
    expect(commits).toEqual([
      ['task1', 'Answer one revised'],
      ['task2', 'Answer two revised'],
    ]);

    // Submit review reads both tasks with their own values.
    fireEvent.click(screen.getByRole('button', { name: /review & submit/i }));
    const review = screen.getByRole('dialog');
    expect(review).toHaveTextContent('Answer one revised');
    expect(review).toHaveTextContent('Answer two revised');

    // Returning to Task 1 restores its revision — and re-sends nothing.
    act(() => navigate('task1'));
    expect(editor.value).toBe('Answer one revised');
    expect(commits).toHaveLength(2);
  });
});
