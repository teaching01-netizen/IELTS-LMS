import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StudentFooter } from '../StudentFooter';

describe('StudentFooter', () => {
  it('uses the shared student exam footer class contract', () => {
    render(
      <StudentFooter
        questions={[]}
        currentQuestionId={null}
        onNavigate={() => {}}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    const footer = screen.getByRole('contentinfo', {
      name: /question navigation and progress/i,
    });
    expect(footer).toHaveClass('student-exam-footer');
  });

  it('navigates when selecting a question chip', () => {
    const onNavigate = vi.fn();

    render(
      <StudentFooter
        questions={[
          {
            id: 'q1',
            blockId: 'block-1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: false,
            correctCount: 1,
            answerKey: 'q1',
            block: {} as any,
            question: null,
          },
          {
            id: 'q2',
            blockId: 'block-1',
            groupId: 'group-1',
            groupLabel: 'Section 1',
            isMulti: false,
            correctCount: 1,
            answerKey: 'q2',
            block: {} as any,
            question: null,
          },
        ]}
        currentQuestionId="q2"
        onNavigate={onNavigate}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(onNavigate).toHaveBeenCalledWith('q2');
  });

  it('collapses grouped scoring blanks into one footer slot', () => {
    const onNavigate = vi.fn();

    render(
      <StudentFooter
        questions={[
          {
            id: 'sentence-q1:blank-1',
            blockId: 'sentence-block',
            groupId: 'part-4',
            groupLabel: 'Part 4',
            isMulti: false,
            correctCount: 1,
            answerKey: 'sentence-q1',
            answerIndex: 0,
            block: {
              id: 'sentence-block',
              type: 'SENTENCE_COMPLETION',
              instruction: '',
              questions: [],
            } as any,
            question: {
              id: 'sentence-q1',
              sentence: 'Poisons from ____ or ____ are commonly consumed.',
              answerRule: 'TWO_WORDS',
              blanks: [
                {
                  id: 'blank-1',
                  correctAnswer: '',
                  position: 0,
                  scoreGroupId: 'sentence-q1',
                  scoreWeight: 1,
                  groupRule: 'at_least_n',
                  requiredCorrect: 2,
                },
                {
                  id: 'blank-2',
                  correctAnswer: '',
                  position: 1,
                  scoreGroupId: 'sentence-q1',
                  scoreWeight: 0,
                  groupRule: 'at_least_n',
                  requiredCorrect: 2,
                },
              ],
            } as any,
            rootId: 'sentence-block::sentence::sentence-q1::group::sentence-q1',
            rootNumber: 1,
          },
          {
            id: 'sentence-q1:blank-2',
            blockId: 'sentence-block',
            groupId: 'part-4',
            groupLabel: 'Part 4',
            isMulti: false,
            correctCount: 1,
            answerKey: 'sentence-q1',
            answerIndex: 1,
            block: {
              id: 'sentence-block',
              type: 'SENTENCE_COMPLETION',
              instruction: '',
              questions: [],
            } as any,
            question: {
              id: 'sentence-q1',
              sentence: 'Poisons from ____ or ____ are commonly consumed.',
              answerRule: 'TWO_WORDS',
              blanks: [
                {
                  id: 'blank-1',
                  correctAnswer: '',
                  position: 0,
                  scoreGroupId: 'sentence-q1',
                  scoreWeight: 1,
                  groupRule: 'at_least_n',
                  requiredCorrect: 2,
                },
                {
                  id: 'blank-2',
                  correctAnswer: '',
                  position: 1,
                  scoreGroupId: 'sentence-q1',
                  scoreWeight: 0,
                  groupRule: 'at_least_n',
                  requiredCorrect: 2,
                },
              ],
            } as any,
            rootId: 'sentence-block::sentence::sentence-q1::group::sentence-q1',
            rootNumber: 1,
          },
        ]}
        currentQuestionId="sentence-q1:blank-2"
        onNavigate={onNavigate}
        answers={{}}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '1' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '1' }));
    expect(onNavigate).toHaveBeenCalledWith('sentence-q1:blank-1');
  });
});
