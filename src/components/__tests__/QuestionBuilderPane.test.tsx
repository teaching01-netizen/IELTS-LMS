import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuestionBuilderPane } from '../QuestionBuilderPane';

vi.mock('../blocks/TFNGBlock', () => ({
  TFNGBlock: () => <div data-testid="tfng-block" />,
}));

vi.mock('../blocks/MapLabelingBlock', () => ({
  MapLabelingBlock: () => <div data-testid="map-block" />,
}));

describe('QuestionBuilderPane', () => {
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
});
