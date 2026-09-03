import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../services/examAdapterService';
import { ActScienceWorkspace } from '../ActScienceWorkspace';
import type { ExamState } from '../../types';

describe('ActScienceWorkspace', () => {
  it('starts with an empty stimulus list and adds a stimulus with a question set', () => {
    const state = createInitialExamState('ACT Science Practice', 'ACT', 'ACT Science');
    const setState = vi.fn((next: ExamState | ((previous: ExamState) => ExamState)) => {
      if (typeof next === 'function') {
        next(state);
      }
    });

    render(<ActScienceWorkspace state={state} setState={setState} />);

    expect(screen.getByText('No ACT Science stimuli yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Stimulus' }));

    expect(setState).toHaveBeenCalled();
    const nextState = setState.mock.calls[0]?.[0];
    expect(typeof nextState).toBe('function');
    const updated = (nextState as (previous: ExamState) => ExamState)(state);
    expect(updated.science.stimuli).toHaveLength(1);
    expect(updated.science.stimuli[0]?.blocks[0]?.questions).toHaveLength(1);
  });
});
