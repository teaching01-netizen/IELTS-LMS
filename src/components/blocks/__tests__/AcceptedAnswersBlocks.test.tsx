import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  SentenceCompletionBlock as SentenceCompletionBlockType,
  ShortAnswerBlock as ShortAnswerBlockType,
} from '../../../types';
import { SentenceCompletionBlock } from '../SentenceCompletionBlock';
import { ShortAnswerBlock } from '../ShortAnswerBlock';

describe('accepted answer chips in block editors', () => {
  it('keeps short-answer primary correctAnswer synced with acceptedAnswers', () => {
    const initialBlock: ShortAnswerBlockType = {
      id: 'short-1',
      type: 'SHORT_ANSWER',
      instruction: 'Answer the question',
      questions: [
        {
          id: 'q-1',
          prompt: 'Name one pet',
          correctAnswer: 'dog',
          acceptedAnswers: ['dog'],
          answerRule: 'ONE_WORD',
        },
      ],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <ShortAnswerBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText('Enter the accepted answer...');
    fireEvent.change(input, { target: { value: 'cat' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(latestBlock.questions[0]?.acceptedAnswers).toEqual(['dog', 'cat']);
    expect(latestBlock.questions[0]?.correctAnswer).toBe('dog');

    fireEvent.click(screen.getByLabelText('Remove accepted answer dog'));

    expect(latestBlock.questions[0]?.acceptedAnswers).toEqual(['cat']);
    expect(latestBlock.questions[0]?.correctAnswer).toBe('cat');
  });

  it('syncs sentence blank primary correctAnswer from acceptedAnswers chips', () => {
    const initialBlock: SentenceCompletionBlockType = {
      id: 'sentence-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentence',
      questions: [
        {
          id: 'q-1',
          sentence: 'Bring your ____.',
          blanks: [{ id: 'blank-1', correctAnswer: '', acceptedAnswers: [], position: 0 }],
          answerRule: 'ONE_WORD',
        },
      ],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <SentenceCompletionBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText('Answer...');
    fireEvent.change(input, { target: { value: 'ticket' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(latestBlock.questions[0]?.blanks[0]?.acceptedAnswers).toEqual(['ticket']);
    expect(latestBlock.questions[0]?.blanks[0]?.correctAnswer).toBe('ticket');
  });
});
