import { describe, expect, it } from 'vitest';
import { getBlockQuestionCount, getPassageQuestionCount, getPartQuestionCount, validateBlock } from '../examUtils';
import type { QuestionBlock, Passage, ListeningPart } from '../../types';

describe('getBlockQuestionCount', () => {
  it('counts TFNG questions', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'TFNG', mode: 'TFNG', instruction: '',
      questions: [
        { id: 'q1', statement: 'S1', correctAnswer: 'T' },
        { id: 'q2', statement: 'S2', correctAnswer: 'F' },
        { id: 'q3', statement: 'S3', correctAnswer: 'NG' },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(3);
  });

  it('counts CLOZE questions', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'CLOZE', instruction: '', answerRule: 'ONE_WORD',
      questions: [
        { id: 'q1', prompt: 'P1', correctAnswer: 'A' },
        { id: 'q2', prompt: 'P2', correctAnswer: 'B' },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });

  it('counts MATCHING questions', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'MATCHING', instruction: '',
      headings: [{ id: 'h1', text: 'H1' }],
      questions: [
        { id: 'q1', paragraphLabel: 'A', correctHeading: 'i' },
        { id: 'q2', paragraphLabel: 'B', correctHeading: 'i' },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });

  it('counts MAP questions', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'MAP', instruction: '', assetUrl: 'img.png',
      questions: [
        { id: 'q1', label: 'L1', correctAnswer: 'A', x: 10, y: 20 },
        { id: 'q2', label: 'L2', correctAnswer: 'B', x: 30, y: 40 },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });

  it('counts MULTI_MCQ by marked-correct options despite stale requiredSelections', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'MULTI_MCQ', instruction: '', stem: 'S',
      requiredSelections: 4,
      options: [
        { id: 'o1', text: 'A', isCorrect: true },
        { id: 'o2', text: 'B', isCorrect: true },
        { id: 'o3', text: 'C', isCorrect: false },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });

  it('validates at least one MULTI_MCQ correct option without an independent count requirement', () => {
    const validBlock: QuestionBlock = {
      id: 'b1', type: 'MULTI_MCQ', instruction: '', stem: 'S',
      requiredSelections: 4,
      options: [
        { id: 'o1', text: 'A', isCorrect: true },
        { id: 'o2', text: 'B', isCorrect: false },
      ],
    };

    expect(validateBlock(validBlock).isValid).toBe(true);

    const invalidBlock: QuestionBlock = {
      ...validBlock,
      options: validBlock.options.map((option) => ({ ...option, isCorrect: false })),
    };
    expect(validateBlock(invalidBlock).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'options', message: 'Mark at least one option as correct' }),
    ]));
  });

  it('counts SINGLE_MCQ with questions array', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'SINGLE_MCQ', instruction: '', stem: '',
      questions: [
        { id: 'q1', stem: 'S1', options: [{ id: 'o1', text: 'A', isCorrect: true }] },
        { id: 'q2', stem: 'S2', options: [{ id: 'o2', text: 'B', isCorrect: true }] },
      ],
      options: [],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });

  it('counts SINGLE_MCQ without questions array as 1', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'SINGLE_MCQ', instruction: '', stem: 'S',
      options: [{ id: 'o1', text: 'A', isCorrect: true }],
    };
    expect(getBlockQuestionCount(block)).toBe(1);
  });

  it('counts SHORT_ANSWER questions', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'SHORT_ANSWER', instruction: '',
      questions: [
        { id: 'q1', prompt: 'P1', correctAnswer: 'A', answerRule: 'ONE_WORD' },
        { id: 'q2', prompt: 'P2', correctAnswer: 'B', answerRule: 'ONE_WORD' },
        { id: 'q3', prompt: 'P3', correctAnswer: 'C', answerRule: 'ONE_WORD' },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(3);
  });

  it('counts SENTENCE_COMPLETION questions with slots', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'SENTENCE_COMPLETION', instruction: '',
      questions: [
        {
          id: 'q1',
          sentence: 'The __ fox',
          blanks: [
            { id: 'blank-1', correctAnswer: 'quick', answerRule: 'ONE_WORD' },
            { id: 'blank-2', correctAnswer: 'brown', answerRule: 'ONE_WORD' },
          ],
        },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });

  it('counts DIAGRAM_LABELING labels', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'DIAGRAM_LABELING', instruction: '', imageUrl: 'img.png',
      labels: [
        { id: 'l1', correctAnswer: 'A' },
        { id: 'l2', correctAnswer: 'B' },
        { id: 'l3', correctAnswer: 'C' },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(3);
  });

  it('counts FLOW_CHART steps', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'FLOW_CHART', instruction: '',
      steps: [
        { id: 's1', label: 'Step 1', correctAnswer: 'A' },
        { id: 's2', label: 'Step 2', correctAnswer: 'B' },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });

  it('counts TABLE_COMPLETION cells', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'TABLE_COMPLETION', instruction: '',
      headers: [{ id: 'h1', text: 'H1' }],
      rows: [{ id: 'r1', cells: ['c1'] }],
      cells: [
        { id: 'c1', correctAnswer: 'A' },
        { id: 'c2', correctAnswer: 'B' },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });

  it('counts NOTE_COMPLETION blanks', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'NOTE_COMPLETION', instruction: '',
      questions: [
        {
          id: 'q1', noteText: 'Note 1',
          blanks: [
            { id: 'b1', correctAnswer: 'A', answerRule: 'ONE_WORD' },
            { id: 'b2', correctAnswer: 'B', answerRule: 'ONE_WORD' },
          ],
        },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });

  it('counts CLASSIFICATION items', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'CLASSIFICATION', instruction: '',
      categories: ['A', 'B'],
      items: [
        { id: 'i1', text: 'Item 1', correctCategory: 'A' },
        { id: 'i2', text: 'Item 2', correctCategory: 'B' },
        { id: 'i3', text: 'Item 3', correctCategory: 'A' },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(3);
  });

  it('counts MATCHING_FEATURES features', () => {
    const block: QuestionBlock = {
      id: 'b1', type: 'MATCHING_FEATURES', instruction: '',
      options: ['A', 'B'],
      features: [
        { id: 'f1', text: 'Feature 1', correctMatch: 'A' },
        { id: 'f2', text: 'Feature 2', correctMatch: 'B' },
      ],
    };
    expect(getBlockQuestionCount(block)).toBe(2);
  });
});

