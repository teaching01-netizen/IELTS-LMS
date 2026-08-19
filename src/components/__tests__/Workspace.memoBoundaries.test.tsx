import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Workspace } from '../Workspace';
import { createInitialExamState } from '../../services/examAdapterService';

const paneRenderCount = { current: 0 };

vi.mock('../QuestionBuilderPane', () => ({
  QuestionBuilderPane: React.memo((props: { title: string }) => {
    paneRenderCount.current += 1;
    return <div data-testid="question-builder-pane">{props.title}</div>;
  }),
}));

describe('Workspace memo boundaries', () => {
  it('does not re-render the question builder pane while typing in the passage editor', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';

    function Harness() {
      const [examState, setExamState] = useState(state);
      return <Workspace state={examState} setState={setExamState} />;
    }

    const { container } = render(<Harness />);
    paneRenderCount.current = 0;

    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    editor.innerHTML = '<p>Typing in the passage editor…</p>';
    fireEvent.input(editor);

    expect(paneRenderCount.current).toBe(0);
  });

  it('does not re-render the question builder pane when unrelated state changes', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';

    function Harness() {
      const [examState, setExamState] = useState(state);
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setExamState((prev) => ({ ...prev, speaking: { ...prev.speaking, cueCard: 'Unrelated edit' } }))
            }
          >
            Edit speaking section
          </button>
          <Workspace state={examState} setState={setExamState} />
        </>
      );
    }

    render(<Harness />);
    paneRenderCount.current = 0;

    fireEvent.click(screen.getByRole('button', { name: /edit speaking section/i }));

    expect(paneRenderCount.current).toBe(0);
  });

  it('does not re-render the question builder pane while editing the listening audio URL', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'listening';

    function Harness() {
      const [examState, setExamState] = useState(state);
      return <Workspace state={examState} setState={setExamState} />;
    }

    render(<Harness />);
    paneRenderCount.current = 0;

    const audioUrlInput = screen.getByLabelText('Audio URL') as HTMLInputElement;
    fireEvent.change(audioUrlInput, { target: { value: 'https://example.com/audio.mp3' } });

    expect(paneRenderCount.current).toBe(0);
  });
});