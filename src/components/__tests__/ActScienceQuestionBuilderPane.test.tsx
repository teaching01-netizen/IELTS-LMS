import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActScienceStimulus } from '../../types';
import {
  ActScienceQuestionBuilderPane,
  createActScienceBlock,
} from '../ActScienceQuestionBuilderPane';

describe('ActScienceQuestionBuilderPane', () => {
  it('edits several questions under one stimulus with four choices and a skill category', () => {
    const stimulus: ActScienceStimulus = {
      id: 'stimulus-1',
      title: 'Experiment 1',
      content: '<p>Data from an experiment.</p>',
      blocks: [createActScienceBlock('block-1')],
    };
    const onChange = vi.fn();

    const { rerender } = render(
      <ActScienceQuestionBuilderPane
        stimulus={stimulus}
        startNumber={1}
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Questions (1)')).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: /Option [A-D] text for question 1/i })).toHaveLength(4);
    expect(screen.getByLabelText('Skill category for question 1')).toHaveValue('interpretation_of_data');

    fireEvent.change(screen.getByLabelText('Question 1 stem'), {
      target: { value: 'What does the table show?' },
    });
    const stimulusWithStem = onChange.mock.lastCall?.[0] as ActScienceStimulus;
    rerender(
      <ActScienceQuestionBuilderPane
        stimulus={stimulusWithStem}
        startNumber={1}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Skill category for question 1'), {
      target: { value: 'scientific_investigation' },
    });

    const latestStimulus = onChange.mock.lastCall?.[0] as ActScienceStimulus;
    expect(latestStimulus.blocks[0]?.questions?.[0]).toEqual(
      expect.objectContaining({
        stem: 'What does the table show?',
        skillCategory: 'scientific_investigation',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add ACT Science question' }));
    const stimulusWithTwoQuestions = onChange.mock.lastCall?.[0] as ActScienceStimulus;
    expect(stimulusWithTwoQuestions.blocks[0]?.questions).toHaveLength(2);
  });
});
