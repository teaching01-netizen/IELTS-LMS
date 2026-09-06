import { describe, expect, it } from 'vitest';
import {
  calculateBandScore,
  calculateOverallBand,
  roundOverallBand,
  toRoman,
} from '../examUtils';
import type { ExamConfig } from '../../types';

function configWith(enabled: Record<string, boolean>, rounding: 'nearest-0.5' | 'floor' | 'ceil' = 'nearest-0.5'): ExamConfig {
  const sections = Object.fromEntries(
    ['listening', 'reading', 'writing', 'speaking'].map((key) => [key, { enabled: !!enabled[key] }]),
  );
  return { sections, scoring: { overallRounding: rounding } } as unknown as ExamConfig;
}

describe('toRoman', () => {
  it('maps indices 0..11 to i..xii', () => {
    const numerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
    numerals.forEach((want, index) => expect(toRoman(index)).toBe(want));
  });
  it('falls back to the decimal string out of range', () => {
    expect(toRoman(12)).toBe('12');
    expect(toRoman(-1)).toBe('-1');
  });
});

describe('calculateBandScore', () => {
  const table = { 0: 0, 10: 4, 20: 5.5, 30: 7 };
  it('picks the greatest raw threshold at or below the score', () => {
    expect(calculateBandScore(35, table)).toBe(7);
    expect(calculateBandScore(30, table)).toBe(7);
    expect(calculateBandScore(25, table)).toBe(5.5);
    expect(calculateBandScore(10, table)).toBe(4);
  });
  it('returns 0 below the lowest threshold', () => {
    expect(calculateBandScore(-1, { 0: 0, 10: 4 })).toBe(0);
    expect(calculateBandScore(0, {})).toBe(0);
  });
});

describe('roundOverallBand', () => {
  it.each([
    [6.25, 6.5],
    [6.24, 6.0],
    [6.75, 7.0],
  ])('rounds %s to nearest half as %s', (input, want) => {
    expect(roundOverallBand(input, 'nearest-0.5')).toBe(want);
  });
  it('floors and ceils', () => {
    expect(roundOverallBand(6.9, 'floor')).toBe(6);
    expect(roundOverallBand(6.1, 'ceil')).toBe(7);
  });
});

describe('calculateOverallBand', () => {
  it('averages only enabled sections', () => {
    const config = configWith({ listening: true, reading: true });
    expect(calculateOverallBand({ listening: 6, reading: 8, writing: 9, speaking: 9 }, config)).toBe(7);
  });
  it('returns 0 when no section is enabled', () => {
    expect(calculateOverallBand({ listening: 6 }, configWith({}))).toBe(0);
  });
  it('treats undefined scores as 0', () => {
    const config = configWith({ listening: true, reading: true });
    // Absent keys are not averaged at all (Object.entries of scores), but a
    // present-but-undefined score coerces to 0 via `score || 0`.
    expect(calculateOverallBand({ listening: 8, reading: undefined }, config)).toBe(4);
    expect(calculateOverallBand({ listening: 8 }, config)).toBe(8);
  });
});
