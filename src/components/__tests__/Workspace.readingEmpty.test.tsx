import React, { useState } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Workspace } from '../Workspace';
import { createInitialExamState } from '../../services/examAdapterService';

describe('Workspace (reading)', () => {
  it('renders a recovery UI when all passages are deleted', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';
    state.reading.passages = [];
    state.activePassageId = '';

    render(<Workspace state={state} setState={() => {}} />);

    expect(screen.getByRole('heading', { name: /reading/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add passage/i })).toBeInTheDocument();
  });

  it('keeps rapid passage additions from dropping a new passage', async () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';

    function Harness() {
      const [examState, setExamState] = useState(state);
      return <Workspace state={examState} setState={setExamState} />;
    }

    render(<Harness />);

    const addPassageButton = screen.getByRole('button', { name: /add passage/i });

    await act(async () => {
      fireEvent.click(addPassageButton);
      fireEvent.click(addPassageButton);
    });

    expect(screen.getByText(/Passage 3/i)).toBeInTheDocument();
  });

  it('keeps the latest passage state through rapid add and delete interactions', async () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.activeModule = 'reading';

    function Harness() {
      const [examState, setExamState] = useState(state);
      return <Workspace state={examState} setState={setExamState} />;
    }

    const { container } = render(<Harness />);

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
  });
});
