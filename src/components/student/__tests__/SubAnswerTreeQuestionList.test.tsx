import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';
import { SubAnswerTreeQuestionList } from '../SubAnswerTreeQuestionList';

vi.mock('../FormattedText', () => ({
  FormattedText: ({
    text,
    highlightEnabled,
    highlightColor,
    highlightSurfaceId,
  }: {
    text: string;
    highlightEnabled?: boolean;
    highlightColor?: string;
    highlightSurfaceId?: string;
  }) => (
    <span
      data-highlight-enabled={String(Boolean(highlightEnabled))}
      data-highlight-color={highlightColor}
      data-highlight-surface-id={highlightSurfaceId}
    >
      {text}
    </span>
  ),
}));

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
        highlightEnabled
        highlightColor="purple"
        onAnswerChange={vi.fn()}
      />, 
    );

    const prompt = screen.getByText('Top prompt text');
    expect(prompt).toBeInTheDocument();
    expect(prompt).toHaveAttribute('data-highlight-enabled', 'true');
    expect(prompt).toHaveAttribute('data-highlight-color', 'purple');
    expect(prompt).toHaveAttribute(
      'data-highlight-surface-id',
      'question:tree-block:tree-block::tree::root::root-a:root-prompt',
    );
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 1' })).toBeInTheDocument();
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

    const promptParagraph = container.querySelector('p.text-gray-800');
    expect(promptParagraph).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Answer for question 1' })).toBeInTheDocument();
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

  it('keeps root header and adds dotted labels for multiple leaves under same question', () => {
    const leafOne = buildTreeDescriptor({
      id: 'tree-block::tree::root-a::leaf-a',
      rootId: 'tree-block::tree::root::root-a',
      rootNumber: 31,
      numberLabel: '31.1',
      treePrompt: 'Turtles were among the first group.',
      rootLeafQuestionIds: ['tree-block::tree::root-a::leaf-a', 'tree-block::tree::root-a::leaf-b'],
    });
    const leafTwo = buildTreeDescriptor({
      id: 'tree-block::tree::root-a::leaf-b',
      rootId: 'tree-block::tree::root::root-a',
      rootNumber: 31,
      numberLabel: '31.2',
      treePrompt: 'Turtles were among the first group.',
      rootLeafQuestionIds: ['tree-block::tree::root-a::leaf-a', 'tree-block::tree::root-a::leaf-b'],
    });

    render(
      <SubAnswerTreeQuestionList
        questions={[leafOne, leafTwo]}
        answers={{ [leafOne.id]: '', [leafTwo.id]: '' }}
        currentQuestionId={leafOne.id}
        onAnswerChange={vi.fn()}
      />,
    );

    expect(screen.getByText('31')).toBeInTheDocument();
    expect(screen.getByText('31.1')).toBeInTheDocument();
    expect(screen.getByText('31.2')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 31.1' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Answer for question 31.2' })).toBeInTheDocument();
  });

  it('keeps the leaf flag button from compressing as text wraps (P3.2.2)', () => {
    const leafOne = buildTreeDescriptor({
      id: 'tree-block::tree::root-a::leaf-a',
      rootId: 'tree-block::tree::root::root-a',
      rootNumber: 41,
      numberLabel: '41.1',
      treePrompt: 'Long leaf prompt that wraps',
      rootLeafQuestionIds: ['tree-block::tree::root-a::leaf-a', 'tree-block::tree::root-a::leaf-b'],
    });
    const leafTwo = buildTreeDescriptor({
      id: 'tree-block::tree::root-a::leaf-b',
      rootId: 'tree-block::tree::root::root-a',
      rootNumber: 41,
      numberLabel: '41.2',
      treePrompt: 'Long leaf prompt that wraps',
      rootLeafQuestionIds: ['tree-block::tree::root-a::leaf-a', 'tree-block::tree::root-a::leaf-b'],
    });

    const { container } = render(
      <SubAnswerTreeQuestionList
        questions={[leafOne, leafTwo]}
        answers={{ [leafOne.id]: '', [leafTwo.id]: '' }}
        currentQuestionId={leafOne.id}
        flags={{ [leafTwo.id]: true }}
        onToggleFlag={vi.fn()}
        onAnswerChange={vi.fn()}
      />,
    );

    const flagButton = container.querySelector('button[aria-label="Unflag question"]');
    expect(flagButton).not.toBeNull();
    expect(flagButton).toHaveClass('flex-shrink-0');
  });

  it('activates a leaf the student starts working in (P4)', () => {
    const leafOne = buildTreeDescriptor({
      id: 'tree-block::tree::root-a::leaf-a',
      rootNumber: 51,
      numberLabel: '51.1',
      rootLeafQuestionIds: ['tree-block::tree::root-a::leaf-a', 'tree-block::tree::root-a::leaf-b'],
    });
    const leafTwo = buildTreeDescriptor({
      id: 'tree-block::tree::root-a::leaf-b',
      rootNumber: 51,
      numberLabel: '51.2',
      rootLeafQuestionIds: ['tree-block::tree::root-a::leaf-a', 'tree-block::tree::root-a::leaf-b'],
    });
    const onActivate = vi.fn();

    render(
      <SubAnswerTreeQuestionList
        questions={[leafOne, leafTwo]}
        answers={{ [leafOne.id]: '', [leafTwo.id]: '' }}
        currentQuestionId={leafOne.id}
        onActivate={onActivate}
        onAnswerChange={vi.fn()}
      />,
    );

    // Focusing a leaf's input is the same "I am working here" signal as
    // clicking it, so the single global navigator follows the student.
    fireEvent.focus(screen.getByRole('textbox', { name: 'Answer for question 51.2' }));
    expect(onActivate).toHaveBeenCalledWith(leafTwo.id);

    // The already-active leaf does not re-announce itself.
    onActivate.mockClear();
    fireEvent.focus(screen.getByRole('textbox', { name: 'Answer for question 51.1' }));
    expect(onActivate).not.toHaveBeenCalled();
  });
});
