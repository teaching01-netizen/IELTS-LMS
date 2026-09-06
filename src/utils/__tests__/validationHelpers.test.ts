import { describe, expect, it } from 'vitest';
import { validateRubricWeights, validateWordCountRanges } from '../validationHelpers';

describe('validateWordCountRanges', () => {
  it('flags NaN inputs as invalid', () => {
    const errors = validateWordCountRanges({
      optimalMin: Number.NaN,
      optimalMax: 250,
      warningMin: 150,
      warningMax: 300,
    });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts float rubric weights that sum to ~100 within epsilon', () => {
    expect(validateRubricWeights({ a: 33.3, b: 33.3, c: 33.4 })).toEqual([]);
    expect(
      validateRubricWeights({ a: 50, b: 49.9 }).some((message) => message.includes('sum to 100')),
    ).toBe(true);
  });
});

