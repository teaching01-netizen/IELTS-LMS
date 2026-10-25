/**
 * Whether the eliminator is ON, remembered per attempt.
 *
 * This is presentation, not answers. The choices a student actually crossed
 * out are answer data and already persist through the response record
 * (`eliminatedOptionIds`); what lives here is only "the cut control is showing",
 * one switch for the whole attempt: turned on, it stays on for every question
 * until the student turns it off, and a reloaded page does not hand back an
 * exam whose toolbar silently closed under the student.
 *
 * Client-side on purpose: the server has no business storing which tool a
 * student left open, and nothing else (proctor surfaces, results, reconciliation)
 * reads this. Same discipline as the other attempt-scoped stores: versioned key
 * family, tolerant reads that drop what they cannot understand, best-effort
 * writes that never throw into the exam shell.
 */
const STORAGE_PREFIX = "sat-eliminator-mode:v1";

export function satEliminatorModeKey(scheduleId: string, attemptId: string): string {
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

/**
 * The attempt's eliminator switch. A missing, foreign, or unreadable record
 * reads as "off" — and is deleted rather than left to be re-parsed on every
 * page load.
 */
export function loadSatEliminatorMode(scheduleId: string, attemptId: string): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  const key = satEliminatorModeKey(scheduleId, attemptId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>)["version"] === 1 &&
      (parsed as Record<string, unknown>)["on"] === true
    ) {
      return true;
    }
    storage.removeItem(key);
    return false;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* Best effort only. */
    }
    return false;
  }
}

/**
 * Remember the attempt's eliminator switch. Off is stored as the absence of a
 * record: there is then nothing to read, and nothing that can later be mistaken
 * for a corrupt payload.
 */
export function saveSatEliminatorMode(
  scheduleId: string,
  attemptId: string,
  on: boolean,
): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  const key = satEliminatorModeKey(scheduleId, attemptId);
  try {
    if (on) storage.setItem(key, JSON.stringify({ version: 1, on: true }));
    else storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Attempt cleanup: a finished attempt leaves no switch behind on this device. */
export function clearSatEliminatorMode(scheduleId: string, attemptId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(satEliminatorModeKey(scheduleId, attemptId));
  } catch {
    // Storage cleanup is best-effort and must never interfere with completion.
  }
}
