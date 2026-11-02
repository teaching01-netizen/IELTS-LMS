import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answersMatch, answersMatchCaseExact, normalizeAnswerForMatching } from '../acceptedAnswers';

interface AnswerCleaningFixture {
  matchPairs: Array<{ name: string; student: string; key: string; match: boolean }>;
  caseExactPairs: Array<{ name: string; student: string; excluded: string; match: boolean }>;
  idempotent: string[];
}

const fixture = JSON.parse(
  readFileSync('testdata/objective-grading-parity/answer-cleaning.json', 'utf8'),
) as AnswerCleaningFixture;

describe('shared answer-cleaning fixture', () => {
  it.each(fixture.matchPairs)('$name', ({ student, key, match }) => {
    expect(answersMatch(student, key)).toBe(match);
  });

  it.each(fixture.caseExactPairs)('$name', ({ student, excluded, match }) => {
    expect(answersMatchCaseExact(student, excluded)).toBe(match);
  });

  it.each(fixture.idempotent)('is idempotent for %s', (value) => {
    const cleaned = normalizeAnswerForMatching(value);
    expect(normalizeAnswerForMatching(cleaned)).toBe(cleaned);
  });
});