describe('getPassageQuestionCount', () => {
  it('sums question counts across all blocks', () => {
    const passage: Passage = {
      id: 'p1', title: 'Passage 1', content: 'Content',
      blocks: [
        {
          id: 'b1', type: 'TFNG', mode: 'TFNG', instruction: '',
          questions: [
            { id: 'q1', statement: 'S1', correctAnswer: 'T' },
            { id: 'q2', statement: 'S2', correctAnswer: 'F' },
          ],
        },
        {
          id: 'b2', type: 'SHORT_ANSWER', instruction: '',
          questions: [
            { id: 'q3', prompt: 'P1', correctAnswer: 'A', answerRule: 'ONE_WORD' },
          ],
        },
      ],
      images: [],
      wordCount: 100,
    };
    expect(getPassageQuestionCount(passage)).toBe(3);
  });
});

describe('getPartQuestionCount', () => {
  it('sums question counts across all blocks in a listening part', () => {
    const part: ListeningPart = {
      id: 'lp1', title: 'Part 1', audioUrl: '',
      pins: [],
      blocks: [
        {
          id: 'b1', type: 'CLOZE', instruction: '', answerRule: 'ONE_WORD',
          questions: [
            { id: 'q1', prompt: 'P1', correctAnswer: 'A' },
            { id: 'q2', prompt: 'P2', correctAnswer: 'B' },
          ],
        },
      ],
    };
    expect(getPartQuestionCount(part)).toBe(2);
  });
});
