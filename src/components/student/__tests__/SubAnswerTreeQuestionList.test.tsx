import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';
import { SubAnswerTreeQuestionList } from '../SubAnswerTreeQuestionList';

function buildTreeDescriptor(overrides: Partial<StudentQuestionDescriptor> = {}): StudentQuestionDescriptor {
  return {
    id: 'tree-block::tree::root-a::leaf-a',
    blockId: 'tree-block',
    groupId: 'p1',
    groupLabel: 'Passage 1',
    rootId: 'tree-block::tree::root::root-a',
    rootNumber: 1,
    numberLabel: '1.1',
    isMulti: false,
    correctCount: 1,
    answerKey: 'tree-block::tree::root-a::leaf-a',
    isSubAnswerTreeLeaf: true,
    treeRequired: true,
    treePrompt: 'Leaf prompt',
    treeAcceptedAnswers: ['cat'],
    block: {
      id: 'tree-block',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [],
    } as any,
    question: null,
    ...overrides,
  };
}

describe('SubAnswerTreeQuestionList', () => {
  it('renders prompt above the number/input row when prompt is present', () => {
    const question = buildTreeDescriptor({ treePrompt: 'Top prompt text' });

    render(
      <SubAnswerTreeQuestionList
        questions={[question]}
        answers={{ [question.id]: '' }}
        currentQuestionId={question.id}
        onAnswerChange={vi.fn()}
      />, 
    );

    expect(screen.getByText('Top prompt text')).toBeInTheDocument();
    expect(screen.getByText('1.1')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 1.1' })).toBeInTheDocument();
  });

  it('renders no prompt text when prompt is blank', () => {
    const question = buildTreeDescriptor({ treePrompt: '   ' });
    const { container } = render(
      <SubAnswerTreeQuestionList
        questions={[question]}
        answers={{ [question.id]: '' }}
        currentQuestionId={question.id}
        onAnswerChange={vi.fn()}
      />,
    );

    const promptParagraph = container.querySelector('p.text-sm.text-gray-800');
    expect(promptParagraph).toBeNull();
    expect(screen.getByText('1.1')).toBeInTheDocument();
  });

  it('shows root number when a root has only one leaf', () => {
    const question = buildTreeDescriptor({
      rootNumber: 21,
      numberLabel: '21.1',
      rootLeafQuestionIds: ['tree-block::tree::root-a::leaf-a'],
    });

    render(
      <SubAnswerTreeQuestionList
        questions={[question]}
        answers={{ [question.id]: '' }}
        currentQuestionId={question.id}
        onAnswerChange={vi.fn()}
      />,
    );

    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.queryByText('21.1')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Answer for question 21' })).toBeInTheDocument();
  });
});
