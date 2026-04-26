import { describe, expect, it } from 'vitest';
import {
  getStudentFontSizeLabel,
  getStudentTypographyScale,
} from '../accessibilityScale';

describe('student accessibility scale', () => {
  it('returns progressively larger typography tokens for each font size', () => {
    const small = getStudentTypographyScale('small');
    const normal = getStudentTypographyScale('normal');
    const large = getStudentTypographyScale('large');

    expect(small.fontScale).toBeLessThan(normal.fontScale);
    expect(normal.fontScale).toBeLessThan(large.fontScale);
    expect(small.rootFontSize).toContain('clamp');
    expect(normal.rootFontSize).toContain('clamp');
    expect(large.rootFontSize).toContain('clamp');
    expect(small.controlFontSize).not.toBe(large.controlFontSize);
    expect(normal.chipFontSize).not.toBe(small.chipFontSize);
    expect(getStudentFontSizeLabel('normal')).toBe('Medium');
  });
});
