import { describe, expect, it } from 'vitest';
import type { SentenceCompletionQuestion } from '../../types';
import {
  countUniqueSharedSentenceKeys,
  getEffectiveSentenceAcceptedAnswers,
  getSharedSentenceAnswerPool,
  matchSharedSentenceAnswers,
  mergeSharedSentenceAnswerPool,
} from '../sentenceCompletionAnswerPool';

function buildQuestion(
  overrides: Partial<SentenceCompletionQuestion> = {},
): SentenceCompletionQuestion {
  return {
    id: 'sentence-1',
    sentence: 'The ____ answer is ____.',
    answerRule: 'ONE_WORD',
    blanks: [
      { id: 'blank-1', position: 0, correctAnswer: 'alpha', acceptedAnswers: ['alpha'] },
    ],
    ...overrides,
  };
}

describe('sentence completion shared answer pool', () => {
  it('keeps legacy questions in per-blank mode', () => {
    const question = buildQuestion({
      blanks: [
        { id: 'blank-1', position: 0, correctAnswer: 'alpha', acceptedAnswers: ['alpha', 'a'] },
        { id: 'blank-2', position: 1, correctAnswer: 'beta', acceptedAnswers: ['beta', 'b'] },
      ],
    });

    expect(getEffectiveSentenceAcceptedAnswers(question, 0)).toEqual(['alpha', 'a']);
    expect(getEffectiveSentenceAcceptedAnswers(question, 1)).toEqual(['beta', 'b']);
  });

  it('derives the shared pool from all blank keys when the optional pool is absent', () => {
    const question = buildQuestion({
      acceptAnyAnswerKey: true,
      blanks: [
        { id: 'blank-1', position: 0, correctAnswer: 'alpha', acceptedAnswers: ['alpha'] },
        { id: 'blank-2', position: 1, correctAnswer: 'beta', acceptedAnswers: ['beta'] },
      ],
    });

    expect(getSharedSentenceAnswerPool(question)).toEqual(['alpha', 'beta']);
    expect(getEffectiveSentenceAcceptedAnswers(question, 0)).toEqual(['alpha', 'beta']);
    expect(getEffectiveSentenceAcceptedAnswers(question, 1)).toEqual(['alpha', 'beta']);
  });

  it('deduplicates a derived pool by accepted-key normalization while preserving case variants', () => {
    const question = buildQuestion({
      acceptAnyAnswerKey: true,
      blanks: [
        { id: 'blank-1', position: 0, correctAnswer: 'Physical Chemistry', acceptedAnswers: ['Physical Chemistry'] },
        { id: 'blank-2', position: 1, correctAnswer: 'physical-chemistry', acceptedAnswers: ['physical-chemistry', 'THERMODYNAMICS'] },
      ],
    });

    expect(getSharedSentenceAnswerPool(question)).toEqual([
      'Physical Chemistry',
      'physical-chemistry',
      'THERMODYNAMICS',
    ]);
  });

  it('preserves case variants when deriving the shared pool from blank keys', () => {
    const question = buildQuestion({
      acceptAnyAnswerKey: true,
      blanks: [
        {
          id: 'blank-1',
          position: 0,
          correctAnswer: 'physical chemistry',
          acceptedAnswers: ['Physical Chemistry', 'PHYSICAL CHEMISTRY'],
        },
        {
          id: 'blank-2',
          position: 1,
          correctAnswer: 'Thermodynamics',
          acceptedAnswers: ['THERMODYNAMICS', 'thermodynamics'],
        },
      ],
    });

    expect(getSharedSentenceAnswerPool(question)).toEqual([
      'physical chemistry',
      'Physical Chemistry',
      'PHYSICAL CHEMISTRY',
      'Thermodynamics',
      'THERMODYNAMICS',
      'thermodynamics',
    ]);
  });

  it('merges a saved shared pool with newly discovered blank keys', () => {
    const question = buildQuestion({
      acceptAnyAnswerKey: true,
      sharedAcceptedAnswers: ['alpha'],
      blanks: [
        { id: 'blank-1', position: 0, correctAnswer: 'alpha', acceptedAnswers: ['ALPHA'] },
        { id: 'blank-2', position: 1, correctAnswer: 'beta', acceptedAnswers: ['BETA'] },
      ],
    });

    expect(mergeSharedSentenceAnswerPool(question)).toEqual(['alpha', 'ALPHA', 'beta', 'BETA']);
  });

  it('treats an explicitly empty shared pool as authoritative', () => {
    const question = buildQuestion({
      acceptAnyAnswerKey: true,
      sharedAcceptedAnswers: [],
      blanks: [{ id: 'blank-1', position: 0, correctAnswer: 'alpha', acceptedAnswers: ['alpha'] }],
    });

    expect(getSharedSentenceAnswerPool(question)).toEqual([]);
    expect(getEffectiveSentenceAcceptedAnswers(question, 0)).toEqual([]);
    expect(mergeSharedSentenceAnswerPool(question)).toEqual([]);
  });

  it('counts case-insensitive normalized keys once', () => {
    const question = buildQuestion({
      acceptAnyAnswerKey: true,
      sharedAcceptedAnswers: ['Physical Chemistry', 'physical-chemistry', 'THERMODYNAMICS'],
      blanks: [
        { id: 'blank-1', position: 0, correctAnswer: '', acceptedAnswers: [] },
        { id: 'blank-2', position: 1, correctAnswer: '', acceptedAnswers: [] },
      ],
    });

    expect(countUniqueSharedSentenceKeys(question)).toBe(2);
  });

  it('allows permutations but consumes one matching key only once', () => {
    expect(matchSharedSentenceAnswers(['beta', 'alpha'], ['alpha', 'beta'])).toEqual([true, true]);
    expect(matchSharedSentenceAnswers(['alpha', 'alpha'], ['alpha', 'beta'])).toEqual([true, false]);
    expect(matchSharedSentenceAnswers(['unknown', 'alpha'], ['alpha', 'beta'])).toEqual([false, true]);
  });

  it('normalizes non-empty student values and leaves empty values unmatched', () => {
    expect(
      matchSharedSentenceAnswers(
        ['  ALPHA ', '', null, 'physical-chemistry'],
        ['alpha', 'physical chemistry'],
      ),
    ).toEqual([true, false, false, true]);
  });
});
