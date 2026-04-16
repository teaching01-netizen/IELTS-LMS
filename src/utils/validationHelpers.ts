import type { BandScoreTable, PassageWordCountStandards } from '../types';

const isFiniteNumber = (value: number) => Number.isFinite(value);

export function validateWordCountRanges(ranges: PassageWordCountStandards): string[] {
  const errors: string[] = [];

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

  if (total !== 100) {
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
