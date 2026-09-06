import type { BandScoreTable, PassageWordCountStandards } from '../types';

const isFiniteNumber = (value: number) => Number.isFinite(value);

/**
 * Relative tolerance for rubric-weight totals. IEEE-754 decimal fractions
 * (e.g. 33.3 + 33.3 + 33.4) rarely sum to exactly 100, so strict `!== 100`
 * rejects valid author input; values within EPSILON_OF_100 still display as 100.
 */
export const RUBRIC_WEIGHT_EPSILON = 0.01;

export function validateWordCountRanges(ranges: PassageWordCountStandards): string[] {
  const errors: string[] = [];

  const values = [
    ranges.optimalMin,
    ranges.optimalMax,
    ranges.warningMin,
    ranges.warningMax,
  ];
  if (values.some((value) => !isFiniteNumber(value))) {
    errors.push('Word count ranges must be finite numbers.');
    return errors;
  }

  if (ranges.optimalMin >= ranges.optimalMax) {
    errors.push('Optimal minimum must be less than optimal maximum.');
  }

  if (ranges.warningMin >= ranges.warningMax) {
    errors.push('Warning minimum must be less than warning maximum.');
  }

  if (ranges.warningMin > ranges.optimalMin) {
    errors.push('Warning minimum must be less than or equal to optimal minimum.');
  }

  if (ranges.warningMax < ranges.optimalMax) {
    errors.push('Warning maximum must be greater than or equal to optimal maximum.');
  }

  return errors;
}

export function validateRubricWeights<T extends object>(weights: T): string[] {
  const errors: string[] = [];
  const numericWeights = Object.values(weights as Record<string, number>);
  const total = numericWeights.reduce((sum, value) => sum + value, 0);

  if (numericWeights.some((value) => !isFiniteNumber(value) || value < 0)) {
    errors.push('Rubric weights must be non-negative numbers.');
  }

  if (Math.abs(total - 100) > RUBRIC_WEIGHT_EPSILON) {
    errors.push('Rubric weights must sum to 100.');
  }

  return errors;
}

export function validateBandScoreTable(table: BandScoreTable): string[] {
  const errors = new Set<string>();

  Object.entries(table).forEach(([rawScore, band]) => {
    const raw = Number(rawScore);
    if (!Number.isInteger(raw) || raw < 0) {
      errors.add('Raw scores must be non-negative integers.');
    }

    if (!isFiniteNumber(band) || band < 0 || band > 9 || Math.round(band * 2) !== band * 2) {
      errors.add('Band scores must be between 0 and 9 in 0.5 increments.');
    }
  });

  return Array.from(errors);
}
