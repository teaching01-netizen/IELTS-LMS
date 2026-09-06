import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

    expect(screen.getByRole('button', { name: /^add question to block/i })).toBeTruthy();
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

    expect(screen.queryByRole('button', { name: /^add question to block/i })).toBeNull();
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

    const addQuestionButton = screen.getByRole('button', { name: /^add question to block/i });

    await act(async () => {
      fireEvent.click(addQuestionButton);
      fireEvent.click(addQuestionButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId('tfng-count')).toHaveTextContent('3');
    });
  });

  it('does not render pane-inline add question for SINGLE_MCQ blocks', () => {
    render(
      <QuestionBuilderPane
        title="Reading"
        blocks={[
          {
            id: 'single-block-1',
            type: 'SINGLE_MCQ',
            instruction: 'Choose one answer.',
            stem: 'Question',
            options: [
              { id: 'opt-a', text: 'A', isCorrect: true },
              { id: 'opt-b', text: 'B', isCorrect: false },
            ],
            questions: [
              {
                id: 'single-q1',
                stem: 'Question 1',
                options: [
                  { id: 'q1-a', text: 'A', isCorrect: true },
                  { id: 'q1-b', text: 'B', isCorrect: false },
                ],
              },
            ],
          } as any,
        ]}
        updateBlocks={vi.fn()}
      />,
    );

    // SINGLE_MCQ uses block-local add controls only (see SingleMCQBlock.test.tsx);
    // the generic pane-inline add is hidden for it.
    expect(screen.queryByRole('button', { name: /^add question to block/i })).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: /^delete block$/i }));

    // C7: delete is a two-step confirm flow — modal opens, block kept until confirmed.
    const confirmDialog = screen.getByRole('dialog', { name: /delete question block/i });
    expect(screen.getByTestId('tfng-block')).toBeInTheDocument();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /^delete block$/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('tfng-block')).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: /save to bank/i }));

    expect(alertSpy).toHaveBeenCalledWith('Please select a question block first by clicking on it.');
    alertSpy.mockRestore();
  });

  it('requires confirmation before deleting a question block', async () => {
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

    // Requesting delete opens the confirm modal; the block is kept.
    fireEvent.click(screen.getByRole('button', { name: /^delete block$/i }));
    const confirmDialog = screen.getByRole('dialog', { name: /delete question block/i });
    expect(confirmDialog).toHaveTextContent(/questions 1-1/i);
    expect(screen.getByTestId('tfng-block')).toBeInTheDocument();

    // Cancel keeps the block and closes the modal.
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /delete question block/i })).toBeNull();
    });
    expect(screen.getByTestId('tfng-block')).toBeInTheDocument();

    // Confirm removes the block.
    fireEvent.click(screen.getByRole('button', { name: /^delete block$/i }));
    const reopenedDialog = screen.getByRole('dialog', { name: /delete question block/i });
    fireEvent.click(within(reopenedDialog).getByRole('button', { name: /^delete block$/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('tfng-block')).toBeNull();
    });
  });

  it('keeps full legacy question range visible after adding a question', async () => {
    function Harness() {
      const [blocks, setBlocks] = useState([
        {
          id: 'block-cloze',
          type: 'CLOZE',
          instruction: 'Answer questions 14-19',
          answerRule: 'TWO_WORDS',
          questions: [
            { id: 'q-18', prompt: 'Q18', correctAnswer: 'a' },
            { id: 'q-19', prompt: 'Q19', correctAnswer: 'b' },
            { id: 'q-20', prompt: 'Q20', correctAnswer: 'c' },
            { id: 'q-21', prompt: 'Q21', correctAnswer: 'd' },
            { id: 'q-22', prompt: 'Q22', correctAnswer: 'e' },
            { id: 'q-23', prompt: 'Q23', correctAnswer: 'f' },
          ],
          subAnswerModeEnabled: true,
          answerTree: [
            {
              id: 'root-18',
              children: [{ id: 'leaf-18', label: 'Leaf 18', acceptedAnswers: ['a'], required: true }],
            },
          ],
        } as any,
      ]);

      return <QuestionBuilderPane title="Reading" blocks={blocks} updateBlocks={setBlocks} startNumber={18} />;
    }

    render(<Harness />);

    const inlineAddButton = screen.getByRole('button', { name: /^add question to block/i });
    fireEvent.click(inlineAddButton);

    await waitFor(() => {
      expect(screen.getByText('Questions 18-24')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Q19')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Q23')).toBeInTheDocument();
    });
  });

  it('clears sub-answer fields from selected block via toolbar control', async () => {
    function Harness() {
      const [blocks, setBlocks] = useState([
        {
          id: 'block-1',
          type: 'TFNG',
          mode: 'TFNG',
          instruction: 'Read and answer',
          questions: [{ id: 'q-1', statement: 'Statement', correctAnswer: 'T' }],
          subAnswerModeEnabled: true,
          answerTree: [{ id: 'root-1', children: [{ id: 'leaf-1', acceptedAnswers: ['A'] }] }],
        } as any,
      ]);

      const selected = blocks[0] as any;
      const hasSubAnswer =
        Object.prototype.hasOwnProperty.call(selected, 'subAnswerModeEnabled') ||
        Object.prototype.hasOwnProperty.call(selected, 'answerTree');

      return (
        <>
          <QuestionBuilderPane title="Reading" blocks={blocks} updateBlocks={setBlocks} />
          <div data-testid="has-sub-answer">{String(hasSubAnswer)}</div>
        </>
      );
    }

    render(<Harness />);

    expect(screen.getByTestId('has-sub-answer')).toHaveTextContent('true');

    fireEvent.click(screen.getByTestId('tfng-block'));
    fireEvent.click(screen.getByRole('button', { name: /turn off sub-answer/i }));

    await waitFor(() => {
      expect(screen.getByTestId('has-sub-answer')).toHaveTextContent('false');
    });
  });

});
