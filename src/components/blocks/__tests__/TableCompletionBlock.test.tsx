import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TableCompletionBlock as TableCompletionBlockType } from '../../../types';
import { TableCompletionBlock } from '../TableCompletionBlock';

describe('TableCompletionBlock', () => {
  it('updates only the edited blank when legacy duplicate cell IDs exist', () => {
    const initialBlock: TableCompletionBlockType = {
      id: 'table-1',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table',
      answerRule: 'ONE_WORD',
      insertedImages: [],
      headers: ['A', 'B', 'C'],
      rows: [['____', '', '____']],
      cells: [
        { id: 'dup-id', row: 0, col: 0, correctAnswer: 'left', acceptedAnswers: ['left'] },
        { id: 'dup-id', row: 0, col: 2, correctAnswer: 'right', acceptedAnswers: ['right'] },
      ],
    };

    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <TableCompletionBlock
          block={block}
          startNum={1}
          endNum={2}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
          errors={[]}
        />
      );
    }

    render(<Harness />);

    const inputs = screen.getAllByPlaceholderText('Primary answer...');
    expect(inputs).toHaveLength(2);

    fireEvent.change(inputs[0], { target: { value: 'edited-left' } });

    expect(latestBlock.cells[0]?.correctAnswer).toBe('edited-left');
    expect(latestBlock.cells[1]?.correctAnswer).toBe('right');
  });
});
