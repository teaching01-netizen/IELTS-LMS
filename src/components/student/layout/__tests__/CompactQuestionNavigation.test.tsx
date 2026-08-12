import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShortAnswerBlock } from '../../../../types';
import type { StudentQuestionDescriptor } from '../../../../services/examAdapterService';
import { CompactQuestionNavigation } from '../CompactQuestionNavigation';

function createQuestion(id: string, number: number): StudentQuestionDescriptor {
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
});
