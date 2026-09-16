import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultSatAnnotationEducationState } from '../domain/satAnnotationEducation';
import {
  loadSatAnnotationEducation,
  satAnnotationEducationKey,
  satAnnotationEducationPreviewKey,
  saveSatAnnotationEducation,
} from './satAnnotationEducationStore';

beforeEach(() => {
  window.localStorage.clear();
});

describe('satAnnotationEducationStore', () => {
  it('scopes memory per attempt and keeps previews off the student key family', () => {
    expect(satAnnotationEducationKey('schedule-1', 'attempt-1')).toBe('sat-annotation-education:v1:schedule-1:attempt-1');
    expect(satAnnotationEducationKey('schedule-1', 'attempt-2')).not.toBe(satAnnotationEducationKey('schedule-1', 'attempt-1'));
    // A staff preview must never consume a student's first-run cues.
    expect(satAnnotationEducationPreviewKey('exam-9')).not.toBe(satAnnotationEducationKey('exam-9', 'exam-9'));
  });

  it('round-trips teaching state', () => {
    const key = satAnnotationEducationKey('s', 'a');
    const state = { ...createDefaultSatAnnotationEducationState(), sawHighlightHint: true, lastHighlightColor: 'pink' as const };
    expect(saveSatAnnotationEducation(key, state)).toBe(true);
    expect(loadSatAnnotationEducation(key)).toEqual(state);
  });

  it('reads a missing key as untaught', () => {
    expect(loadSatAnnotationEducation(satAnnotationEducationKey('s', 'missing'))).toEqual(createDefaultSatAnnotationEducationState());
  });

  it('clears corrupt data instead of failing the exam', () => {
    const key = satAnnotationEducationKey('s', 'a');
    window.localStorage.setItem(key, '{not json');
    expect(loadSatAnnotationEducation(key)).toEqual(createDefaultSatAnnotationEducationState());
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
