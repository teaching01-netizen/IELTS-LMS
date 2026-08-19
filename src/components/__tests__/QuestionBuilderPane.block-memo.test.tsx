import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionBuilderPane } from '../QuestionBuilderPane';

const renderCounts: Record<string, number> = {};

vi.mock('../blocks/TFNGBlock', () => ({
  TFNGBlock: React.memo(
    (props: {
      block: { id: string; questions: Array<{ id: string }> };
      updateBlock: (block: any) => void;
    }) => {
      renderCounts[props.block.id] = (renderCounts[props.block.id] ?? 0) + 1;
      return (
        <div data-testid={`tfng-${props.block.id}`}>
          <button
            type="button"
            onClick={() =>
              props.updateBlock({
                ...props.block,
                questions: props.block.questions.map((q) => ({ ...q, statement: 'Edited' })),
              })
            }
          >
            Edit question
          </button>
        </div>
      );
    },
  ),
}));

function createTfngBlock(id: string) {
  return {
    id,
    type: 'TFNG',
    mode: 'TFNG',
    instruction: 'Read and answer',
    questions: [{ id: `${id}-q1`, statement: 'Statement', correctAnswer: 'T' }],
  } as const;
}

describe('QuestionBuilderPane block memo boundaries', () => {
  it('does not re-render sibling blocks when another block changes', () => {
    function Harness() {
      const [blocks, setBlocks] = useState([createTfngBlock('block-a'), createTfngBlock('block-b')]);
      return <QuestionBuilderPane title="Reading" blocks={blocks as any} updateBlocks={setBlocks as any} />;
    }

    render(<Harness />);
    renderCounts['block-a'] = 0;
    renderCounts['block-b'] = 0;

    fireEvent.click(screen.getByTestId('tfng-block-a').querySelector('button') as HTMLElement);

    expect(screen.getByTestId('tfng-block-a')).toBeTruthy();
    expect(renderCounts['block-b']).toBe(0);
  });
});