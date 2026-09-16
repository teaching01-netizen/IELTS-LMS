import { describe, expect, it } from 'vitest';
import {
  createDefaultSatAnnotationEducationState,
  normalizeSatAnnotationEducationState,
  shouldShowSatAnnotationHint,
} from '../satAnnotationEducation';

describe('satAnnotationEducation', () => {
  it('defaults to "nothing taught yet" with yellow as the remembered ink', () => {
    expect(createDefaultSatAnnotationEducationState()).toEqual({
      sawHighlightHint: false,
      createdFirstHighlight: false,
      createdFirstNote: false,
      lastHighlightColor: 'yellow',
    });
  });

  it('repairs unknown shapes to defaults instead of throwing', () => {
    const expected = createDefaultSatAnnotationEducationState();
    for (const value of [null, undefined, 'gone', 42, []]) {
      expect(normalizeSatAnnotationEducationState(value)).toEqual(expected);
    }
    // A future-shaped record keeps the flags it understands and drops the rest.
    expect(normalizeSatAnnotationEducationState({
      sawHighlightHint: true,
      createdFirstHighlight: 'yes',
      createdFirstNote: true,
      lastHighlightColor: 'chartreuse',
      futureField: 1,
    })).toEqual({
      sawHighlightHint: true,
      createdFirstHighlight: false,
      createdFirstNote: true,
      lastHighlightColor: 'yellow',
    });
  });

  it('only teaches on an interactive question that advertises the tools', () => {
    const fresh = createDefaultSatAnnotationEducationState();
    const context = { annotationsAvailable: true, blocked: false, hasSelection: false, answered: false };
    expect(shouldShowSatAnnotationHint(fresh, context)).toBe(true);
    expect(shouldShowSatAnnotationHint(fresh, { ...context, annotationsAvailable: false })).toBe(false);
    expect(shouldShowSatAnnotationHint(fresh, { ...context, blocked: true })).toBe(false);
    expect(shouldShowSatAnnotationHint({ ...fresh, sawHighlightHint: true }, context)).toBe(false);
  });

  it('retires the hint the moment the student selects text or answers', () => {
    const fresh = createDefaultSatAnnotationEducationState();
    const context = { annotationsAvailable: true, blocked: false, hasSelection: false, answered: false };
    // A live selection means the gesture has been demonstrated.
    expect(shouldShowSatAnnotationHint(fresh, { ...context, hasSelection: true })).toBe(false);
    // Beginning to answer is equally decisive: the exam has their attention.
    expect(shouldShowSatAnnotationHint(fresh, { ...context, answered: true })).toBe(false);
  });

  it.each([
    ['shown once already', { sawHighlightHint: true }, true],
    ['annotations unavailable (Math)', { sawHighlightHint: false }, false],
  ])('hides the passive hint when %s', (_label, overrides, annotationsAvailable) => {
    expect(shouldShowSatAnnotationHint(
      { ...createDefaultSatAnnotationEducationState(), ...overrides },
      { annotationsAvailable, blocked: false, hasSelection: false, answered: false },
    )).toBe(false);
  });
});
