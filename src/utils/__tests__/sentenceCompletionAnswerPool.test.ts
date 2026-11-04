import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SentenceCompletionQuestion } from '../../types';
import {
  countUniqueSharedSentenceKeys,
  createSharedSentencePoolMatcher,
  getEffectiveSentenceAcceptedAnswers,
  getSharedSentenceAnswerPool,
  mergeSharedSentenceAnswerPool,
  type SharedAnswerPoolQuestion,
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

  it('counts distinct keys with exact case by default', () => {
    const question = buildQuestion({
      acceptAnyAnswerKey: true,
      sharedAcceptedAnswers: ['Physical Chemistry', 'physical-chemistry', 'THERMODYNAMICS'],
      blanks: [
        { id: 'blank-1', position: 0, correctAnswer: '', acceptedAnswers: [] },
        { id: 'blank-2', position: 1, correctAnswer: '', acceptedAnswers: [] },
      ],
    });

    expect(countUniqueSharedSentenceKeys(question)).toBe(3);
  });

  it('folds case when the whole pool opts out', () => {
    const question = buildQuestion({
      acceptAnyAnswerKey: true,
      sharedAcceptedAnswers: ['Physical Chemistry', 'physical chemistry', 'THERMODYNAMICS'],
      blanks: [
        { id: 'blank-1', position: 0, correctAnswer: '', acceptedAnswers: [], caseSensitive: false },
        { id: 'blank-2', position: 1, correctAnswer: '', acceptedAnswers: [], caseSensitive: false },
      ],
    });

    expect(countUniqueSharedSentenceKeys(question)).toBe(2);
  });

  it('folds pool de-duplication only for an explicit opt-out pool', () => {
    const strictPool = buildQuestion({
      acceptAnyAnswerKey: true,
      sharedAcceptedAnswers: ['Garden', 'garden'],
      blanks: [],
    });
    expect(getSharedSentenceAnswerPool(strictPool)).toEqual(['Garden', 'garden']);

    const optOutPool = buildQuestion({
      acceptAnyAnswerKey: true,
      caseSensitive: false,
      sharedAcceptedAnswers: ['Garden', 'garden'],
      blanks: [],
    });
    expect(getSharedSentenceAnswerPool(optOutPool)).toEqual(['Garden']);
    expect(countUniqueSharedSentenceKeys(optOutPool)).toBe(1);
  });

  it('allows permutations but consumes one matching key only once', () => {
    const permuted = createSharedSentencePoolMatcher(['alpha', 'beta']);
    expect([permuted.match('beta'), permuted.match('alpha')]).toEqual([true, true]);

    const repeated = createSharedSentencePoolMatcher(['alpha', 'beta']);
    expect([repeated.match('alpha'), repeated.match('alpha')]).toEqual([true, false]);

    const unknown = createSharedSentencePoolMatcher(['alpha', 'beta']);
    expect([unknown.match('unknown'), unknown.match('alpha')]).toEqual([false, true]);
  });

  it('requires exact case by default while normalizing formatting and leaving empty values unmatched', () => {
    const answers = ['  ALPHA ', '', null, 'physical-chemistry'];

    const strict = createSharedSentencePoolMatcher(['alpha', 'physical chemistry']);
    expect(answers.map((answer) => strict.match(answer))).toEqual([false, false, false, true]);

    const optOut = createSharedSentencePoolMatcher(['alpha', 'physical chemistry']);
    expect(answers.map((answer) => optOut.match(answer, false))).toEqual([true, false, false, true]);
  });

  it('does not consume a case-variant sibling when one key is used', () => {
    const strict = createSharedSentencePoolMatcher(['Garden', 'garden']);
    expect(strict.match('Garden', true)).toBe(true);
    expect(strict.match('garden', true)).toBe(true);
    expect(strict.match('GARDEN', true)).toBe(false);

    const mixed = createSharedSentencePoolMatcher(['Garden', 'garden']);
    expect(mixed.match('garden', false)).toBe(true);
    // The sibling entry is still available under its own exact form.
    expect(mixed.match('garden', true)).toBe(true);
  });

  it('seeds a shared pool with case-distinct authoring variants even when opted out', () => {
    const question = buildQuestion({
      acceptAnyAnswerKey: true,
      caseSensitive: false,
      blanks: [
        { id: 'blank-1', position: 0, correctAnswer: 'Garden' },
        { id: 'blank-2', position: 1, correctAnswer: 'garden' },
      ],
    });

    expect(mergeSharedSentenceAnswerPool(question)).toEqual(['Garden', 'garden']);
    // Grading still folds the opt-out pool into one usable key.
    expect(getSharedSentenceAnswerPool(question)).toEqual(['Garden']);
  });
});

describe('shared pool consumption fixture (shared grading contract)', () => {
  interface SharedPoolCase {
    id: string;
    pool: string[];
    blanks: Array<{ caseSensitive: boolean; answer: string }>;
    expectedPoolSize: number;
    expected: boolean[];
  }

  const fixture = JSON.parse(
    readFileSync('testdata/objective-grading-parity/shared-pool-consumption.json', 'utf8'),
  ) as { cases: SharedPoolCase[] };

  it.each(fixture.cases)('$id', (testCase) => {
    const question: SharedAnswerPoolQuestion = {
      acceptAnyAnswerKey: true,
      sharedAcceptedAnswers: testCase.pool,
      blanks: testCase.blanks.map((blank, index) => ({
        id: `b${index}`,
        position: index,
        correctAnswer: '',
        caseSensitive: blank.caseSensitive,
      })),
    };

    const pool = getSharedSentenceAnswerPool(question);
    expect(pool).toHaveLength(testCase.expectedPoolSize);

    const matcher = createSharedSentencePoolMatcher(pool);
    expect(testCase.blanks.map((blank) => matcher.match(blank.answer, blank.caseSensitive)))
      .toEqual(testCase.expected);
  });
});
