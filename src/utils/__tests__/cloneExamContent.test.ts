import { describe, expect, it } from 'vitest';
import type {
  ClassificationBlock,
  ClozeBlock,
  DiagramLabelingBlock,
  FlowChartBlock,
  ListeningPart,
  MapBlock,
  MatchingBlock,
  MatchingFeaturesBlock,
  MultiMCQBlock,
  NoteCompletionBlock,
  SentenceCompletionBlock,
  ShortAnswerBlock,
  TableCompletionBlock,
  TFNGBlock,
} from '../../types';
import {
  cloneListeningPartWithNewIds,
  cloneQuestionBlockWithNewIds,
  cloneReadingPassageWithNewIds,
} from '../cloneExamContent';
import { createInitialExamState } from '../../services/examAdapterService';

describe('cloneExamContent', () => {
  it('clones a question block with new nested IDs', () => {
    const block: TFNGBlock = {
      id: 'blk-1',
      type: 'TFNG',
      mode: 'TFNG',
      instruction: 'Instruction',
      questions: [{ id: 'q-1', statement: 'S', correctAnswer: 'T' }],
    };

    const cloned = cloneQuestionBlockWithNewIds(block) as TFNGBlock;

    expect(cloned).not.toBe(block);
    expect(cloned.id).not.toBe(block.id);
    expect(cloned.questions).not.toBe(block.questions);
    expect(cloned.questions[0]?.id).not.toBe(block.questions[0]?.id);
    expect(cloned.questions[0]?.statement).toBe(block.questions[0]?.statement);
  });

  it('clones a reading passage without shared references', () => {
    const state = createInitialExamState('Title', 'Academic', 'Academic');
    const original = state.reading.passages[0];
    original.blocks = [
      {
        id: 'blk-1',
        type: 'TFNG',
        mode: 'TFNG',
        instruction: 'Instruction',
        questions: [{ id: 'q-1', statement: 'Original', correctAnswer: 'T' }],
      },
    ];

    const cloned = cloneReadingPassageWithNewIds(original);
    const clonedBlock = cloned.blocks[0] as TFNGBlock;
    clonedBlock.questions[0]!.statement = 'Changed';

    const originalBlock = original.blocks[0] as TFNGBlock;
    expect(originalBlock.questions[0]!.statement).toBe('Original');
  });

  it('regenerates nested SINGLE_MCQ question and option ids when cloning', () => {
    const block = {
      id: 'single-block-1',
      type: 'SINGLE_MCQ',
      instruction: 'Choose one answer.',
      stem: 'legacy fallback stem',
      options: [
        { id: 'legacy-a', text: 'Legacy A', isCorrect: true },
        { id: 'legacy-b', text: 'Legacy B', isCorrect: false },
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
        {
          id: 'single-q2',
          stem: 'Question 2',
          options: [
            { id: 'q2-a', text: 'C', isCorrect: false },
            { id: 'q2-b', text: 'D', isCorrect: true },
          ],
        },
      ],
    } as any;

    const cloned = cloneQuestionBlockWithNewIds(block) as any;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.questions).toHaveLength(2);
    expect(cloned.questions[0].id).not.toBe(block.questions[0].id);
    expect(cloned.questions[1].id).not.toBe(block.questions[1].id);
    expect(cloned.questions[0].options[0].id).not.toBe(block.questions[0].options[0].id);
    expect(cloned.questions[1].options[1].id).not.toBe(block.questions[1].options[1].id);
    expect(cloned.questions[0].stem).toBe('Question 1');
    expect(cloned.questions[1].stem).toBe('Question 2');
  });

  it('preserves shared sentence answer settings while regenerating sentence ids', () => {
    const block: SentenceCompletionBlock = {
      id: 'sentence-block-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentence.',
      questions: [{
        id: 'sentence-question-1',
        sentence: 'The ____ and ____ are ready.',
        answerRule: 'ONE_WORD',
        acceptAnyAnswerKey: true,
        sharedAcceptedAnswers: ['alpha', 'beta'],
        blanks: [
          { id: 'sentence-blank-1', correctAnswer: 'alpha', position: 0 },
          { id: 'sentence-blank-2', correctAnswer: 'beta', position: 1 },
        ],
      }],
    };

    const cloned = cloneQuestionBlockWithNewIds(block) as SentenceCompletionBlock;
    const originalQuestion = block.questions[0]!;
    const clonedQuestion = cloned.questions[0]!;

    expect(cloned.id).not.toBe(block.id);
    expect(clonedQuestion.id).not.toBe(originalQuestion.id);
    expect(clonedQuestion.blanks.map((blank) => blank.id)).not.toEqual(
      originalQuestion.blanks.map((blank) => blank.id),
    );
    expect(clonedQuestion.acceptAnyAnswerKey).toBe(true);
    expect(clonedQuestion.sharedAcceptedAnswers).toEqual(['alpha', 'beta']);
  });
});

