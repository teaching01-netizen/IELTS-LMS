import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MatchingFeaturesBlock as MatchingFeaturesBlockType } from '../../../types';
import { MatchingFeaturesBlock } from '../MatchingFeaturesBlock';

describe('MatchingFeaturesBlock', () => {
  it('keeps referenced feature answers aligned when an option is renamed', () => {
    const initialBlock: MatchingFeaturesBlockType = {
      id: 'matching-features-1',
      type: 'MATCHING_FEATURES',
      instruction: 'Match each feature.',
      options: ['Option A', 'Option B'],
      features: [
        { id: 'feature-1', text: 'First feature', correctMatch: 'Option A' },
        { id: 'feature-2', text: 'Second feature', correctMatch: 'Option A' },
      ],
    };
    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <MatchingFeaturesBlock
          block={block}
          startNum={17}
          endNum={18}
          updateBlock={setBlock}
          deleteBlock={() => {}}
          moveBlock={() => {}}
        />
      );
    }

    render(<Harness />);

    fireEvent.change(screen.getByPlaceholderText('Option 1'), {
      target: { value: 'i' },
    });

    expect(latestBlock.options).toEqual(['i', 'Option B']);
    expect(latestBlock.features.map((feature) => feature.correctMatch)).toEqual(['i', 'i']);
  });

  it('shows a persisted answer that no longer exists in the option set as invalid', () => {
    const block: MatchingFeaturesBlockType = {
      id: 'matching-features-2',
      type: 'MATCHING_FEATURES',
      instruction: 'Match each feature.',
      options: ['A', 'B', 'C'],
      features: [
        {
          id: 'feature-18',
          text: 'toys',
          correctMatch: 'A. They are provided in all tents.',
        },
      ],
    };

    render(
      <MatchingFeaturesBlock
        block={block}
        startNum={18}
        endNum={18}
        updateBlock={() => {}}
        deleteBlock={() => {}}
        moveBlock={() => {}}
      />,
    );

    const invalidOption = screen.getByRole('option', {
      name: 'Invalid saved answer: A. They are provided in all tents.',
    });
    expect((invalidOption as HTMLOptionElement).selected).toBe(true);
  });

  it('prevents deleting an option while a feature still references it', () => {
    const block: MatchingFeaturesBlockType = {
      id: 'matching-features-3',
      type: 'MATCHING_FEATURES',
      instruction: 'Match each feature.',
      options: ['A', 'B'],
      features: [{ id: 'feature-1', text: 'First feature', correctMatch: 'A' }],
    };

    render(
      <MatchingFeaturesBlock
        block={block}
        startNum={1}
        endNum={1}
        updateBlock={() => {}}
        deleteBlock={() => {}}
        moveBlock={() => {}}
      />,
    );

    const optionInput = screen.getByPlaceholderText('Option 1');
    const deleteButton = optionInput.parentElement?.querySelector('button');
    expect(deleteButton).not.toBeNull();
    expect(deleteButton).toBeDisabled();
  });

  it('does not assign unanswered features when a new blank option is named', () => {
    const initialBlock: MatchingFeaturesBlockType = {
      id: 'matching-features-4',
      type: 'MATCHING_FEATURES',
      instruction: 'Match each feature.',
      options: ['A', ''],
      features: [{ id: 'feature-1', text: 'First feature', correctMatch: '' }],
    };
    let latestBlock = initialBlock;

    function Harness() {
      const [block, setBlock] = useState(initialBlock);
      latestBlock = block;
      return (
        <MatchingFeaturesBlock
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
    fireEvent.change(screen.getByPlaceholderText('Option 2'), {
      target: { value: 'B' },
    });

    expect(latestBlock.features[0]?.correctMatch).toBe('');
  });
});
