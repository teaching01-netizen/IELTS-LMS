import {
  createSatReadingPreferences,
  normalizeSatReadingPreferences,
  type SatReadingPreferences,
} from "../domain/satReadingPreferences";

const STORAGE_PREFIX = "sat-reading-preferences:v1";

export function satReadingPreferencesKey(scheduleId: string, attemptId: string): string {
  return `${STORAGE_PREFIX}:${scheduleId}:${attemptId}`;
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
  } catch {
    // Preference cleanup must never interfere with exam completion.
  }
}
