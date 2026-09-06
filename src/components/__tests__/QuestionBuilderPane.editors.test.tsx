import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionBuilderPane } from '../QuestionBuilderPane';

// Per-type editor coverage for QuestionBuilderPane's renderBlock switch:
// each block type renders its real editor with minimal props
// (blocks + title + updateBlocks stub), plus add/remove interactions
// and the role="group" selection-wrapper invariant.

function makeTfngBlock(id = 'blk-tfng'): any {
  return {
    id,
    type: 'TFNG',
    mode: 'TFNG',
    instruction: 'Do the following statements agree with the information given?',
    questions: [{ id: `${id}-q1`, statement: 'The sky is blue.', correctAnswer: 'T' }],
  };
}

function makeSingleMcqBlock(id = 'blk-single'): any {
  const options = [
    { id: `${id}-opt-a`, text: 'Option A', isCorrect: true },
    { id: `${id}-opt-b`, text: 'Option B', isCorrect: false },
    { id: `${id}-opt-c`, text: 'Option C', isCorrect: false },
  ];
  return {
    id,
    type: 'SINGLE_MCQ',
    instruction: 'Choose the correct answer.',
    stem: 'What is described?',
    options,
    questions: [{ id: `${id}-q1`, stem: 'What is described?', options }],
  };
}

function makeTableCompletionBlock(id = 'blk-table'): any {
  return {
    id,
    type: 'TABLE_COMPLETION',
    instruction: 'Complete the table below.',
    answerRule: 'TWO_WORDS',
    headers: ['Column 1', 'Column 2'],
    rows: [['Topic ____', 'Plain text']],
    cells: [{ id: `${id}-cell-1`, correctAnswer: '', acceptedAnswers: [], row: 0, col: 0 }],
  };
}

function makeShortAnswerBlock(id = 'blk-short'): any {
  return {
    id,
    type: 'SHORT_ANSWER',
    instruction: 'Answer the questions below.',
    questions: [
      {
        id: `${id}-q1`,
        prompt: 'What is described?',
        correctAnswer: '',
        acceptedAnswers: [],
        answerRule: 'TWO_WORDS',
      },
    ],
  };
}

describe('QuestionBuilderPane block editors', () => {
  it('renders the TFNG block editor', () => {
    render(<QuestionBuilderPane title="Reading" blocks={[makeTfngBlock()]} updateBlocks={vi.fn()} />);

    expect(screen.getByText('Questions 1-1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type statement...')).toHaveValue('The sky is blue.');
    expect(
      screen.getByRole('group', { name: /question block 1 to 1/i }),
    ).toBeInTheDocument();
  });

  it('renders the SINGLE_MCQ block editor', () => {
    render(<QuestionBuilderPane title="Reading" blocks={[makeSingleMcqBlock()]} updateBlocks={vi.fn()} />);

    expect(screen.getByText('Single Choice MCQ')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter the question stem...')).toHaveValue('What is described?');
    expect(
      screen.getByRole('group', { name: /question block 1 to 1/i }),
    ).toBeInTheDocument();
  });

  it('renders the TABLE_COMPLETION block editor', () => {
    render(
      <QuestionBuilderPane title="Reading" blocks={[makeTableCompletionBlock()]} updateBlocks={vi.fn()} />,
    );

    expect(screen.getByText('Table Completion')).toBeInTheDocument();
    expect(screen.getByLabelText('Table instruction')).toHaveValue('Complete the table below.');
    expect(screen.getByPlaceholderText('Primary answer...')).toBeInTheDocument();
    expect(screen.getByText(/blank answers \(1\)/i)).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: /question block 1 to 1/i }),
    ).toBeInTheDocument();
  });

  it('renders the SHORT_ANSWER block editor', () => {
    render(<QuestionBuilderPane title="Reading" blocks={[makeShortAnswerBlock()]} updateBlocks={vi.fn()} />);

    expect(screen.getByText('Short Answer')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter the question prompt...')).toHaveValue('What is described?');
    expect(
      screen.getByRole('group', { name: /question block 1 to 1/i }),
    ).toBeInTheDocument();
  });

  it('adds a block through the Add Question Block dialog', async () => {
    function AddHarness() {
      const [blocks, setBlocks] = useState<any[]>([]);
      return (
        <>
          <QuestionBuilderPane title="Reading" blocks={blocks} updateBlocks={setBlocks as any} />
          <div data-testid="block-count">{blocks.length}</div>
        </>
      );
    }

    render(<AddHarness />);
    expect(screen.getByTestId('block-count')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: 'Add Question Block' }));
    fireEvent.click(screen.getByRole('button', { name: /single choice mcq/i }));

    await waitFor(() => {
      expect(screen.getByTestId('block-count')).toHaveTextContent('1');
    });
    expect(screen.getByText('Single Choice MCQ')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /add question block/i })).toBeNull();
  });

  it('removes a block through the two-step confirm flow', async () => {
    function RemoveHarness() {
      const [blocks, setBlocks] = useState<any[]>([makeShortAnswerBlock()]);
      return (
        <>
          <QuestionBuilderPane title="Reading" blocks={blocks} updateBlocks={setBlocks as any} />
          <div data-testid="block-count">{blocks.length}</div>
        </>
      );
    }

    render(<RemoveHarness />);
    expect(screen.getByText('Short Answer')).toBeInTheDocument();

    // Requesting delete opens the confirm modal; the block is kept.
    fireEvent.click(screen.getByTitle('Delete block'));
    const confirmDialog = screen.getByRole('dialog', { name: /delete question block/i });
    expect(confirmDialog).toHaveTextContent(/questions 1-1/i);
    expect(screen.getByText('Short Answer')).toBeInTheDocument();

    // Confirm removes the block.
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /^delete block$/i }));
    await waitFor(() => {
      expect(screen.queryByText('Short Answer')).toBeNull();
    });
    expect(screen.getByTestId('block-count')).toHaveTextContent('0');
  });

  it('wraps every block in a role=group container with no nested-button violation', () => {
    render(
      <QuestionBuilderPane
        title="Reading"
        blocks={[makeTfngBlock('blk-tfng'), makeSingleMcqBlock('blk-single'), makeTableCompletionBlock('blk-table'), makeShortAnswerBlock('blk-short')]}
        updateBlocks={vi.fn()}
      />,
    );

    // All four editors render side by side.
    expect(screen.getByText('Questions 1-1')).toBeInTheDocument();
    expect(screen.getByText('Single Choice MCQ')).toBeInTheDocument();
    expect(screen.getByText('Table Completion')).toBeInTheDocument();
    expect(screen.getByText('Short Answer')).toBeInTheDocument();

    const groups = screen.getAllByRole('group', { name: /question block \d+ to \d+/i });
    expect(groups).toHaveLength(4);
    for (const group of groups) {
      // Selection wrapper is a plain container, never a <button> and never
      // nested inside one, so inner editor buttons stay valid HTML/a11y.
      expect(group.tagName).toBe('DIV');
      expect(group.closest('button')).toBeNull();
      // Each group legitimately contains widgets (buttons/inputs).
      expect(within(group).getAllByRole('button').length).toBeGreaterThan(0);
    }
  });
});
