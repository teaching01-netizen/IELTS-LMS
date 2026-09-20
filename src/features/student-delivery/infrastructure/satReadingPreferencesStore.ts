import {
  createSatReadingPreferences,
  normalizeSatReadingPreferences,
  type SatReadingPreferences,
} from "../domain/satReadingPreferences";

const STORAGE_PREFIX = "sat-reading-preferences:v1";
const ZOOM_DECISION_PREFIX = "sat-exam-zoom-decision:v1";

export function satReadingPreferencesKey(scheduleId: string, attemptId: string): string {
  return `${STORAGE_PREFIX}:${scheduleId}:${attemptId}`;
}

/**
 * The attempt's automatic screen-zoom decision, in its OWN key: a decision is
 * not a preference.
 *
 * It must not live inside the preferences record, because a decision that
 * changed nothing ("the question already fits") stores no zoom, and writing one
 * would read as a value the student chose — it would show in the Display panel
 * and light up Reset. Keeping it separate also means the preferences payload
 * keeps its shape and its `version: 1` meaning, so nothing here needs a
 * migration.
 */
export function satExamZoomDecisionKey(scheduleId: string, attemptId: string): string {
  return `${ZOOM_DECISION_PREFIX}:${scheduleId}:${attemptId}`;
}

/**
 * Has this attempt already answered the zoom question? Absent reads as "not
 * yet", which is what makes a new attempt — and every session that predates
 * this key — start undecided without any version handling.
 */
export function hasSatExamZoomDecision(scheduleId: string, attemptId: string): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    return storage.getItem(satExamZoomDecisionKey(scheduleId, attemptId)) === "1";
  } catch {
    return false;
  }
}

/** Records the attempt as decided. Best effort: blocked storage just means the
 * next page load may decide again rather than that the exam fails. */
export function saveSatExamZoomDecision(scheduleId: string, attemptId: string): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(satExamZoomDecisionKey(scheduleId, attemptId), "1");
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSatReadingPreferences(
  scheduleId: string,
  attemptId: string
): SatReadingPreferences {
  const storage = browserStorage();
  if (!storage) return createSatReadingPreferences();
  const key = satReadingPreferencesKey(scheduleId, attemptId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return createSatReadingPreferences();
    return normalizeSatReadingPreferences(JSON.parse(raw));
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* Best effort only. */
    }
    return createSatReadingPreferences();
  }
}

export function saveSatReadingPreferences(
  scheduleId: string,
  attemptId: string,
  preferences: SatReadingPreferences
): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(
      satReadingPreferencesKey(scheduleId, attemptId),
      JSON.stringify(normalizeSatReadingPreferences(preferences))
    );
    return true;
  } catch {
    return false;
  }
}

export function clearSatReadingPreferences(scheduleId: string, attemptId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(satReadingPreferencesKey(scheduleId, attemptId));
    // The attempt's decision goes with its preferences: a finished attempt
    // leaves nothing behind, and its id is never resumed by anyone else.
    storage.removeItem(satExamZoomDecisionKey(scheduleId, attemptId));
  } catch {
    // Preference cleanup must never interfere with exam completion.
  }
}
