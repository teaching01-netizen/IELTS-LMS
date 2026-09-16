import {
  createDefaultSatAnnotationEducationState,
  normalizeSatAnnotationEducationState,
  type SatAnnotationEducationState,
} from '../domain/satAnnotationEducation';

/**
 * Highlights & Notes education memory (local, per attempt).
 *
 * Same shape and discipline as the reading-preferences store: one versioned
 * key family, tolerant reads, best-effort writes. Storage failure is never
 * fatal — the worst case is a teaching cue appearing twice, which is harmless,
 * whereas a thrown error inside the exam shell is not.
 */
const STORAGE_PREFIX = 'sat-annotation-education:v1';

export function satAnnotationEducationKey(scheduleId: string, attemptId: string): string {
  return `${STORAGE_PREFIX}:${scheduleId}:${attemptId}`;
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSatAnnotationEducation(key: string): SatAnnotationEducationState {
  const storage = browserStorage();
  if (!storage) return createDefaultSatAnnotationEducationState();
  try {
    const raw = storage.getItem(key);
    if (!raw) return createDefaultSatAnnotationEducationState();
    return normalizeSatAnnotationEducationState(JSON.parse(raw));
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* Best effort only. */
    }
    return createDefaultSatAnnotationEducationState();
  }
}

export function saveSatAnnotationEducation(key: string, state: SatAnnotationEducationState): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(normalizeSatAnnotationEducationState(state)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Preview and debug shells have no attempt identity. They get their own key so
 * a staff preview never consumes the teaching cues a real student needs.
 */
export function satAnnotationEducationPreviewKey(examId: string): string {
  return `${STORAGE_PREFIX}:preview:${examId}`;
}
