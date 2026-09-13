import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActScienceQuestionBuilderPane } from '../ActScienceQuestionBuilderPane';
import { createActScienceBlock } from '../ActScienceQuestionBuilderPane';
import type { ActScienceStimulus } from '../../types';

function buildStimulus(): ActScienceStimulus {
  return {
    id: 'stim-images',
    title: 'Images',
    content: 'Content',
    blocks: [createActScienceBlock('block-images')],
    images: [],
    wordCount: 1,
  };
}

describe('Phase 03 ACT reconciliation: question/choice image controls', () => {
  it('edits and removes question and choice image URLs as durable references', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ActScienceQuestionBuilderPane stimulus={buildStimulus()} onChange={onChange} />,
    );
    const questionInput = screen.getByLabelText(/question 1 image url/i);
    fireEvent.change(questionInput, { target: { value: 'https://example.test/q1.png' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const nextStimulus = onChange.mock.calls[0]![0] as ActScienceStimulus;
    expect(nextStimulus.blocks[0]?.questions?.[0]?.imageUrl).toBe('https://example.test/q1.png');
    rerender(<ActScienceQuestionBuilderPane stimulus={nextStimulus} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/remove image from question 1 stem/i));
    const cleared = onChange.mock.calls[1]![0] as ActScienceStimulus;
    expect(cleared.blocks[0]?.questions?.[0]?.imageUrl).toBeUndefined();
  });

  it('edits and removes a choice image URL', () => {
    const onChange = vi.fn();
    render(<ActScienceQuestionBuilderPane stimulus={buildStimulus()} onChange={onChange} />);
    const choiceInput = screen.getByLabelText(/option a image url for question 1/i);
    fireEvent.change(choiceInput, { target: { value: 'https://example.test/choice-a.png' } });
    const nextStimulus = onChange.mock.calls[0]![0] as ActScienceStimulus;
    expect(nextStimulus.blocks[0]?.questions?.[0]?.options[0]?.imageUrl).toBe(
      'https://example.test/choice-a.png',
    );
  });
});
