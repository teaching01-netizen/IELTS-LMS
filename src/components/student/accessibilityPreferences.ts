import {
  DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL,
  clampStudentPassageReadabilityLevel,
  type StudentFontSize,
  type StudentPassageReadabilityLevel,
} from './accessibilityScale';

export type StudentPlaybackRate = 0.75 | 1 | 1.25 | 1.5;

export const STUDENT_PLAYBACK_RATES: readonly StudentPlaybackRate[] = [0.75, 1, 1.25, 1.5];
export const DEFAULT_STUDENT_PLAYBACK_RATE: StudentPlaybackRate = 1;

export const STUDENT_ACCESSIBILITY_STORAGE_PREFIX = 'student-accessibility';

export interface StudentAccessibilityPreferences {
  fontSize: StudentFontSize;
  highContrast: boolean;
  zoom: number;
  passageReadabilityLevel: StudentPassageReadabilityLevel;
  playbackRate: StudentPlaybackRate;
}

export const DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES: StudentAccessibilityPreferences = {
  fontSize: 'normal',
  highContrast: false,
  zoom: 1,
  passageReadabilityLevel: DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL,
  playbackRate: DEFAULT_STUDENT_PLAYBACK_RATE,
};

const STUDENT_ZOOM_MIN = 0.85;
const STUDENT_ZOOM_MAX = 1.5;

const STUDENT_FONT_SIZES: readonly StudentFontSize[] = ['small', 'normal', 'large'];

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES.zoom;
  }
  return Math.min(STUDENT_ZOOM_MAX, Math.max(STUDENT_ZOOM_MIN, value));
}

function toPlaybackRate(value: unknown): StudentPlaybackRate {
  return (STUDENT_PLAYBACK_RATES as readonly unknown[]).includes(value)
    ? (value as StudentPlaybackRate)
    : DEFAULT_STUDENT_PLAYBACK_RATE;
}

/**
 * Key is scoped to a candidate so shared devices never leak one candidate's
 * reading preferences into another candidate's exam. Falls back to a local
 * key for preview/unscheduled sessions, where no candidate identity exists.
 */
export function getStudentAccessibilityStorageKey(
  scheduleId?: string | null,
  candidateId?: string | null,
): string {
  return `${STUDENT_ACCESSIBILITY_STORAGE_PREFIX}:${scheduleId ?? 'local'}:${candidateId ?? 'device'}`;
}

/**
 * Defensive parse: corrupted, partial, or out-of-range stored values fall
 * back to defaults per-field so storage problems can never break an exam.
 * Unknown fields (future schema versions) are ignored.
 */
export function parseStudentAccessibilityPreferences(
  raw: string | null | undefined,
): StudentAccessibilityPreferences {
  if (!raw) {
    return { ...DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES };
  }

  if (typeof data !== 'object' || data === null) {
    return { ...DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES };
  }

  const record = data as Record<string, unknown>;

  return {
    fontSize: STUDENT_FONT_SIZES.includes(record['fontSize'] as StudentFontSize)
      ? (record['fontSize'] as StudentFontSize)
      : DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES.fontSize,
    highContrast:
      typeof record['highContrast'] === 'boolean'
        ? record['highContrast']
        : DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES.highContrast,
    zoom:
      typeof record['zoom'] === 'number'
        ? clampZoom(record['zoom'])
        : DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES.zoom,
    passageReadabilityLevel:
      typeof record['passageReadabilityLevel'] === 'number'
        ? clampStudentPassageReadabilityLevel(record['passageReadabilityLevel'])
        : DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES.passageReadabilityLevel,
    playbackRate: toPlaybackRate(record['playbackRate']),
  };
}

export function loadStudentAccessibilityPreferences(key: string): StudentAccessibilityPreferences {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES };
  }
  try {
    return parseStudentAccessibilityPreferences(window.localStorage.getItem(key));
  } catch {
    return { ...DEFAULT_STUDENT_ACCESSIBILITY_PREFERENCES };
  }
}

export function saveStudentAccessibilityPreferences(
  key: string,
  preferences: StudentAccessibilityPreferences,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable (private mode, quota); preferences simply
    // stay session-only in that case.
  }
}

export function clearStudentAccessibilityPreferences(key: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort clear; ignoring storage failures keeps the reset usable.
  }
}