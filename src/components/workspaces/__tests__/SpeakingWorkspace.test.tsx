import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInitialExamState } from '../../../services/examAdapterService';
import type { ExamState } from '../../../types';
import { SpeakingWorkspace } from '../SpeakingWorkspace';

function renderWorkspace(state: ExamState) {
  const setState = vi.fn();
  const utils = render(<SpeakingWorkspace state={state} setState={setState} />);
  return { ...utils, setState };
}

function resolveNextState(state: ExamState, setState: ReturnType<typeof vi.fn>): ExamState {
  const arg = setState.mock.calls.at(-1)?.[0] as unknown as
    | ExamState
    | ((previous: ExamState) => ExamState);
  return typeof arg === 'function' ? arg(state) : arg;
}

describe('SpeakingWorkspace', () => {
  it('renders all three speaking parts with live audio badges', () => {
    const state = createInitialExamState('Exam', 'Academic');
    renderWorkspace(state);

    expect(screen.getByText('Part 1: Introduction & Interview')).toBeInTheDocument();
    expect(screen.getByText('Part 2: Individual Long Turn')).toBeInTheDocument();
    expect(screen.getByText('Part 3: Two-way Discussion')).toBeInTheDocument();
    expect(screen.getAllByText('Live Audio')).toHaveLength(3);
  });

  it('renders Part 1 topic areas with the initial topics', () => {
    const state = createInitialExamState('Exam', 'Academic');
    renderWorkspace(state);

    expect(screen.getByText('Topic Areas (Intro)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Work/Studies')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Home Town/Accommodation')).toBeInTheDocument();
  });

  it('renders the cue card builder with a live preview', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container } = renderWorkspace(state);

    expect(screen.getByText('Cue Card Builder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Cue card topic')).toHaveValue(
      'Describe something you own which is very important to you.',
    );
    expect(screen.getByPlaceholderText('Bullet point 1')).toHaveValue('what it is');
    expect(screen.getByPlaceholderText('Bullet point 4')).toHaveValue('how often you use it');
    expect(screen.getByPlaceholderText('Time allocation')).toHaveValue(
      '1 minute preparation + up to 2 minutes speaking',
    );
    expect(screen.getByText('Exam-style cue card preview')).toBeInTheDocument();
    expect(
      screen.getByText('Describe something you own which is very important to you.'),
    ).toBeInTheDocument();
    expect(screen.getByText('what it is')).toBeInTheDocument();
    // All four default bullets are non-empty, so the preview lists each one.
    expect(container.querySelectorAll('li')).toHaveLength(4);
  });

  it('renders Part 3 discussion prompts', () => {
    const state = createInitialExamState('Exam', 'Academic');
    renderWorkspace(state);

    expect(screen.getByText('Discussion Prompts')).toBeInTheDocument();
    expect(screen.getByText('Q1')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('Why do some people value material possessions more than experiences?'),
    ).toBeInTheDocument();
  });

  it('renders prep and speaking time controls for every part', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container } = renderWorkspace(state);

    expect(screen.getAllByText('Prep Time')).toHaveLength(3);
    expect(screen.getAllByText('Speaking Time')).toHaveLength(3);

    // DOM order per part card is prep input then speaking input, before the
    // four rubric weight inputs rendered later by the GradingRubricPanel.
    const numberInputs = container.querySelectorAll('input[type="number"]');
    expect(numberInputs).toHaveLength(10);
    expect((numberInputs[2] as HTMLInputElement).value).toBe('60');
    expect((numberInputs[3] as HTMLInputElement).value).toBe('120');
  });

  it('renders the rubric attachment and examiner private workspace', () => {
    const state = createInitialExamState('Exam', 'Academic');
    renderWorkspace(state);

    expect(screen.getByText('Speaking Rubric Attachment')).toBeInTheDocument();
    expect(screen.getByText('Examiner Private Workspace')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Institution rubric name')).toHaveValue('IELTS Speaking');
    expect(
      screen.getByPlaceholderText('Candidate strengths, weaknesses, or observations...'),
    ).toBeInTheDocument();
    expect(screen.getByText('Active Criteria')).toBeInTheDocument();
    expect(screen.getAllByText('Fluency & Coherence').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Lexical Resource').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Grammatical Range & Accuracy').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Pronunciation').length).toBeGreaterThanOrEqual(1);
  });

  it('updates a Part 1 topic through setState', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.change(screen.getByDisplayValue('Work/Studies'), {
      target: { value: 'Hobbies and Interests' },
    });

    expect(setState).toHaveBeenCalledTimes(1);
    const next = resolveNextState(state, setState);
    expect(next.speaking.part1Topics[0]).toBe('Hobbies and Interests');
    expect(next.speaking.part1Topics[1]).toBe('Home Town/Accommodation');
  });

  it('updates the cue card topic and keeps cueCardDetails in sync', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.change(screen.getByPlaceholderText('Cue card topic'), {
      target: { value: 'Describe a memorable journey.' },
    });

    const next = resolveNextState(state, setState);
    expect(next.speaking.cueCard).toBe('Describe a memorable journey.');
    expect(next.speaking.cueCardDetails?.topic).toBe('Describe a memorable journey.');
  });

  it('updates a cue card bullet through setState', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.change(screen.getByPlaceholderText('Bullet point 2'), {
      target: { value: 'where you went' },
    });

    const next = resolveNextState(state, setState);
    expect(next.speaking.cueCardDetails?.bullets[1]).toBe('where you went');
    expect(next.speaking.cueCardDetails?.bullets[0]).toBe('what it is');
  });

  it('updates the cue card time allocation', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.change(screen.getByPlaceholderText('Time allocation'), {
      target: { value: '2 minutes preparation + 3 minutes speaking' },
    });

    const next = resolveNextState(state, setState);
    expect(next.speaking.cueCardDetails?.timeAllocation).toBe(
      '2 minutes preparation + 3 minutes speaking',
    );
  });

  it('updates a Part 3 discussion question', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.change(
      screen.getByDisplayValue(
        'Why do some people value material possessions more than experiences?',
      ),
      { target: { value: 'Do experiences matter more than possessions?' } },
    );

    const next = resolveNextState(state, setState);
    expect(next.speaking.part3Discussion).toEqual([
      'Do experiences matter more than possessions?',
    ]);
  });

  it('updates prep time for a part and clamps negatives to zero', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);
    const numberInputs = container.querySelectorAll('input[type="number"]');

    fireEvent.change(numberInputs[2] as HTMLInputElement, { target: { value: '90' } });
    const next = resolveNextState(state, setState);
    expect(
      next.config.sections.speaking.parts.find((part) => part.id === 'part2')?.prepTime,
    ).toBe(90);
    expect(
      next.config.sections.speaking.parts.find((part) => part.id === 'part1')?.prepTime,
    ).toBe(0);

    setState.mockClear();
    fireEvent.change(numberInputs[0] as HTMLInputElement, { target: { value: '-5' } });
    const clamped = resolveNextState(state, setState);
    expect(
      clamped.config.sections.speaking.parts.find((part) => part.id === 'part1')?.prepTime,
    ).toBe(0);

    setState.mockClear();
    fireEvent.change(numberInputs[4] as HTMLInputElement, { target: { value: '45.6' } });
    const floored = resolveNextState(state, setState);
    expect(
      floored.config.sections.speaking.parts.find((part) => part.id === 'part3')?.prepTime,
    ).toBe(45);
  });

  it('updates speaking time for a part', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);
    const numberInputs = container.querySelectorAll('input[type="number"]');

    fireEvent.change(numberInputs[3] as HTMLInputElement, { target: { value: '180' } });

    const next = resolveNextState(state, setState);
    expect(
      next.config.sections.speaking.parts.find((part) => part.id === 'part2')?.speakingTime,
    ).toBe(180);
    expect(
      next.config.sections.speaking.parts.find((part) => part.id === 'part1')?.speakingTime,
    ).toBe(300);
  });

  it('updates examiner notes and syncs them onto the cue card details', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.change(
      screen.getByPlaceholderText('Candidate strengths, weaknesses, or observations...'),
      { target: { value: 'Strong fluency, needs work on word stress.' } },
    );

    const next = resolveNextState(state, setState);
    expect(next.speaking.evaluatorNotes).toBe('Strong fluency, needs work on word stress.');
    expect(next.speaking.cueCardDetails?.evaluatorNotes).toBe(
      'Strong fluency, needs work on word stress.',
    );
  });

  it('updates the rubric title and marks the rubric custom', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { setState } = renderWorkspace(state);

    fireEvent.change(screen.getByPlaceholderText('Institution rubric name'), {
      target: { value: 'Academy Custom Rubric' },
    });

    const next = resolveNextState(state, setState);
    expect(next.speaking.rubric?.title).toBe('Academy Custom Rubric');
    expect(next.speaking.rubric?.custom).toBe(true);
  });

  it('syncs rubric weight edits back into the standards config', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const { container, setState } = renderWorkspace(state);
    const numberInputs = container.querySelectorAll('input[type="number"]');

    // The four rubric weight inputs follow the six per-part time inputs, with
    // fluency first.
    const fluencyWeight = numberInputs[6] as HTMLInputElement;
    expect(fluencyWeight.value).toBe('25');
    fireEvent.change(fluencyWeight, { target: { value: '30' } });

    const next = resolveNextState(state, setState);
    expect(next.config.standards.rubricWeights.speaking.fluency).toBe(30);
    expect(next.config.standards.rubricWeights.speaking.lexical).toBe(25);
    expect(next.speaking.rubric?.custom).toBe(true);
    expect(
      next.speaking.rubric?.criteria.find((criterion) => criterion.id === 'fluency')?.weight,
    ).toBe(30);
  });

  it('renders empty topic and discussion states without inputs', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const emptyState: ExamState = {
      ...state,
      speaking: { ...state.speaking, part1Topics: [], part3Discussion: [] },
    };
    renderWorkspace(emptyState);

    expect(screen.getByText('Topic Areas (Intro)')).toBeInTheDocument();
    expect(screen.getByText('Discussion Prompts')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Work/Studies')).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue(
        'Why do some people value material possessions more than experiences?',
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Q1')).not.toBeInTheDocument();
  });

  it('falls back to cue card defaults when cueCardDetails is missing', () => {
    const state = createInitialExamState('Exam', 'Academic');
    const fallbackState: ExamState = {
      ...state,
      speaking: {
        ...state.speaking,
        cueCard: 'My custom topic',
        cueCardDetails: undefined,
        evaluatorNotes: 'private note',
      },
    };
    const { container } = renderWorkspace(fallbackState);

    expect(screen.getByPlaceholderText('Cue card topic')).toHaveValue('My custom topic');
    expect(screen.getByPlaceholderText('Bullet point 1')).toHaveValue('');
    expect(screen.getByPlaceholderText('Bullet point 4')).toHaveValue('');
    expect(screen.getByPlaceholderText('Evaluator notes')).toHaveValue('private note');
    expect(screen.getByText('My custom topic')).toBeInTheDocument();
    // Empty bullets render no preview list items.
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
