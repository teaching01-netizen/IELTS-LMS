import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QuestionBankItem, TableCompletionBlock } from '../../../types';
import { getCanonicalTableCells } from '../../../utils/tableCompletion';
import { QuestionDetailModal } from '../QuestionDetailModal';

function baseMetadata() {
  return {
    id: 'meta-1',
    difficulty: 'medium' as const,
    topic: 'Reading',
    tags: ['tag1'],
    usageCount: 2,
    createdAt: '2024-01-15T00:00:00.000Z',
    author: 'Test Author',
  };
}

function makeTFNGItem(): QuestionBankItem {
  return {
    id: 'item-tfng',
    metadata: baseMetadata(),
    block: {
      id: 'block-tfng',
      type: 'TFNG',
      instruction: 'Do the following statements agree?',
      mode: 'TFNG',
      questions: [
        { id: 'q1', statement: 'The sky is blue', correctAnswer: 'T' },
        { id: 'q2', statement: 'Fish can fly to the moon', correctAnswer: 'F' },
      ],
    },
  };
}

function makeSingleMCQItem(): QuestionBankItem {
  return {
    id: 'item-mcq',
    metadata: baseMetadata(),
    block: {
      id: 'block-mcq',
      type: 'SINGLE_MCQ',
      instruction: 'Choose the correct answer',
      stem: 'What is 2 + 2?',
      options: [
        { id: 'o1', text: 'Three', isCorrect: false },
        { id: 'o2', text: 'Four', isCorrect: true },
      ],
    },
  };
}

function makeTableItem(): QuestionBankItem {
  return {
    id: 'item-table',
    metadata: baseMetadata(),
    block: {
      id: 'block-table',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table below',
      headers: ['Name', 'Value'],
      rows: [['Alpha', '____']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: '42' }],
      answerRule: 'ONE_WORD',
    },
  };
}

function makeShortAnswerItem(): QuestionBankItem {
  return {
    id: 'item-short',
    metadata: baseMetadata(),
    block: {
      id: 'block-short',
      type: 'SHORT_ANSWER',
      instruction: 'Answer the questions below',
      questions: [
        {
          id: 'q1',
          prompt: 'What is the capital of France?',
          correctAnswer: 'Paris',
          acceptedAnswers: ['Paris'],
          answerRule: 'ONE_WORD',
        },
      ],
    },
  };
}

function renderOpen(item: QuestionBankItem, overrides?: Partial<React.ComponentProps<typeof QuestionDetailModal>>) {
  const onClose = vi.fn();
  const onAddToExam = vi.fn();
  render(<QuestionDetailModal item={item} isOpen onClose={onClose} onAddToExam={onAddToExam} {...overrides} />);
  return { onClose, onAddToExam };
}

describe('QuestionDetailModal', () => {
  it('renders nothing when item is null', () => {
    const { container } = render(
      <QuestionDetailModal item={null} isOpen onClose={() => {}} onAddToExam={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <QuestionDetailModal item={makeTFNGItem()} isOpen={false} onClose={() => {}} onAddToExam={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders TFNG type label, difficulty and statements', () => {
    renderOpen(makeTFNGItem());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('True/False/Not Given')).toBeInTheDocument();
    expect(screen.getAllByText('medium').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/The sky is blue/)).toBeInTheDocument();
    expect(screen.getByText(/Fish can fly to the moon/)).toBeInTheDocument();
  });

  it('renders SINGLE_MCQ stem, options and correct marker', () => {
    renderOpen(makeSingleMCQItem());
    expect(screen.getByText('Multiple Choice (Single Answer)')).toBeInTheDocument();
    expect(screen.getByText(/What is 2 \+ 2\?/)).toBeInTheDocument();
    expect(screen.getByText('Three')).toBeInTheDocument();
    expect(screen.getByText('Four')).toBeInTheDocument();
    expect(screen.getByText(/Correct/)).toBeInTheDocument();
  });

  it('renders TABLE_COMPLETION headers and canonical cell answers', () => {
    const item = makeTableItem();
    const canonical = getCanonicalTableCells(item.block as TableCompletionBlock);
    expect(canonical.length).toBeGreaterThan(0);
    renderOpen(item);
    expect(screen.getByText('Table Completion')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Value')).toBeInTheDocument();
    for (const cell of canonical) {
      expect(screen.getByText(new RegExp(cell.correctAnswer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    }
  });

  it('renders SHORT_ANSWER prompt and answers', () => {
    renderOpen(makeShortAnswerItem());
    expect(screen.getByText('Short Answer')).toBeInTheDocument();
    expect(screen.getByText(/What is the capital of France\?/)).toBeInTheDocument();
    expect(screen.getByText(/Paris/)).toBeInTheDocument();
  });

  it('calls onClose on Escape', () => {
    const { onClose } = renderOpen(makeTFNGItem());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onAddToExam with the item when Add is clicked', () => {
    const item = makeTFNGItem();
    const { onAddToExam } = renderOpen(item);
    fireEvent.click(screen.getByRole('button', { name: /add to exam/i }));
    expect(onAddToExam).toHaveBeenCalledTimes(1);
    expect(onAddToExam).toHaveBeenCalledWith(item);
  });

  it('wraps focus on Tab (focus trap)', () => {
    renderOpen(makeTFNGItem());
    const closeButton = screen.getByRole('button', { name: /close question details/i });
    const addButton = screen.getByRole('button', { name: /add to exam/i });

    addButton.focus();
    expect(document.activeElement).toBe(addButton);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(addButton);
  });
});
