import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES,
  getStudentAccessibilityStorageKey,
  loadStudentAccessibilityPreferences,
  parseStudentAccessibilityPreferences,
  saveStudentAccessibilityPreferences,
  clearStudentAccessibilityPreferences,
} from '../accessibilityPreferences';

describe('student accessibility preference parsing', () => {
  it('returns defaults for nullish or empty input', () => {
    expect(parseStudentAccessibilityPreferences(null)).toEqual(
      DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES,
    );
    expect(parseStudentAccessibilityPreferences(undefined)).toEqual(
      DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES,
    );
    expect(parseStudentAccessibilityPreferences('')).toEqual(
      DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES,
    );
  });

  it('returns defaults for corrupt JSON and non-object payloads', () => {
    expect(parseStudentAccessibilityPreferences('{not json')).toEqual(
      DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES,
    );
    expect(parseStudentAccessibilityPreferences('"just a string"')).toEqual(
      DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES,
    );
    expect(parseStudentAccessibilityPreferences('42')).toEqual(
      DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES,
    );
  });

  it('round-trips a valid preference payload', () => {
    const parsed = parseStudentAccessibilityPreferences(
      JSON.stringify({
        fontSize: 'large',
        highContrast: true,
        zoom: 1.3,
        passageReadabilityLevel: 2,
        playbackRate: 1.25,
      }),
    );

    expect(parsed.fontSize).toBe('large');
    expect(parsed.highContrast).toBe(true);
    expect(parsed.zoom).toBe(1.3);
    expect(parsed.passageReadabilityLevel).toBe(2);
    expect(parsed.playbackRate).toBe(1.25);
  });

  it('clamps out-of-range numbers per field', () => {
    const parsed = parseStudentAccessibilityPreferences(
      JSON.stringify({
        fontSize: 'gigantic',
        highContrast: 'yes',
        zoom: 99,
        passageReadabilityLevel: -4,
        playbackRate: 2,
      }),
    );

    expect(parsed.fontSize).toBe('normal');
    expect(parsed.highContrast).toBe(false);
    expect(parsed.zoom).toBe(1.5);
    expect(parsed.passageReadabilityLevel).toBe(0);
    expect(parsed.playbackRate).toBe(1);
  });

  it('clamps zoom below the minimum', () => {
    const parsed = parseStudentAccessibilityPreferences(
      JSON.stringify({ zoom: 0.01 }),
    );
    expect(parsed.zoom).toBe(0.85);
  });

  it('ignores unknown fields from future schema versions', () => {
    const parsed = parseStudentAccessibilityPreferences(
      JSON.stringify({ fontSize: 'small', darkMode: true, layout: 'split' }),
    );
    expect(parsed.fontSize).toBe('small');
    expect(parsed.zoom).toBe(1);
  });
});

describe('student accessibility storage key', () => {
  it('scopes the key to schedule and candidate', () => {
    expect(getStudentAccessibilityStorageKey('sched-1', 'cand-7')).toBe(
      'student-accessibility:sched-1:cand-7',
    );
  });

  it('falls back to local/device keys without identity', () => {
    expect(getStudentAccessibilityStorageKey(undefined, undefined)).toBe(
      'student-accessibility:local:device',
    );
    expect(getStudentAccessibilityStorageKey(null, null)).toBe(
      'student-accessibility:local:device',
    );
  });
});

describe('student accessibility storage io', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saves and loads preferences through localStorage', () => {
    const key = 'student-accessibility:io:test';
    saveStudentAccessibilityPreferences(key, {
      fontSize: 'small',
      highContrast: true,
      zoom: 1.2,
      passageReadabilityLevel: 0,
      playbackRate: 1.5,
    });

    const loaded = loadStudentAccessibilityPreferences(key);
    expect(loaded.fontSize).toBe('small');
    expect(loaded.highContrast).toBe(true);
    expect(loaded.zoom).toBe(1.2);
    expect(loaded.passageReadabilityLevel).toBe(0);
    expect(loaded.playbackRate).toBe(1.5);
  });

  it('falls back to defaults for corrupt stored values', () => {
    const key = 'student-accessibility:io:corrupt';
    window.localStorage.setItem(key, 'not json');
    expect(loadStudentAccessibilityPreferences(key)).toEqual(
      DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES,
    );
  });

  it('loads defaults for a missing key', () => {
    expect(loadStudentAccessibilityPreferences('student-accessibility:io:missing')).toEqual(
      DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES,
    );
  });

  it('clears the stored key', () => {
    const key = 'student-accessibility:io:clear';
    saveStudentAccessibilityPreferences(key, DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES);
    clearStudentAccessibilityPreferences(key);
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
