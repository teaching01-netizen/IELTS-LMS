import { describe, expect, test } from 'vitest';
import {
  getCaseMismatchIndexes,
  getClosestAcceptedAnswer,
  getStudentAnswerComparison,
} from '../studentAnswerComparison';

describe('student answer comparison', () => {
  test('prefers the primary answer when it ties with another accepted variant', () => {
    expect(getClosestAcceptedAnswer(
      'faces of China',
      'Faces of China',
      ['faces of china', 'FACES OF CHINA', 'Faces of China'],
    )).toBe('Faces of China');
  });

  test('chooses the closest accepted variant when the primary answer is farther away', () => {
    expect(getClosestAcceptedAnswer(
      'Garden hall',
      'GARDEN HALL',
      ['GARDEN HALL', 'garden hall', 'Garden Hall'],
    )).toBe('garden hall');
  });

  test('does not explain an answer that exactly matches an accepted variant', () => {
    expect(getStudentAnswerComparison(
      'Garden hall',
      'GARDEN HALL',
      ['GARDEN HALL', 'Garden hall'],
    )).toBeNull();
  });

  test('marks only the differing student character against the selected answer', () => {
    expect([...getCaseMismatchIndexes('faces of China', 'Faces of China')]).toEqual([0]);
  });
});
