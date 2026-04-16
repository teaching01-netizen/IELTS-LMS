import { describe, expect, it } from 'vitest';
import {
  validateBandScoreTable,
  validateRubricWeights,
  validateWordCountRanges,
} from '../validationHelpers';

describe('validationHelpers', () => {
  it('validates passage word count ranges', () => {
    expect(
      validateWordCountRanges({
        optimalMin: 700,
        optimalMax: 1000,
        warningMin: 500,
        warningMax: 1200,
      }),
    ).toEqual([]);

    expect(
      validateWordCountRanges({
        optimalMin: 1000,
        optimalMax: 700,
        warningMin: 500,
        warningMax: 1200,
      }),
    ).toContain('Optimal minimum must be less than optimal maximum.');
  });

  it('validates rubric weights sum to 100', () => {
    expect(validateRubricWeights({ a: 25, b: 25, c: 25, d: 25 })).toEqual([]);
    expect(validateRubricWeights({ a: 40, b: 20, c: 20, d: 10 })).toContain(
      'Rubric weights must sum to 100.',
    );
  });

  it('validates band score tables use IELTS bands', () => {
    expect(validateBandScoreTable({ 39: 9, 35: 8.5, 30: 7 })).toEqual([]);
    expect(validateBandScoreTable({ 39: 9.3, '-1': 8 })).toEqual(
      expect.arrayContaining([
        'Raw scores must be non-negative integers.',
        'Band scores must be between 0 and 9 in 0.5 increments.',
      ]),
    );
  });
});
