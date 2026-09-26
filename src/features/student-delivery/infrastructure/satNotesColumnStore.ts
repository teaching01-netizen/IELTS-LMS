/**
 * Whether the student left the Notes column open, remembered per attempt.
 *
 * The column is layout, not work: the notes themselves are annotations and
 * persist with the response. What this remembers is that the pane was part of
 * the exam when the student left it, so a recovered sitting does not hand back
 * a page whose column collapsed behind their back.
 *
 * The record names the MODULE ATTEMPT it belongs to, which is what keeps the
 * answer honest in both directions:
 * - a reload inside the same module restores the column;
 * - a new module is a new context (the app's own rule — a module transition
 *   closes the column), so M2 does not inherit M1's open pane from a record the
 *   student made in M1.
 * Reading it for a module attempt the record does not name therefore reads as
 * closed, without a second key family or a cleanup path per module.
 *
 * Attempt-scoped, client-side, best-effort — the same discipline as the other
 * SAT display-state stores.
 */
const STORAGE_PREFIX = "sat-notes-column:v1";

export function satNotesColumnKey(scheduleId: string, attemptId: string): string {
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

interface SatNotesColumnRecord {
  moduleAttemptId: string;
  open: boolean;
}

/** The stored record, or null when the payload is not one of ours. */
function parseStoredRecord(raw: string): SatNotesColumnRecord | null {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record["version"] !== 1) return null;
  const moduleAttemptId = record["moduleAttemptId"];
  if (typeof moduleAttemptId !== "string" || !moduleAttemptId) return null;
  return { moduleAttemptId, open: record["open"] === true };
}

/**
 * True when this module attempt is the one the student left the column open in.
 *
 * A missing, foreign, or unreadable record reads as closed and is deleted
 * rather than re-parsed on every load, so a broken record costs the student a
 * pane they can reopen in one press.
 */
export function loadSatNotesColumnOpen(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  const key = satNotesColumnKey(scheduleId, attemptId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return false;
    const record = parseStoredRecord(raw);
    if (!record) {
      storage.removeItem(key);
      return false;
    }
    return record.open && record.moduleAttemptId === moduleAttemptId;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* Best effort only. */
    }
    return false;
  }
}

/** Record the column's state, and which module attempt it was seen in. */
export function saveSatNotesColumnOpen(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
  open: boolean,
): boolean {
  const storage = browserStorage();
  if (!storage || !moduleAttemptId) return false;
  try {
    storage.setItem(
      satNotesColumnKey(scheduleId, attemptId),
      JSON.stringify({ version: 1, moduleAttemptId, open }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Attempt cleanup: a finished attempt leaves no pane state behind. */
export function clearSatNotesColumn(scheduleId: string, attemptId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(satNotesColumnKey(scheduleId, attemptId));
  } catch {
    // Storage cleanup is best-effort and must never interfere with completion.
  }
}
