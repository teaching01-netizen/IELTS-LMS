import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShortAnswerBlock } from '../../../../types';
import {
  createInitialExamState,
  getStudentQuestionsForModule,
} from '../../../../services/examAdapterService';
import type { StudentQuestionDescriptor } from '../../../../services/examAdapterService';
import { CompactQuestionNavigation } from '../CompactQuestionNavigation';

function createQuestion(id: string, number: number, rootId = id): StudentQuestionDescriptor {
  const block: ShortAnswerBlock = {
    id: `block-${id}`,
    type: 'SHORT_ANSWER',
    instruction: 'Answer the question.',
    questions: [
      {
        id,
        prompt: `Question ${number}`,
        correctAnswer: 'answer',
        answerRule: 'ONE_WORD',
      },
    ],
  };

  return {
    id,
    blockId: block.id,
    groupId: 'group-1',
    groupLabel: 'Section 1',
    isMulti: false,
    correctCount: 1,
    answerKey: id,
    block,
    question: block.questions[0],
    rootId,
    numberLabel: String(number),
  };
}

describe('CompactQuestionNavigation', () => {
  it('keeps previous and next separate from submit at the boundaries', () => {
    const onNavigate = vi.fn();
    const onSubmit = vi.fn();
    const questions = [createQuestion('q1', 1), createQuestion('q2', 2)];

    render(
      <CompactQuestionNavigation
        questions={questions}
        currentQuestionId="q1"
        onNavigate={onNavigate}
        onSubmit={onSubmit}
        showSubmitButton
      />,
    );

    expect(screen.getByRole('button', { name: 'Previous question' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(onNavigate).toHaveBeenCalledWith('q2');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
  it('keeps the active grouped scoring slot in the compact navigation sequence', () => {
    const onNavigate = vi.fn();
    const groupedRootId = 'block-sentence::sentence::q1::group::pair';
    const questions = [
      createQuestion('q1-slot-a', 1, groupedRootId),
      createQuestion('q1-slot-b', 2, groupedRootId),
      createQuestion('q2', 3),
    ];

    render(
      <CompactQuestionNavigation
        questions={questions}
        currentQuestionId="q1-slot-b"
        onNavigate={onNavigate}
        onSubmit={() => undefined}
        showSubmitButton={false}
      />,
    );

    expect(screen.getByRole('button', { name: /open question navigator/i })).toHaveAttribute(
      'aria-label',
      expect.stringContaining('question 1'),
    );
    expect(screen.getByRole('button', { name: 'Previous question' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(onNavigate).toHaveBeenCalledWith('q2');
  });
  it('navigates from the second cell of a grouped table slot', () => {
    const state = createInitialExamState('Exam', 'Academic');
    state.reading.passages[0].blocks = [
      {
        id: 'table-grouped',
        type: 'TABLE_COMPLETION',
        instruction: 'Complete the table.',
        headers: ['Item', 'Answer'],
        rows: [['First', '____'], ['Second', '____']],
        answerRule: 'ONE_WORD',
        cells: [
          {
            id: 'cell-1',
            row: 0,
            col: 1,
            correctAnswer: 'first',
            scoreGroupId: 'table-pair',
            requiredCorrect: 2,
          },
          {
            id: 'cell-2',
            row: 1,
            col: 1,
            correctAnswer: 'second',
            scoreGroupId: 'table-pair',
            requiredCorrect: 2,
          },
        ],
      } as any,
    ];
    const questions = getStudentQuestionsForModule(state, 'reading');
    const onNavigate = vi.fn();

    render(
      <CompactQuestionNavigation
        questions={questions}
        currentQuestionId={questions[1]!.id}
        onNavigate={onNavigate}
        onSubmit={() => undefined}
        showSubmitButton={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Previous question' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled();
  });

  it('opens the navigator from the current-question summary', () => {
    const onOpenNavigator = vi.fn();

    render(
      <CompactQuestionNavigation
        questions={[createQuestion('q1', 1)]}
        currentQuestionId="q1"
        onNavigate={() => undefined}
        onOpenNavigator={onOpenNavigator}
        onSubmit={() => undefined}
        showSubmitButton={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /open question navigator/i }));
    expect(onOpenNavigator).toHaveBeenCalledTimes(1);
  });
  it('focuses the navigator trigger before opening the dialog', () => {
    const onOpenNavigator = vi.fn();

    render(
      <CompactQuestionNavigation
        questions={[createQuestion('q1', 1)]}
        currentQuestionId="q1"
        onNavigate={() => undefined}
        onOpenNavigator={onOpenNavigator}
        onSubmit={() => undefined}
        showSubmitButton={false}
      />,
    );

    const trigger = screen.getByRole('button', { name: /open question navigator/i });
    trigger.blur();
    fireEvent.click(trigger);

    expect(trigger).toHaveFocus();
    expect(onOpenNavigator).toHaveBeenCalledTimes(1);
  });
});
