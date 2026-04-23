import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { QuestionBuilderPane } from '../QuestionBuilderPane';

vi.mock('../blocks/TFNGBlock', () => ({
  TFNGBlock: ({ block, deleteBlock }: any) => (
    <div data-testid="tfng-block">
      <span data-testid="tfng-count">{block.questions.length}</span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          deleteBlock(block.id);
        }}
      >
        Delete block
      </button>
    </div>
  ),
}));

vi.mock('../blocks/MapLabelingBlock', () => ({
  MapLabelingBlock: () => <div data-testid="map-block" />,
}));

describe('QuestionBuilderPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows inline add question controls for supported block types', () => {
    render(
      <QuestionBuilderPane
        title="Reading"
        blocks={[
          {
            id: 'block-1',
            type: 'TFNG',
            mode: 'TFNG',
            instruction: 'Read and answer',
            questions: [{ id: 'q-1', statement: 'Statement', correctAnswer: 'T' }],
          } as any,
        ]}
        updateBlocks={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /^add question$/i })).toBeTruthy();
  });

  it('hides inline add question controls for unsupported block types', () => {
    render(
      <QuestionBuilderPane
        title="Reading"
        blocks={[
          {
            id: 'block-1',
            type: 'MAP',
            instruction: 'Label the map',
            questions: [{ id: 'q-1', label: 'A', correctAnswer: '', x: 50, y: 50 }],
          } as any,
        ]}
        updateBlocks={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /^add question$/i })).toBeNull();
  });

  it('keeps rapid add-question clicks in sync with the latest block state', async () => {
    function Harness() {
      const [blocks, setBlocks] = useState([
        {
          id: 'block-1',
          type: 'TFNG',
          mode: 'TFNG',
          instruction: 'Read and answer',
          questions: [{ id: 'q-1', statement: 'Statement', correctAnswer: 'T' }],
        } as any,
      ]);

      return <QuestionBuilderPane title="Reading" blocks={blocks} updateBlocks={setBlocks} />;
    }

    render(<Harness />);

    const addQuestionButton = screen.getByRole('button', { name: /^add question$/i });

    await act(async () => {
      fireEvent.click(addQuestionButton);
      fireEvent.click(addQuestionButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId('tfng-count')).toHaveTextContent('3');
    });
  });

  it('clears a deleted selection before saving a block to the bank', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    function Harness() {
      const [blocks, setBlocks] = useState([
        {
          id: 'block-1',
          type: 'TFNG',
          mode: 'TFNG',
          instruction: 'Read and answer',
          questions: [{ id: 'q-1', statement: 'Statement', correctAnswer: 'T' }],
        } as any,
      ]);

      return <QuestionBuilderPane title="Reading" blocks={blocks} updateBlocks={setBlocks} />;
    }

    render(<Harness />);

    fireEvent.click(screen.getByTestId('tfng-block'));
    fireEvent.click(screen.getByRole('button', { name: /delete block/i }));
    fireEvent.click(screen.getByRole('button', { name: /save to bank/i }));

    expect(alertSpy).toHaveBeenCalledWith('Please select a question block first by clicking on it.');
    alertSpy.mockRestore();
  });
});
