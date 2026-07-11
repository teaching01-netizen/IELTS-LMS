import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Lobby } from '../Lobby';
import { createDefaultConfig } from '../../../constants/examDefaults';
import type { ExamState } from '../../../types';

function makeState(overrides?: Partial<ExamState['config']['sections']>): ExamState {
  const config = createDefaultConfig('Academic', 'Academic');
  return {
    title: 'Test Exam', type: 'Academic', activeModule: 'reading', activePassageId: 'p1', activeListeningPartId: 'l1',
    config: { ...config, sections: { ...config.sections, ...overrides } },
    reading: { passages: [] }, listening: { parts: [] }, writing: { task1Prompt: '', task2Prompt: '' },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  };
}

describe('Lobby', () => {
  it('renders the waiting room in the same exam-information shell without a student start action', () => {
    const state = makeState({
      listening: { enabled: true, order: 2, duration: 30, label: 'Listening', allowedQuestionTypes: [] },
      reading: { enabled: true, order: 1, duration: 60, label: 'Reading', allowedQuestionTypes: [] },
      writing: { enabled: false, order: 3, duration: 60, label: 'Writing', allowedQuestionTypes: [] },
      speaking: { enabled: false, order: 4, duration: 15, label: 'Speaking', allowedQuestionTypes: [] },
    });

    render(<Lobby state={state} candidateName="Ada Lovelace" candidateId="C-42" />);

    expect(screen.getByRole('heading', { name: 'Waiting for the exam to start' })).toBeInTheDocument();
    expect(screen.getByText('Test Exam')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('C-42')).toBeInTheDocument();
    expect(screen.getByText('Exam').className).toContain('text-gray-600');
    const sections = screen.getAllByTestId('exam-section');
    expect(sections[0]).toHaveTextContent('Reading');
    expect(sections[0]).toHaveTextContent('1 hour');
    expect(sections[1]).toHaveTextContent('Listening');
    expect(sections[1]).toHaveTextContent('30 minutes');
    expect(screen.getByText('1 hour 30 minutes')).toBeInTheDocument();
    expect(
      screen.getByText("You're checked in and waiting for the exam to start. Please keep this page open."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your exam timer will not begin while you are waiting. The timer starts when the proctor begins the exam.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your answers save automatically. If your connection drops, return on the same device and browser. Once the exam begins, refreshing or leaving this page will not pause the timer.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the proctor to start the exam');
    expect(screen.queryByText('Waiting for proctor')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start exam/i })).not.toBeInTheDocument();
  });

  it('only exposes the start action when preview capability is explicitly supplied', () => {
    const state = makeState();
    const { rerender } = render(<Lobby state={state} />);
    expect(screen.queryByRole('button', { name: 'Start Exam' })).not.toBeInTheDocument();
    rerender(<Lobby state={state} onPreviewStart={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Start Exam' })).toBeInTheDocument();
  });
});
