import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Lobby } from '../Lobby';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';

function makeState(overrides?: Partial<ExamState['config']['sections']>): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  return {
    title: 'Test Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config: {
      ...config,
      sections: {
        ...config.sections,
        ...overrides,
      },
    },
    reading: { passages: [] },
    listening: { parts: [] },
    writing: { task1Prompt: '', task2Prompt: '' },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  };
}

describe('Lobby', () => {
  it('renders total duration from enabled modules', () => {
    const state = makeState();
    render(<Lobby state={state} onStart={() => {}} onExit={() => {}} />);
    expect(screen.getByText(/Total Duration/i)).toBeInTheDocument();
  });

  it('displays enabled module durations', () => {
    const state = makeState();
    render(<Lobby state={state} onStart={() => {}} onExit={() => {}} />);
    expect(screen.getByText(/Section Durations/i)).toBeInTheDocument();
  });

  it('calls onStart when Start Exam button is clicked', () => {
    const onStart = vi.fn();
    const state = makeState();
    render(<Lobby state={state} onStart={onStart} onExit={() => {}} />);
    fireEvent.click(screen.getByText(/Start Exam/i));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('displays instructions from config', () => {
    const state = makeState();
    state.config.general.instructions = 'Read carefully before starting.';
    render(<Lobby state={state} onStart={() => {}} onExit={() => {}} />);
    expect(screen.getByText('Read carefully before starting.')).toBeInTheDocument();
  });

  it('displays default instructions when none provided', () => {
    const state = makeState();
    state.config.general.instructions = '';
    render(<Lobby state={state} onStart={() => {}} onExit={() => {}} />);
    expect(screen.getByText(/No specific instructions provided/)).toBeInTheDocument();
  });

  it('calculates total duration correctly across enabled modules', () => {
    const state = makeState({
      listening: { enabled: true, order: 1, duration: 30, label: 'Listening', allowedQuestionTypes: [] },
      reading: { enabled: true, order: 2, duration: 60, label: 'Reading', allowedQuestionTypes: [] },
      writing: { enabled: false, order: 3, duration: 60, label: 'Writing', allowedQuestionTypes: [] },
      speaking: { enabled: false, order: 4, duration: 15, label: 'Speaking', allowedQuestionTypes: [] },
    });
    render(<Lobby state={state} onStart={() => {}} onExit={() => {}} />);
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });
});
