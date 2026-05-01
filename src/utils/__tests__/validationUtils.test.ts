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
});
