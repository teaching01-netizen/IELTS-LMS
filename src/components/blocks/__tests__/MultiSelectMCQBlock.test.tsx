import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MultiMCQBlock as MultiMCQBlockType } from '../../../types';
import { MultiSelectMCQBlock } from '../MultiSelectMCQBlock';

function Harness({ initialBlock }: { initialBlock: MultiMCQBlockType }) {
  const [block, setBlock] = useState(initialBlock);

  return (
    <MultiSelectMCQBlock
      block={block}
      startNum={4}
      endNum={4}
      updateBlock={setBlock}
      deleteBlock={() => {}}
      moveBlock={() => {}}
      errors={[]}
    />
  );
}

const buildBlock = (): MultiMCQBlockType => ({
  id: 'multi-1',
  type: 'MULTI_MCQ',
  instruction: 'Choose all that apply.',
  stem: 'Pick the correct options.',
  requiredSelections: 4,
  options: [
    { id: 'a', text: 'Alpha', isCorrect: true },
    { id: 'b', text: 'Beta', isCorrect: false },
  ],
});

describe('MultiSelectMCQBlock', () => {
  it('derives the count from marked options and removes the Required Correct control', () => {
    render(<Harness initialBlock={buildBlock()} />);

    expect(screen.queryByText(/required correct/i)).not.toBeInTheDocument();
    expect(screen.getByText('1 correct option configured')).toBeInTheDocument();
  });

  it('keeps the final correct option marked and prevents deleting it', () => {
    render(<Harness initialBlock={buildBlock()} />);

    const correctness = screen.getAllByRole('checkbox');
    expect(correctness[0]).toBeDisabled();
    fireEvent.click(correctness[0]!);
    expect(correctness[0]).toBeChecked();

    const removeFinalCorrect = screen.getByRole('button', { name: /remove option alpha/i });
    expect(removeFinalCorrect).toBeDisabled();
    fireEvent.click(removeFinalCorrect);
    expect(screen.getByDisplayValue('Alpha')).toBeInTheDocument();
  });
});
