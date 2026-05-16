import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClozeBlock as ClozeBlockType, QuestionBlock } from '../../../types';
import { ClozeBlock } from '../ClozeBlock';

describe('ClozeBlock answerRule auto-upgrade', () => {
  it('upgrades answerRule when any accepted answer variant contains multiple words', () => {
    const initialBlock: ClozeBlockType = {
      id: 'cloze-1',
      type: 'CLOZE',
      instruction: 'Complete the summary',
      answerRule: 'ONE_WORD',
      insertedImages: [],
      questions: [{ id: 'q-1', prompt: 'The ____ is noisy.', correctAnswer: 'crowd', acceptedAnswers: [] }],
      subAnswerModeEnabled: false,
      answerTree: [],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState<QuestionBlock>(initialBlock);
      latestBlock = block as ClozeBlockType;
      return (
        <ClozeBlock
          block={block}
          startNum={1}
          endNum={1}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
          errors={[]}
        />
      );
    }

    render(<Harness />);

    const input = screen.getByPlaceholderText('e.g., factories');
    fireEvent.change(input, { target: { value: 'crowd noise' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(latestBlock.answerRule).toBe('TWO_WORDS');
  });
});

