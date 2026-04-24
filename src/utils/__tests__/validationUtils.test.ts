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
});

