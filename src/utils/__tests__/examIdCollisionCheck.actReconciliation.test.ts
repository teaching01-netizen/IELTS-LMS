import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../services/examAdapterService';
import { createActScienceBlock, createActScienceQuestion } from '../../components/ActScienceQuestionBuilderPane';
import { getExamIdCollisionIssues } from '../examIdCollisionCheck';

describe('Phase 03 ACT reconciliation: collision checks', () => {
  it('detects duplicate ACT Science stimulus IDs', () => {
    const state = createInitialExamState('ACT', 'ACT', 'ACT Science');
    state.science.stimuli = [
      { id: 'stim-dup', title: 'A', content: 'Content A', blocks: [createActScienceBlock('block-a')], images: [], wordCount: 2 },
      { id: 'stim-dup', title: 'B', content: 'Content B', blocks: [createActScienceBlock('block-b')], images: [], wordCount: 2 },
    ];
    const issues = getExamIdCollisionIssues(state);
    expect(issues.some((issue) => issue.field === 'integrity.duplicate_science_stimulus_ids')).toBe(true);
  });

  it('detects duplicate science block IDs', () => {
    const state = createInitialExamState('ACT', 'ACT', 'ACT Science');
    state.science.stimuli = [
      { id: 'stim-a', title: 'A', content: 'Content A', blocks: [createActScienceBlock('block-dup')], images: [], wordCount: 2 },
      { id: 'stim-b', title: 'B', content: 'Content B', blocks: [createActScienceBlock('block-dup')], images: [], wordCount: 2 },
    ];
    const issues = getExamIdCollisionIssues(state);
    expect(issues.some((issue) => issue.field === 'integrity.duplicate_block_ids')).toBe(true);
  });

  it('detects duplicate science answer slots through the student descriptor path', () => {
    const state = createInitialExamState('ACT', 'ACT', 'ACT Science');
    const blockA = createActScienceBlock('block-a');
    const blockB = createActScienceBlock('block-b');
    const shared = { ...createActScienceQuestion('q-shared'), stem: 'Shared stem' };
    blockA.questions = [{ ...shared }];
    blockB.questions = [{ ...shared }];
    state.science.stimuli = [
      { id: 'stim-a', title: 'A', content: 'Content A', blocks: [blockA], images: [], wordCount: 2 },
      { id: 'stim-b', title: 'B', content: 'Content B', blocks: [blockB], images: [], wordCount: 2 },
    ];
    const issues = getExamIdCollisionIssues(state);
    expect(
      issues.some(
        (issue) =>
          issue.field === 'integrity.duplicate_question_slot_ids' ||
          issue.field === 'integrity.answer_key_scalar_collision',
      ),
    ).toBe(true);
  });

  it('ignores science content when the science section is disabled', () => {
    const state = createInitialExamState('Title', 'Academic', 'Academic');
    state.science.stimuli = [
      { id: 'stim-dup', title: 'A', content: 'Content A', blocks: [createActScienceBlock('block-a')], images: [], wordCount: 2 },
      { id: 'stim-dup', title: 'B', content: 'Content B', blocks: [createActScienceBlock('block-b')], images: [], wordCount: 2 },
    ];
    const issues = getExamIdCollisionIssues(state);
    expect(issues.some((issue) => issue.field === 'integrity.duplicate_science_stimulus_ids')).toBe(false);
  });
});
