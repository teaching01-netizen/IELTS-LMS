import { describe, expect, it } from 'vitest';
import {
  emptySatExamToolPolicy,
  resolveSatExamToolPolicy,
  toSatToolCapabilities,
} from './satToolPolicy';

describe('resolveSatExamToolPolicy', () => {
  it('grants annotation tools in Reading and Writing without any calculator', () => {
    expect(resolveSatExamToolPolicy('reading-writing', [])).toMatchObject({
      highlight: true,
      underline: true,
      notes: true,
      lineReader: true,
      passageExpand: true,
      calculator: false,
      referenceSheet: false,
      markForReview: true,
      optionEliminator: true,
      displaySettings: true,
      contentZoom: true,
      contrast: true,
      imageZoom: true,
    });
  });

  it('grants calculator and reference in Math only when the module policy advertises them', () => {
    expect(
      resolveSatExamToolPolicy('math', ['calculator', 'reference_sheet']),
    ).toMatchObject({
      highlight: false,
      underline: false,
      notes: false,
      lineReader: false,
      passageExpand: false,
      calculator: true,
      referenceSheet: true,
    });
    expect(resolveSatExamToolPolicy('math', [])).toMatchObject({
      calculator: false,
      referenceSheet: false,
    });
    expect(resolveSatExamToolPolicy('math', ['calculator'])).toMatchObject({
      calculator: true,
      referenceSheet: false,
    });
  });

  it('never grants math tools in Reading and Writing even when advertised', () => {
    expect(
      resolveSatExamToolPolicy('reading-writing', ['calculator', 'reference_sheet']),
    ).toMatchObject({ calculator: false, referenceSheet: false });
  });

  it('accepts object-form tool policies', () => {
    expect(
      resolveSatExamToolPolicy('math', { calculator: true, reference_sheet: true }),
    ).toMatchObject({ calculator: true, referenceSheet: true });
  });

  it('keeps an all-false empty policy and adapts to the legacy pair', () => {
    const empty = emptySatExamToolPolicy();
    expect(Object.values(empty).every((value) => value === false)).toBe(true);
    expect(
      toSatToolCapabilities(resolveSatExamToolPolicy('math', ['calculator'])),
    ).toEqual({ calculator: true, referenceSheet: false });
  });
});
