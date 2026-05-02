import { describe, expect, it } from 'vitest';
import { validateQuestionBlock } from '../validationUtils';

describe('validateQuestionBlock - placeholder/blanks alignment', () => {
  it('flags sentence completion when blanks do not match ____ placeholders', () => {
    const errors = validateQuestionBlock({
      id: 'blk-1',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentences below.',
      questions: [
        {
          id: 'q-1',
          sentence: 'The ____ is ____.',
          blanks: [{ id: 'b-1', correctAnswer: 'x', position: 0 }],
          answerRule: 'TWO_WORDS',
        },
      ],
    });

    expect(errors.some((e) => e.field.includes('sentence-0-blanks'))).toBe(true);
  });

  it('flags note completion when blanks do not match ____ placeholders', () => {
    const errors = validateQuestionBlock({
      id: 'blk-2',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete the notes below.',
      questions: [
        {
          id: 'q-1',
          noteText: 'The ____ is ____.',
          blanks: [{ id: 'b-1', correctAnswer: 'x', position: 0 }],
          answerRule: 'TWO_WORDS',
        },
      ],
    });

    expect(errors.some((e) => e.field.includes('note-0-blanks'))).toBe(true);
  });

  it('accepts sentence completion blanks when alternatives are provided', () => {
    const errors = validateQuestionBlock({
      id: 'blk-3',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete the sentence.',
      questions: [
        {
          id: 'q-1',
          sentence: 'My favourite animal is ____.',
          blanks: [{ id: 'b-1', correctAnswer: '', acceptedAnswers: ['dog', 'cat'], position: 0 }],
          answerRule: 'ONE_WORD',
        },
      ],
    });

    expect(errors.some((e) => e.field.includes('sentence-0-blank-0'))).toBe(false);
  });

  it('accepts note completion blanks when alternatives are provided', () => {
    const errors = validateQuestionBlock({
      id: 'blk-4',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete the note.',
      questions: [
        {
          id: 'q-1',
          noteText: 'Bring your ____ to the station.',
          blanks: [{ id: 'b-1', correctAnswer: '', acceptedAnswers: ['ticket', 'pass'], position: 0 }],
          answerRule: 'ONE_WORD',
        },
      ],
    });

    expect(errors.some((e) => e.field.includes('note-0-blank-0'))).toBe(false);
  });

  it('accepts short answer when alternatives are provided', () => {
    const errors = validateQuestionBlock({
      id: 'blk-5',
      type: 'SHORT_ANSWER',
      instruction: 'Answer the question.',
      questions: [
        {
          id: 'q-1',
          prompt: 'Name one pet.',
          correctAnswer: '',
          acceptedAnswers: ['dog', 'cat'],
          answerRule: 'ONE_WORD',
        },
      ],
    });

    expect(errors.some((e) => e.field.includes('question-0-answer'))).toBe(false);
  });

  it('flags table completion when placeholders are missing', () => {
    const errors = validateQuestionBlock({
      id: 'blk-6',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Key', 'Value'],
      rows: [['Name', 'Anu'], ['Country', 'India']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'Anu' }],
    });

    expect(errors.some((e) => e.field.includes('rows-placeholders'))).toBe(true);
  });

  it('flags table completion when a single cell has multiple placeholders', () => {
    const errors = validateQuestionBlock({
      id: 'blk-7',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Key', 'Value'],
      rows: [['Name', '____ ____']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'Anu' }],
    });

    expect(errors.some((e) => e.field.includes('placeholder'))).toBe(true);
  });

  it('accepts table completion answers when alternatives are provided', () => {
    const errors = validateQuestionBlock({
      id: 'blk-8',
      type: 'TABLE_COMPLETION',
      instruction: 'Complete the table.',
      answerRule: 'ONE_WORD',
      headers: ['Key', 'Value'],
      rows: [['Name', '____']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: '', acceptedAnswers: ['Anu', 'Anupama'] }],
    });

    expect(errors.some((e) => e.field.includes('cell-0'))).toBe(false);
  });

  it('requires inserted image URL when an image row exists on supported block types', () => {
    const errors = validateQuestionBlock({
      id: 'blk-9',
      type: 'SHORT_ANSWER',
      instruction: 'Answer the question.',
      insertedImages: [{ id: 'img-1', url: '', caption: 'Optional caption' }],
      questions: [
        {
          id: 'q-1',
          prompt: 'Name one pet.',
          correctAnswer: 'dog',
          acceptedAnswers: ['dog'],
          answerRule: 'ONE_WORD',
        },
      ],
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'insertedImages[0].url',
        }),
      ]),
    );
  });

  it('does not validate inserted image slots for map/diagram blocks', () => {
    const errors = validateQuestionBlock({
      id: 'blk-10',
      type: 'MAP',
      instruction: 'Label the map.',
      insertedImages: [{ id: 'img-1', url: '', caption: 'Should be ignored' }],
      assetUrl: 'https://example.com/map.png',
      questions: [{ id: 'q-1', label: 'A', correctAnswer: 'A', x: 50, y: 50 }],
    });

    expect(errors.some((error) => error.field.includes('insertedImages'))).toBe(false);
  });

  it('rejects tree mode required leaves with empty accepted answers', () => {
    const errors = validateQuestionBlock({
      id: 'blk-tree-1',
      type: 'SHORT_ANSWER',
      instruction: 'Tree mode',
      subAnswerModeEnabled: true,
      answerTree: [
        {
          id: 'root-1',
          label: 'Root',
          children: [{ id: 'leaf-1', label: 'Leaf', acceptedAnswers: [], required: true }],
        },
      ],
      questions: [],
    } as any);

    expect(
      errors.some((error) =>
        error.message.includes('must define at least one accepted answer'),
      ),
    ).toBe(true);
  });

  it('auto-repairs duplicate tree node ids for legacy tree blocks', () => {
    const errors = validateQuestionBlock({
      id: 'blk-tree-2',
      type: 'SHORT_ANSWER',
      instruction: 'Tree mode',
      subAnswerModeEnabled: true,
      answerTree: [
        {
          id: 'root-1',
          label: 'Root',
          children: [
            { id: 'dup', label: 'Leaf A', acceptedAnswers: ['a'] },
            { id: 'dup', label: 'Leaf B', acceptedAnswers: ['b'] },
          ],
        },
      ],
      questions: [],
    } as any);

    expect(errors.some((error) => error.message.includes('Duplicate node id'))).toBe(false);
  });

  it('keeps legacy validation behavior when sub-answer mode is disabled', () => {
    const errors = validateQuestionBlock({
      id: 'blk-tree-3',
      type: 'SHORT_ANSWER',
      instruction: 'Legacy mode',
      subAnswerModeEnabled: false,
      answerTree: [],
      questions: [
        {
          id: 'q-1',
          prompt: 'Prompt',
          correctAnswer: 'cat',
          acceptedAnswers: ['cat'],
          answerRule: 'ONE_WORD',
        },
      ],
    } as any);

    expect(errors).toHaveLength(0);
  });
});
