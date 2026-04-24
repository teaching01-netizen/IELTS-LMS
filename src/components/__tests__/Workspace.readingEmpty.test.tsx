import React, { useState } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Workspace } from '../Workspace';
import { createInitialExamState } from '../../services/examAdapterService';

describe('Workspace (reading)', () => {
  it('renders a recovery UI when all passages are deleted', async () => {
    vi.useFakeTimers();

    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';
    state.reading.passages = [];
    state.activePassageId = '';

    render(<Workspace state={state} setState={() => {}} />);

    // Exit the transition skeleton.
    await act(async () => {
      vi.runAllTimers();
    });

    expect(screen.getByRole('heading', { name: /reading/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add passage/i })).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('keeps rapid passage additions from dropping a new passage', async () => {
    vi.useFakeTimers();

    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';

    function Harness() {
      const [examState, setExamState] = useState(state);
      return <Workspace state={examState} setState={setExamState} />;
    }

    render(<Harness />);

    await act(async () => {
      vi.runAllTimers();
    });

    const addPassageButton = screen.getByRole('button', { name: /add passage/i });

    await act(async () => {
      fireEvent.click(addPassageButton);
      fireEvent.click(addPassageButton);
    });

    expect(screen.getByText(/Passage 3/i)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('keeps the latest passage state through rapid add and delete interactions', async () => {
    vi.useFakeTimers();

    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';

    function Harness() {
      const [examState, setExamState] = useState(state);
      return <Workspace state={examState} setState={setExamState} />;
    }

    const { container } = render(<Harness />);

    await act(async () => {
      vi.runAllTimers();
    });

    const addPassageButton = screen.getByRole('button', { name: /add passage/i });
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;

    await act(async () => {
      fireEvent.click(addPassageButton);
      editor.innerHTML = '<p>Updated passage text</p>';
      fireEvent.input(editor);
    });

    expect(screen.getByText(/Passage 2/i)).toBeInTheDocument();

    const deleteButtons = screen.getAllByTitle('Delete passage');

    await act(async () => {
      fireEvent.click(deleteButtons[1]);
    });

    expect(screen.queryByText(/Passage 2/i)).toBeNull();

    vi.useRealTimers();
  });
});
