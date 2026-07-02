import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClozeBlock } from '../ClozeBlock';
import { MapLabelingBlock } from '../MapLabelingBlock';
import { MatchingBlock } from '../MatchingBlock';
import { MultiSelectMCQBlock } from '../MultiSelectMCQBlock';
import { TFNGBlock } from '../TFNGBlock';

type EditorCase = {
  Component: React.ComponentType<any>;
  block: any;
  endNum: number;
  instruction: string;
  name: string;
};

const editorCases: EditorCase[] = [
  {
    name: 'TFNG',
    Component: TFNGBlock,
    endNum: 1,
    instruction: 'Unique TFNG instruction',
    block: {
      id: 'tfng-1',
      type: 'TFNG',
      mode: 'TFNG',
      instruction: 'Unique TFNG instruction',
      questions: [{ id: 'tfng-q1', statement: 'Statement', correctAnswer: 'T' }],
    },
  },
  {
    name: 'Cloze',
    Component: ClozeBlock,
    endNum: 1,
    instruction: 'Unique cloze instruction',
    block: {
      id: 'cloze-1',
      type: 'CLOZE',
      answerRule: 'TWO_WORDS',
      instruction: 'Unique cloze instruction',
      questions: [{ id: 'cloze-q1', prompt: 'The ____ matters.', correctAnswer: 'answer', acceptedAnswers: ['answer'] }],
    },
  },
  {
    name: 'Matching',
    Component: MatchingBlock,
    endNum: 1,
    instruction: 'Unique matching instruction',
    block: {
      id: 'matching-1',
      type: 'MATCHING',
      instruction: 'Unique matching instruction',
      headings: [{ id: 'heading-1', text: 'Heading one' }],
      questions: [{ id: 'matching-q1', paragraphLabel: 'A', correctHeading: 'i' }],
    },
  },
  {
    name: 'Map labeling',
    Component: MapLabelingBlock,
    endNum: 1,
    instruction: 'Unique map instruction',
    block: {
      id: 'map-1',
      type: 'MAP',
      instruction: 'Unique map instruction',
      assetUrl: '',
      questions: [{ id: 'map-q1', label: 'Location A', correctAnswer: 'A', x: 50, y: 50 }],
    },
  },
  {
    name: 'Multi-select MCQ',
    Component: MultiSelectMCQBlock,
    endNum: 2,
    instruction: 'Unique multi-select instruction',
    block: {
      id: 'multi-1',
      type: 'MULTI_MCQ',
      instruction: 'Unique multi-select instruction',
      stem: 'Choose two options.',
      requiredSelections: 2,
      options: [
        { id: 'multi-a', text: 'A', isCorrect: true },
        { id: 'multi-b', text: 'B', isCorrect: true },
        { id: 'multi-c', text: 'C', isCorrect: false },
      ],
    },
  },
];

describe('block instruction fields', () => {
  it.each(editorCases)('$name uses a multiline instruction editor', ({ Component, block, endNum, instruction }) => {
    render(
      <Component
        block={block}
        startNum={1}
        endNum={endNum}
        updateBlock={vi.fn()}
        deleteBlock={vi.fn()}
        moveBlock={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue(instruction).tagName).toBe('TEXTAREA');
  });

  it.each(editorCases)('$name preserves newlines in instruction edits', ({ Component, block, endNum, instruction }) => {
    const updateBlock = vi.fn();
    render(
      <Component
        block={block}
        startNum={1}
        endNum={endNum}
        updateBlock={updateBlock}
        deleteBlock={vi.fn()}
        moveBlock={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByDisplayValue(instruction), {
      target: { value: 'Line one\nLine two' },
    });

    expect(updateBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: 'Line one\nLine two',
      }),
    );
  });
});
