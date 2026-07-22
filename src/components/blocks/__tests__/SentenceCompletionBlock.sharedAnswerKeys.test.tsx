import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SentenceCompletionBlock as SentenceCompletionBlockType } from '../../../types';
import { SentenceCompletionBlock } from '../SentenceCompletionBlock';

function buildBlock(
  overrides: Partial<SentenceCompletionBlockType['questions'][number]> = {},
): SentenceCompletionBlockType {
  return {
    id: 'sentence-1',
    type: 'SENTENCE_COMPLETION',
    instruction: 'Complete the sentence',
    questions: [
      {
        id: 'q-1',
        sentence: 'The ____ and ____ are ready.',
        blanks: [
          { id: 'blank-1', correctAnswer: 'alpha', acceptedAnswers: ['alpha', 'beta'], position: 0 },
          { id: 'blank-2', correctAnswer: 'beta', acceptedAnswers: ['beta'], position: 1 },
        ],
        answerRule: 'ONE_WORD',
        ...overrides,
      },
    ],
  };
}

function renderHarness(initialBlock: SentenceCompletionBlockType = buildBlock()) {
  let latestBlock = initialBlock;

  function Harness() {
    const [block, setBlock] = useState(initialBlock);
    latestBlock = block;
    return (
      <SentenceCompletionBlock
        block={block}
        startNum={1}
        endNum={2}
        updateBlock={setBlock}
        deleteBlock={() => {}}
        moveBlock={() => {}}
      />
    );
  }

  render(<Harness />);
  return { getLatestBlock: () => latestBlock };
}

const sharedAnswerKeyLabel = 'Accept any answer key in this sentence';

describe('SentenceCompletionBlock shared answer keys', () => {
  it('starts in per-blank mode with an unchecked toggle and both blank editors', () => {
    renderHarness();

    expect(screen.getByLabelText(sharedAnswerKeyLabel)).not.toBeChecked();
    expect(screen.getByText('Blank 1:')).toBeVisible();
    expect(screen.getByText('Blank 2:')).toBeVisible();
    expect(screen.getAllByPlaceholderText('Answer...')).toHaveLength(2);
  });

  it('enables shared mode with the ordered union without changing blank answers', () => {
    const initialBlock = buildBlock();
    const blanksBefore = structuredClone(initialBlock.questions[0]!.blanks);
    const { getLatestBlock } = renderHarness(initialBlock);

    fireEvent.click(screen.getByLabelText(sharedAnswerKeyLabel));

    expect(screen.getByLabelText(sharedAnswerKeyLabel)).toBeChecked();
    expect(screen.getAllByText(/^(alpha|beta)$/).map((chip) => chip.firstChild?.textContent)).toEqual([
      'alpha',
      'beta',
    ]);
    expect(getLatestBlock().questions[0]!.sharedAcceptedAnswers).toEqual(['alpha', 'beta']);
    expect(getLatestBlock().questions[0]!.blanks).toEqual(blanksBefore);
  });

  it('preserves shared additions across off and on transitions', () => {
    const { getLatestBlock } = renderHarness();

    fireEvent.click(screen.getByLabelText(sharedAnswerKeyLabel));
    const sharedInput = screen.getByLabelText('Shared accepted answers for sentence 1–2');
    fireEvent.change(sharedInput, { target: { value: 'delta' } });
    fireEvent.keyDown(sharedInput, { key: 'Enter' });
    expect(getLatestBlock().questions[0]!.sharedAcceptedAnswers).toEqual(['alpha', 'beta', 'delta']);

    fireEvent.click(screen.getByLabelText(sharedAnswerKeyLabel));
    expect(screen.getByText('Blank 1:')).toBeVisible();
    expect(screen.getByText('Blank 2:')).toBeVisible();
    expect(screen.getAllByPlaceholderText('Answer...')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText(sharedAnswerKeyLabel));

    expect(getLatestBlock().questions[0]!.sharedAcceptedAnswers).toEqual(['alpha', 'beta', 'delta']);
    expect(screen.getAllByPlaceholderText('Answer...')).toHaveLength(1);
    expect(screen.getByLabelText('Shared accepted answers for sentence 1–2')).toBeVisible();
    expect(screen.getByText('delta')).toBeVisible();
  });

  it('updates only sharedAcceptedAnswers and upgrades the answer rule in shared mode', () => {
    const initialBlock = buildBlock({ answerRule: 'ONE_WORD' });
    const blanksBefore = structuredClone(initialBlock.questions[0]!.blanks);
    const { getLatestBlock } = renderHarness(initialBlock);

    fireEvent.click(screen.getByLabelText(sharedAnswerKeyLabel));
    const sharedInput = screen.getByLabelText('Shared accepted answers for sentence 1–2');
    fireEvent.change(sharedInput, { target: { value: 'gamma' } });
    fireEvent.keyDown(sharedInput, { key: 'Enter' });
    fireEvent.change(sharedInput, { target: { value: 'crowd noise' } });
    fireEvent.keyDown(sharedInput, { key: 'Enter' });

    const question = getLatestBlock().questions[0]!;
    expect(question.sharedAcceptedAnswers).toEqual(['alpha', 'beta', 'gamma', 'crowd noise']);
    expect(question).not.toHaveProperty('correctAnswer');
    expect(question.blanks).toEqual(blanksBefore);
    expect(question.answerRule).toBe('TWO_WORDS');

    fireEvent.click(screen.getByLabelText(sharedAnswerKeyLabel));
    fireEvent.click(screen.getByLabelText(sharedAnswerKeyLabel));
    expect(getLatestBlock().questions[0]!.answerRule).toBe('TWO_WORDS');
  });

  it('does not downgrade the answer rule below a multi-word shared key', () => {
    const { getLatestBlock } = renderHarness(
      buildBlock({
        acceptAnyAnswerKey: true,
        sharedAcceptedAnswers: ['crowd noise'],
        answerRule: 'TWO_WORDS',
      }),
    );

    fireEvent.change(screen.getByDisplayValue('No more than two words'), {
      target: { value: 'ONE_WORD' },
    });

    expect(getLatestBlock().questions[0]!.answerRule).toBe('TWO_WORDS');
  });

  it('shows the exact warning when shared keys are fewer than blanks', () => {
    renderHarness(
      buildBlock({
        acceptAnyAnswerKey: true,
        sharedAcceptedAnswers: ['alpha', 'ALPHA'],
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'This sentence has fewer unique answer keys than blanks. Students may not be able to receive full credit.',
    );
  });

  it('adds new sentences with shared answer keys off by default', () => {
    const { getLatestBlock } = renderHarness();

    fireEvent.click(screen.getByRole('button', { name: 'Add Sentence' }));

    expect(getLatestBlock().questions[1]!.acceptAnyAnswerKey).toBeUndefined();
  });
});
