import { describe, expect, it } from 'vitest';
import {
  getStudentFontSizeLabel,
  getStudentTypographyScale,
  getStudentPassageReadabilityGeometry,
  getStudentPassageReadabilityLabel,
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

  it('maps passage readability levels to orthogonal line-height and measure geometry', () => {
    const compact = getStudentPassageReadabilityGeometry(0);
    const comfort = getStudentPassageReadabilityGeometry(1);
    const extraLarge = getStudentPassageReadabilityGeometry(2);

    expect(compact.lineHeightFactor).toBeLessThan(comfort.lineHeightFactor);
    expect(comfort.lineHeightFactor).toBeLessThan(extraLarge.lineHeightFactor);
    expect(comfort.lineHeightFactor).toBe(1);

    expect(compact.measure).toBe('74ch');
    expect(comfort.measure).toBe('68ch');
    expect(extraLarge.measure).toBe('60ch');
    expect(compact.measure).not.toBe(comfort.measure);
  });

  it('clamps out-of-range readability levels before resolving geometry', () => {
    expect(getStudentPassageReadabilityGeometry(-3)).toEqual(
      getStudentPassageReadabilityGeometry(0),
    );
    expect(getStudentPassageReadabilityGeometry(9)).toEqual(
      getStudentPassageReadabilityGeometry(2),
    );
    expect(getStudentPassageReadabilityGeometry(0.4)).toEqual(
      getStudentPassageReadabilityGeometry(0),
    );
  });

  it('exposes readable labels for every passage layout', () => {
    expect(getStudentPassageReadabilityLabel(0)).toBe('Compact');
    expect(getStudentPassageReadabilityLabel(1)).toBe('Comfort');
    expect(getStudentPassageReadabilityLabel(2)).toBe('Extra Large');
  });
});
