import { describe, expect, it } from 'vitest';
import type { SentenceCompletionBlock, TFNGBlock } from '../../types';
import { cloneQuestionBlockWithNewIds, cloneReadingPassageWithNewIds } from '../cloneExamContent';
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
