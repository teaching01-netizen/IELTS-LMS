import { describe, expect, it } from 'vitest';
import {
  normalizeAnswerForMatching,
  resolveAcceptedAnswers,
  sanitizeAcceptedAnswers,
} from '../acceptedAnswers';

describe('acceptedAnswers', () => {
  it('splits pipe-delimited variants from correctAnswer', () => {
    expect(
      resolveAcceptedAnswers({
        correctAnswer: 'graph | triangular graph',
      }),
    ).toEqual(['graph', 'triangular graph']);
  });

  it('splits and deduplicates pipe-delimited acceptedAnswers', () => {
    expect(
      sanitizeAcceptedAnswers(['dog | cat', 'CAT', ' dog ']),
    ).toEqual(['dog', 'cat', 'CAT']);
  });

  it('normalizes case and punctuation for matching', () => {
    expect(normalizeAnswerForMatching('HALF-WAY')).toBe(
      normalizeAnswerForMatching('half way'),
    );
  });
});
