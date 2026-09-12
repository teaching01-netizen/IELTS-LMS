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
    expect(small.controlFontSize).not.toBe(large.controlFontSize);
    expect(normal.chipFontSize).not.toBe(small.chipFontSize);
    expect(getStudentFontSizeLabel('normal')).toBe('Medium');
  });

  it('uses fixed rem values with no viewport-dependent units (P1.1)', () => {
    const sizes = ['small', 'normal', 'large'] as const;
    const viewportDependent = /vw|vmin|vmax|clamp\(/;
    for (const size of sizes) {
      const scale = getStudentTypographyScale(size);
      for (const [key, value] of Object.entries(scale)) {
        if (typeof value !== 'string' || key === 'rootFontSize') continue;
        expect(value, `${size}.${key} must not depend on viewport width`).not.toMatch(viewportDependent);
      }
    }
  });

  it('resolves the design-contract role targets at normal size', () => {
    const normal = getStudentTypographyScale('normal');
    // 18px passage, 16px answer, 15px control, 26px title, 17px question stem.
    expect(normal.passageFontSize).toBe('1.125rem');
    expect(normal.answerFontSize).toBe('1rem');
    expect(normal.answerLineHeight).toBe('1.45');
    expect(normal.controlFontSize).toBe('0.9375rem');
    expect(normal.passageTitleFontSize).toBe('1.625rem');
    expect(normal.questionFontSize).toBe('1.0625rem');
    // Writing editor and prompt share the passage family target (18/1.68).
    expect(normal.writingEditorFontSize).toBe('1.125rem');
    expect(normal.writingEditorLineHeight).toBe('1.68');
    expect(normal.writingPromptFontSize).toBe('1.125rem');
    expect(normal.writingPromptLineHeight).toBe('1.68');
  });

  it('keeps the root font size at the browser default so zoom stays independent', () => {
    for (const size of ['small', 'normal', 'large'] as const) {
      expect(getStudentTypographyScale(size).rootFontSize).toBe('1rem');
    }
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
