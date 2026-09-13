import { describe, expect, it } from 'vitest';
import { createActScienceBlock } from '../../components/ActScienceQuestionBuilderPane';
import { createInitialExamState, hydrateExamState } from '../examAdapterService';

describe('Phase 03 ACT reconciliation: examAdapterService', () => {
  it('preserves ACT Science answer-choice image URLs during hydration', () => {
    const state = createInitialExamState('ACT Science Image Draft', 'ACT', 'ACT Science');
    const block = createActScienceBlock('act-image-block');
    const imageUrl = ' https://example.test/act-option-a.png ';
    const options = block.options.map((option) =>
      option.id === block.options[0]?.id ? { ...option, imageUrl } : option,
    );
    block.options = options;
    block.questions![0]!.options = options;
    state.science.stimuli = [
      {
        id: 'act-image-stimulus',
        title: 'Image stimulus',
        content: 'Compare the choices.',
        blocks: [block],
        images: [],
        wordCount: 3,
      },
    ];
    const hydrated = hydrateExamState(state);
    const hydratedBlock = hydrated.science.stimuli[0]?.blocks[0];
    expect(hydratedBlock?.options[0]?.imageUrl).toBe('https://example.test/act-option-a.png');
    expect(hydratedBlock?.questions?.[0]?.options[0]?.imageUrl).toBe(
      'https://example.test/act-option-a.png',
    );
  });

  it('preserves question-stem image URLs for science but strips them from IELTS', () => {
    const actState = createInitialExamState('ACT Science Stem Image Draft', 'ACT', 'ACT Science');
    const actBlock = createActScienceBlock('act-stem-image-block');
    actBlock.questions![0] = {
      ...actBlock.questions![0]!,
      imageUrl: ' https://example.test/act-question.png ',
    };
    actState.science.stimuli = [
      {
        id: 'act-stem-image-stimulus',
        title: 'Question image stimulus',
        content: 'Read the image.',
        blocks: [actBlock],
        images: [],
        wordCount: 3,
      },
    ];
    const hydratedAct = hydrateExamState(actState);
    expect(hydratedAct.science.stimuli[0]?.blocks[0]?.questions?.[0]?.imageUrl).toBe(
      'https://example.test/act-question.png',
    );
    const academicState = createInitialExamState('IELTS Draft', 'Academic');
    academicState.reading.passages[0]!.blocks = [actBlock];
    const hydratedAcademicState = hydrateExamState(academicState);
    expect(
      hydratedAcademicState.reading.passages[0]?.blocks[0]?.questions?.[0]?.imageUrl,
    ).toBe(undefined);
  });
});