describe('cloneExamContent additional block types', () => {
  it('clones a CLOZE block with new question ids', () => {
    const block: ClozeBlock = {
      id: 'cloze-blk-1',
      type: 'CLOZE',
      instruction: 'Fill each gap.',
      answerRule: 'ONE_WORD',
      questions: [
        { id: 'cloze-q-1', prompt: 'Prompt one', correctAnswer: 'apple', acceptedAnswers: ['apple', 'Apple'] },
        { id: 'cloze-q-2', prompt: 'Prompt two', correctAnswer: 'pear' },
      ],
    };
    const before = JSON.stringify(block);
    const originalQuestionIds = block.questions.map((q) => q.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as ClozeBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.questions.map((q) => q.id)).not.toEqual(originalQuestionIds);
    expect(cloned.questions[0]?.prompt).toBe('Prompt one');
    expect(cloned.questions[0]?.correctAnswer).toBe('apple');
    expect(cloned.questions[0]?.acceptedAnswers).toEqual(['apple', 'Apple']);
    expect(cloned.questions[1]?.prompt).toBe('Prompt two');
    expect(cloned.questions[1]?.correctAnswer).toBe('pear');
    expect(cloned.instruction).toBe(block.instruction);
    expect(cloned.answerRule).toBe(block.answerRule);
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a MATCHING block with new heading and question ids', () => {
    const block: MatchingBlock = {
      id: 'matching-blk-1',
      type: 'MATCHING',
      instruction: 'Match headings.',
      headings: [
        { id: 'h-1', text: 'Heading A' },
        { id: 'h-2', text: 'Heading B' },
      ],
      questions: [
        { id: 'mq-1', paragraphLabel: 'Paragraph A', correctHeading: 'Heading A' },
        { id: 'mq-2', paragraphLabel: 'Paragraph B', correctHeading: 'Heading B' },
      ],
    };
    const before = JSON.stringify(block);
    const originalHeadingIds = block.headings.map((h) => h.id);
    const originalQuestionIds = block.questions.map((q) => q.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as MatchingBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.headings.map((h) => h.id)).not.toEqual(originalHeadingIds);
    expect(cloned.questions.map((q) => q.id)).not.toEqual(originalQuestionIds);
    expect(cloned.headings.map((h) => h.text)).toEqual(['Heading A', 'Heading B']);
    expect(cloned.questions[0]?.paragraphLabel).toBe('Paragraph A');
    expect(cloned.questions[0]?.correctHeading).toBe('Heading A');
    expect(cloned.questions[1]?.paragraphLabel).toBe('Paragraph B');
    expect(cloned.questions[1]?.correctHeading).toBe('Heading B');
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a MAP block with new question ids', () => {
    const block: MapBlock = {
      id: 'map-blk-1',
      type: 'MAP',
      instruction: 'Label the map.',
      assetUrl: 'https://example.com/map.png',
      questions: [
        { id: 'map-q-1', label: 'Entrance', correctAnswer: 'A', x: 10, y: 20 },
        { id: 'map-q-2', label: 'Exit', correctAnswer: 'B', x: 30, y: 40 },
      ],
    };
    const before = JSON.stringify(block);
    const originalQuestionIds = block.questions.map((q) => q.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as MapBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.questions.map((q) => q.id)).not.toEqual(originalQuestionIds);
    expect(cloned.questions[0]?.label).toBe('Entrance');
    expect(cloned.questions[0]?.correctAnswer).toBe('A');
    expect(cloned.questions[0]?.x).toBe(10);
    expect(cloned.questions[0]?.y).toBe(20);
    expect(cloned.questions[1]?.label).toBe('Exit');
    expect(cloned.assetUrl).toBe('https://example.com/map.png');
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a MULTI_MCQ block with new option ids', () => {
    const block: MultiMCQBlock = {
      id: 'multi-blk-1',
      type: 'MULTI_MCQ',
      instruction: 'Choose two answers.',
      stem: 'Which are fruits?',
      requiredSelections: 2,
      options: [
        { id: 'opt-1', text: 'Apple', isCorrect: true },
        { id: 'opt-2', text: 'Car', isCorrect: false },
        { id: 'opt-3', text: 'Pear', isCorrect: true },
      ],
    };
    const before = JSON.stringify(block);
    const originalOptionIds = block.options.map((o) => o.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as MultiMCQBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.options.map((o) => o.id)).not.toEqual(originalOptionIds);
    expect(cloned.options.map((o) => o.text)).toEqual(['Apple', 'Car', 'Pear']);
    expect(cloned.options.map((o) => o.isCorrect)).toEqual([true, false, true]);
    expect(cloned.stem).toBe('Which are fruits?');
    expect(cloned.requiredSelections).toBe(2);
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a SHORT_ANSWER block with new question ids', () => {
    const block: ShortAnswerBlock = {
      id: 'sa-blk-1',
      type: 'SHORT_ANSWER',
      instruction: 'Answer briefly.',
      questions: [
        { id: 'sa-q-1', prompt: 'Capital of France?', correctAnswer: 'Paris', acceptedAnswers: ['Paris'], answerRule: 'ONE_WORD' },
        { id: 'sa-q-2', prompt: 'Capital of Italy?', correctAnswer: 'Rome', answerRule: 'ONE_WORD' },
      ],
    };
    const before = JSON.stringify(block);
    const originalQuestionIds = block.questions.map((q) => q.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as ShortAnswerBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.questions.map((q) => q.id)).not.toEqual(originalQuestionIds);
    expect(cloned.questions[0]?.prompt).toBe('Capital of France?');
    expect(cloned.questions[0]?.correctAnswer).toBe('Paris');
    expect(cloned.questions[0]?.acceptedAnswers).toEqual(['Paris']);
    expect(cloned.questions[0]?.answerRule).toBe('ONE_WORD');
    expect(cloned.questions[1]?.prompt).toBe('Capital of Italy?');
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a SENTENCE_COMPLETION block with new question and blank ids', () => {
    const block: SentenceCompletionBlock = {
      id: 'sc-blk-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentence.',
      questions: [
        {
          id: 'sc-q-1',
          sentence: 'The ____ sat on the ____.',
          answerRule: 'ONE_WORD',
          blanks: [
            { id: 'sc-b-1', correctAnswer: 'cat', position: 0 },
            { id: 'sc-b-2', correctAnswer: 'mat', acceptedAnswers: ['mat', 'rug'], position: 1 },
          ],
        },
      ],
    };
    const before = JSON.stringify(block);
    const originalQuestionIds = block.questions.map((q) => q.id);
    const originalBlankIds = block.questions[0]!.blanks.map((b) => b.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as SentenceCompletionBlock;
    const clonedQuestion = cloned.questions[0]!;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.questions.map((q) => q.id)).not.toEqual(originalQuestionIds);
    expect(clonedQuestion.blanks.map((b) => b.id)).not.toEqual(originalBlankIds);
    expect(clonedQuestion.sentence).toBe('The ____ sat on the ____.');
    expect(clonedQuestion.answerRule).toBe('ONE_WORD');
    expect(clonedQuestion.blanks[0]?.correctAnswer).toBe('cat');
    expect(clonedQuestion.blanks[0]?.position).toBe(0);
    expect(clonedQuestion.blanks[1]?.correctAnswer).toBe('mat');
    expect(clonedQuestion.blanks[1]?.acceptedAnswers).toEqual(['mat', 'rug']);
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a DIAGRAM_LABELING block with new label ids', () => {
    const block: DiagramLabelingBlock = {
      id: 'dg-blk-1',
      type: 'DIAGRAM_LABELING',
      instruction: 'Label the diagram.',
      imageUrl: 'https://example.com/diagram.png',
      labels: [
        { id: 'lbl-1', x: 1, y: 2, prompt: 'Part A', correctAnswer: 'beak' },
        { id: 'lbl-2', x: 3, y: 4, correctAnswer: 'wing' },
      ],
    };
    const before = JSON.stringify(block);
    const originalLabelIds = block.labels.map((l) => l.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as DiagramLabelingBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.labels.map((l) => l.id)).not.toEqual(originalLabelIds);
    expect(cloned.labels[0]?.correctAnswer).toBe('beak');
    expect(cloned.labels[0]?.x).toBe(1);
    expect(cloned.labels[0]?.y).toBe(2);
    expect(cloned.labels[0]?.prompt).toBe('Part A');
    expect(cloned.labels[1]?.correctAnswer).toBe('wing');
    expect(cloned.imageUrl).toBe('https://example.com/diagram.png');
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a FLOW_CHART block with new step ids', () => {
    const block: FlowChartBlock = {
      id: 'fc-blk-1',
      type: 'FLOW_CHART',
      instruction: 'Complete the chart.',
      steps: [
        { id: 'step-1', label: 'Step one', correctAnswer: 'heat' },
        { id: 'step-2', label: 'Step two', correctAnswer: 'cool' },
      ],
    };
    const before = JSON.stringify(block);
    const originalStepIds = block.steps.map((s) => s.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as FlowChartBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.steps.map((s) => s.id)).not.toEqual(originalStepIds);
    expect(cloned.steps[0]?.label).toBe('Step one');
    expect(cloned.steps[0]?.correctAnswer).toBe('heat');
    expect(cloned.steps[1]?.label).toBe('Step two');
    expect(cloned.steps[1]?.correctAnswer).toBe('cool');
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a TABLE_COMPLETION block with new cell ids', () => {
    const block: TableCompletionBlock = {
      id: 'tbl-blk-1',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      headers: ['Name', 'Value'],
      rows: [['a', '____'], ['b', '____']],
      answerRule: 'ONE_WORD',
      cells: [
        { id: 'cell-1', correctAnswer: 'x', row: 0, col: 1 },
        { id: 'cell-2', correctAnswer: 'y', acceptedAnswers: ['y', 'Y'], row: 1, col: 1 },
      ],
    };
    const before = JSON.stringify(block);
    const originalCellIds = block.cells.map((c) => c.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as TableCompletionBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.cells.map((c) => c.id)).not.toEqual(originalCellIds);
    expect(cloned.cells[0]?.correctAnswer).toBe('x');
    expect(cloned.cells[0]?.row).toBe(0);
    expect(cloned.cells[0]?.col).toBe(1);
    expect(cloned.cells[1]?.correctAnswer).toBe('y');
    expect(cloned.cells[1]?.acceptedAnswers).toEqual(['y', 'Y']);
    expect(cloned.headers).toEqual(['Name', 'Value']);
    expect(cloned.rows).toEqual([['a', '____'], ['b', '____']]);
    expect(cloned.answerRule).toBe('ONE_WORD');
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a NOTE_COMPLETION block with new question and blank ids', () => {
    const block: NoteCompletionBlock = {
      id: 'nc-blk-1',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete the notes.',
      questions: [
        {
          id: 'nc-q-1',
          noteText: 'Notes ____ and ____.',
          answerRule: 'ONE_WORD',
          blanks: [
            { id: 'nc-b-1', correctAnswer: 'one', position: 0 },
            { id: 'nc-b-2', correctAnswer: 'two', position: 1 },
          ],
        },
      ],
    };
    const before = JSON.stringify(block);
    const originalQuestionIds = block.questions.map((q) => q.id);
    const originalBlankIds = block.questions[0]!.blanks.map((b) => b.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as NoteCompletionBlock;
    const clonedQuestion = cloned.questions[0]!;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.questions.map((q) => q.id)).not.toEqual(originalQuestionIds);
    expect(clonedQuestion.blanks.map((b) => b.id)).not.toEqual(originalBlankIds);
    expect(clonedQuestion.noteText).toBe('Notes ____ and ____.');
    expect(clonedQuestion.answerRule).toBe('ONE_WORD');
    expect(clonedQuestion.blanks[0]?.correctAnswer).toBe('one');
    expect(clonedQuestion.blanks[1]?.correctAnswer).toBe('two');
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a CLASSIFICATION block with new item ids', () => {
    const block: ClassificationBlock = {
      id: 'cls-blk-1',
      type: 'CLASSIFICATION',
      instruction: 'Classify the items.',
      categories: ['Mammal', 'Bird'],
      items: [
        { id: 'item-1', text: 'Whale', correctCategory: 'Mammal' },
        { id: 'item-2', text: 'Eagle', correctCategory: 'Bird' },
      ],
    };
    const before = JSON.stringify(block);
    const originalItemIds = block.items.map((i) => i.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as ClassificationBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.items.map((i) => i.id)).not.toEqual(originalItemIds);
    expect(cloned.items[0]?.text).toBe('Whale');
    expect(cloned.items[0]?.correctCategory).toBe('Mammal');
    expect(cloned.items[1]?.text).toBe('Eagle');
    expect(cloned.items[1]?.correctCategory).toBe('Bird');
    expect(cloned.categories).toEqual(['Mammal', 'Bird']);
    expect(JSON.stringify(block)).toBe(before);
  });

  it('clones a MATCHING_FEATURES block with new feature ids and preserved options', () => {
    const block: MatchingFeaturesBlock = {
      id: 'mf-blk-1',
      type: 'MATCHING_FEATURES',
      instruction: 'Match the features.',
      features: [
        { id: 'feat-1', text: 'Has wings', correctMatch: 'Bird' },
        { id: 'feat-2', text: 'Has fins', correctMatch: 'Fish' },
      ],
      options: ['Bird', 'Fish', 'Mammal'],
    };
    const before = JSON.stringify(block);
    const originalFeatureIds = block.features.map((f) => f.id);

    const cloned = cloneQuestionBlockWithNewIds(block) as MatchingFeaturesBlock;

    expect(cloned.id).not.toBe(block.id);
    expect(cloned.features.map((f) => f.id)).not.toEqual(originalFeatureIds);
    expect(cloned.features[0]?.text).toBe('Has wings');
    expect(cloned.features[0]?.correctMatch).toBe('Bird');
    expect(cloned.features[1]?.text).toBe('Has fins');
    expect(cloned.features[1]?.correctMatch).toBe('Fish');
    expect(cloned.options).toEqual(['Bird', 'Fish', 'Mammal']);
    expect(JSON.stringify(block)).toBe(before);
  });
});

