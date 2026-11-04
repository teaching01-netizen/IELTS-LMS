import { describe, expect, it } from 'vitest';
import {
  answersMatch,
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

  it('normalizes punctuation and ignores case', () => {
    expect(normalizeAnswerForMatching('HALF-WAY')).toBe(
      normalizeAnswerForMatching('HALF WAY'),
    );
    expect(normalizeAnswerForMatching('Garden hall')).toBe(
      normalizeAnswerForMatching('GARDEN HALL'),
    );
  });

  it('removes invisible characters before matching (exact case by default)', () => {
    expect(answersMatch('waiter', 'waiter\u200B')).toBe(true);
    expect(answersMatch('Gar\u00ADden\u2060 hall', 'Garden hall')).toBe(true);
    expect(answersMatch('Gar\u00ADden\u2060 hall', 'garden hall')).toBe(false);
  });

  it('does not match an empty student answer to an empty key', () => {
    expect(answersMatch('   ', '')).toBe(false);
  });
});
