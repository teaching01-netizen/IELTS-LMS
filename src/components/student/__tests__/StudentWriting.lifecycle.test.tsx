import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('restores the persisted writing draft into a freshly mounted editor after reload', () => {
    const onWritingChange = vi.fn();

    const renderFresh = () =>
      render(
        <StudentWriting
          state={createExamState()}
          writingAnswers={{ task1: 'Persisted draft' }}
          onWritingChange={onWritingChange}
          onSubmit={() => undefined}
          currentQuestionId="task1"
          onNavigate={() => undefined}
        />,
      );

    const first = renderFresh();
    expect(
      (screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement).value,
    ).toBe('Persisted draft');
    first.unmount();

    // A reload is a fresh mount reading the persisted attempt back in.
    renderFresh();
    expect(
      (screen.getByRole('textbox', { name: /writing response/i }) as HTMLTextAreaElement).value,
    ).toBe('Persisted draft');

    // Hydration must not synthesize a new draft mutation.
    expect(onWritingChange).not.toHaveBeenCalled();
  });
});