describe('cloneListeningPartWithNewIds', () => {
  it('clones a listening part with new part, pin, block, and nested ids', () => {
    const part: ListeningPart = {
      id: 'part-1',
      title: 'Section 1',
      transcript: 'Hello world',
      pins: [
        { id: 'pin-1', time: '00:10', label: 'Intro' },
        { id: 'pin-2', time: '01:20', label: 'Middle' },
      ],
      blocks: [
        {
          id: 'blk-tfng-1',
          type: 'TFNG',
          mode: 'TFNG',
          instruction: 'Do you agree?',
          questions: [{ id: 'q-1', statement: 'Statement one', correctAnswer: 'T' }],
        } as TFNGBlock,
        {
          id: 'multi-blk-1',
          type: 'MULTI_MCQ',
          instruction: 'Choose two.',
          stem: 'Which are fruits?',
          requiredSelections: 2,
          options: [
            { id: 'opt-1', text: 'Apple', isCorrect: true },
            { id: 'opt-2', text: 'Car', isCorrect: false },
          ],
        } as MultiMCQBlock,
      ],
    };
    const before = JSON.stringify(part);
    const originalPinIds = part.pins.map((p) => p.id);
    const originalBlockIds = part.blocks.map((b) => b.id);

    const cloned = cloneListeningPartWithNewIds(part);

    expect(cloned.id).not.toBe(part.id);
    expect(cloned.pins.map((p) => p.id)).not.toEqual(originalPinIds);
    expect(cloned.blocks.map((b) => b.id)).not.toEqual(originalBlockIds);
    const clonedTfng = cloned.blocks[0] as TFNGBlock;
    const originalTfng = part.blocks[0] as TFNGBlock;
    expect(clonedTfng.questions[0]?.id).not.toBe(originalTfng.questions[0]?.id);
    expect(clonedTfng.questions[0]?.statement).toBe('Statement one');
    const clonedMulti = cloned.blocks[1] as MultiMCQBlock;
    const originalMulti = part.blocks[1] as MultiMCQBlock;
    expect(clonedMulti.options.map((o) => o.id)).not.toEqual(originalMulti.options.map((o) => o.id));
    expect(clonedMulti.options.map((o) => o.text)).toEqual(['Apple', 'Car']);
    expect(cloned.title).toBe('Section 1');
    expect(cloned.transcript).toBe('Hello world');
    expect(cloned.pins[0]?.time).toBe('00:10');
    expect(cloned.pins[0]?.label).toBe('Intro');
    expect(JSON.stringify(part)).toBe(before);
  });

  it('cloned listening part shares no references with the original', () => {
    const part: ListeningPart = {
      id: 'part-2',
      title: 'Section 2',
      pins: [{ id: 'pin-9', time: '00:05', label: 'Start' }],
      blocks: [
        {
          id: 'blk-map-1',
          type: 'MAP',
          instruction: 'Label the map.',
          assetUrl: 'https://example.com/map.png',
          questions: [{ id: 'map-q-9', label: 'Gate', correctAnswer: 'C', x: 5, y: 6 }],
        } as MapBlock,
      ],
    };
    const before = JSON.stringify(part);

    const cloned = cloneListeningPartWithNewIds(part);
    cloned.title = 'Changed';
    cloned.pins[0]!.label = 'Changed pin';
    (cloned.blocks[0] as MapBlock).questions[0]!.label = 'Changed label';

    expect(part.title).toBe('Section 2');
    expect(part.pins[0]?.label).toBe('Start');
    expect((part.blocks[0] as MapBlock).questions[0]?.label).toBe('Gate');
    expect(JSON.stringify(part)).toBe(before);
  });
});
