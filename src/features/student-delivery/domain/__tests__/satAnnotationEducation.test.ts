import { describe, expect, it } from 'vitest';
import {
  SAT_ANNOTATION_CUE_MS,
  createDefaultSatAnnotationEducationState,
  normalizeSatAnnotationEducationState,
  satAnnotationHintRetired,
  shouldShowSatAnnotationHint,
} from '../satAnnotationEducation';

/** The ordinary case: an armed R&W question with nothing happening yet. */
function context(overrides: Partial<Parameters<typeof shouldShowSatAnnotationHint>[1]> = {}) {
  return {
    annotationsAvailable: true,
    blocked: false,
    modeEnabled: true,
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

  // The cue answers "what did I just turn on?", so it is tied to the mode and to
  // nothing else. An unarmed exam teaches nothing — there is no gesture to
  // teach, and the labeled control is what teaches it.
  it('never appears while annotation is unarmed, however fresh the student is', () => {
    const fresh = createDefaultSatAnnotationEducationState();
    expect(shouldShowSatAnnotationHint(fresh, context({ modeEnabled: false }))).toBe(false);
    // Nor for a student who has never annotated and is on question one: the cue
    // is the consequence of arming, not an alert that fires on load.
    expect(shouldShowSatAnnotationHint(fresh, context({ modeEnabled: false, answered: false }))).toBe(false);
  });

  it('is a bounded cue, not a permanent line: its lifetime is a constant', () => {
    expect(SAT_ANNOTATION_CUE_MS).toBe(3000);
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
    expect(shouldShowSatAnnotationHint({ ...fresh, createdFirstHighlight: true }, context())).toBe(false);
  });

  it('keeps teaching across repeated activations until the student annotates', () => {
    const fresh = createDefaultSatAnnotationEducationState();
    // Arm, disarm, arm: the cue is offered every time, because the student still
    // has not annotated anything. Once they do, it never returns.
    expect(shouldShowSatAnnotationHint(fresh, context({ modeEnabled: true }))).toBe(true);
    expect(shouldShowSatAnnotationHint(fresh, context({ modeEnabled: false }))).toBe(false);
    expect(shouldShowSatAnnotationHint(fresh, context({ modeEnabled: true }))).toBe(true);
    const learned = { ...fresh, createdFirstHighlight: true, lastHighlightColor: 'yellow' as const };
    expect(shouldShowSatAnnotationHint(learned, context({ modeEnabled: true }))).toBe(false);
    expect(shouldShowSatAnnotationHint(learned, context({ modeEnabled: false }))).toBe(false);
  });

  it('hides the cue on questions without the annotation surface', () => {
    expect(
      shouldShowSatAnnotationHint(
        createDefaultSatAnnotationEducationState(),
        context({ annotationsAvailable: false, modeEnabled: true }),
      ),
    ).toBe(false);
  });
});
