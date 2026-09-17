import { describe, expect, it } from 'vitest';
import * as education from '../satAnnotationEducation';
import {
  SAT_ANNOTATION_HINT_DELAY_MS,
  createDefaultSatAnnotationEducationState,
  normalizeSatAnnotationEducationState,
  satAnnotationHintDelayMs,
  satAnnotationHintRetired,
  shouldShowSatAnnotationHint,
} from '../satAnnotationEducation';

/** The ordinary case: an interactive R&W question with nothing happening yet. */
function context(overrides: Partial<Parameters<typeof shouldShowSatAnnotationHint>[1]> = {}) {
  return {
    annotationsAvailable: true,
    blocked: false,
    hasSelection: false,
    answered: false,
    hasAnnotations: false,
    ...overrides,
  };
}

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
    expect(shouldShowSatAnnotationHint(fresh, context())).toBe(true);
    expect(shouldShowSatAnnotationHint(fresh, context({ annotationsAvailable: false }))).toBe(false);
    expect(shouldShowSatAnnotationHint(fresh, context({ blocked: true }))).toBe(false);
    expect(shouldShowSatAnnotationHint(fresh, context({ hasSelection: true }))).toBe(false);
    // Beginning to answer is decisive too: the exam has the student's attention.
    expect(shouldShowSatAnnotationHint(fresh, context({ answered: true }))).toBe(false);
  });

  // The pass this replaced put the cue on a five-second clock: it retired itself
  // whether or not anyone had read it, so a slow reader (or anyone who opened
  // Highlights & Notes later) was never taught at all.
  it('keeps teaching until the student demonstrates the gesture, never until a clock runs out', () => {
    const fresh = createDefaultSatAnnotationEducationState();
    expect(shouldShowSatAnnotationHint(fresh, context())).toBe(true);
    expect(satAnnotationHintRetired(fresh)).toBe(false);
    // No elapsed time is an input to this decision, and no show-once duration
    // exists to consume the hint on its own.
    expect('SAT_ANNOTATION_HINT_DURATION_MS' in education).toBe(false);
  });

  it('retires the cue once the student has marked or written something', () => {
    const fresh = createDefaultSatAnnotationEducationState();
    // A mark or a note on this question proves they found the tool.
    expect(shouldShowSatAnnotationHint(fresh, context({ hasAnnotations: true }))).toBe(false);
    // As does any of the recorded first-time flags: the lesson is over.
    expect(satAnnotationHintRetired({ ...fresh, createdFirstHighlight: true })).toBe(true);
    expect(satAnnotationHintRetired({ ...fresh, createdFirstNote: true })).toBe(true);
    expect(satAnnotationHintRetired({ ...fresh, sawHighlightHint: true })).toBe(true);
    expect(shouldShowSatAnnotationHint({ ...fresh, createdFirstNote: true }, context())).toBe(false);
  });

  it('arrives at once when the student asks for the tool, and quietly otherwise', () => {
    // Pressing Highlights & Notes is a direct request: the lesson should already
    // be on screen. On an untouched exam it waits, so it reads as an aside instead
    // of an alert firing on load.
    expect(satAnnotationHintDelayMs(true)).toBe(0);
    expect(satAnnotationHintDelayMs(false)).toBe(SAT_ANNOTATION_HINT_DELAY_MS);
  });

  it.each([
    ['shown once already', { sawHighlightHint: true }, true],
    ['annotations unavailable (Math)', { sawHighlightHint: false }, false],
  ])('hides the passive hint when %s', (_label, overrides, annotationsAvailable) => {
    expect(shouldShowSatAnnotationHint(
      { ...createDefaultSatAnnotationEducationState(), ...overrides },
      context({ annotationsAvailable }),
    )).toBe(false);
  });
});
