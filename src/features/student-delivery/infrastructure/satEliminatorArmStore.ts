/**
 * Which questions have the eliminator OPEN, remembered per attempt.
 *
 * This is placement, not answers. The choices a student actually crossed out
 * are answer data and already persist through the response record
 * (`eliminatedOptionIds`); what lives here is only "the cut control was showing
 * on this question", so a reloaded page does not hand back an exam whose
 * toolbar silently closed under the student.
 *
 * Client-side on purpose: the server has no business storing which tool a
 * student left open, and nothing else (proctor surfaces, results, reconciliation)
 * reads this.
 *
 * Keys are the route's own question keys — `moduleAttemptId:examQuestionId` —
 * opaque strings here, so the shape of that identity can change without a
 * storage migration. Same discipline as the other attempt-scoped stores:
 * versioned key family, tolerant reads that drop what they cannot understand,
 * best-effort writes that never throw into the exam shell.
 */
const STORAGE_PREFIX = "sat-eliminator-arms:v1";

/**
 * Ceiling on remembered arms. A full SAT has fewer than 100 questions, so this
 * only ever bites a corrupt or foreign payload — and it bites by forgetting,
 * never by failing.
 */
const MAX_REMEMBERED_ARMS = 200;

export function satEliminatorArmsKey(scheduleId: string, attemptId: string): string {
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

function normalizeQuestionKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (keys.length >= MAX_REMEMBERED_ARMS) break;
    if (typeof entry !== "string") continue;
    const key = entry.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** The stored record's keys, or null when the payload is not one of ours. */
function parseStoredKeys(raw: string): string[] | null {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record["version"] !== 1) return null;
  return normalizeQuestionKeys(record["questionKeys"]);
}

/**
 * The attempt's armed questions. A missing, foreign, or unreadable record reads
 * as "nothing armed" — and is deleted rather than left to be re-parsed on every
 * page load, so a broken record costs the student their arms and nothing else.
 */
export function loadSatEliminatorArms(
  scheduleId: string,
  attemptId: string,
): ReadonlySet<string> {
  const storage = browserStorage();
  if (!storage) return new Set<string>();
  const key = satEliminatorArmsKey(scheduleId, attemptId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return new Set<string>();
    const keys = parseStoredKeys(raw);
    if (!keys) {
      storage.removeItem(key);
      return new Set<string>();
    }
    return new Set(keys);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* Best effort only. */
    }
    return new Set<string>();
  }
}

/**
 * Remember the attempt's armed questions. Arming none is stored as the absence
 * of a record rather than an empty one: there is then nothing to read, and
 * nothing that can later be mistaken for a corrupt payload.
 */
export function saveSatEliminatorArms(
  scheduleId: string,
  attemptId: string,
  questionKeys: ReadonlySet<string>,
): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  const key = satEliminatorArmsKey(scheduleId, attemptId);
  try {
    if (questionKeys.size === 0) {
      storage.removeItem(key);
      return true;
    }
    storage.setItem(
      key,
      JSON.stringify({ version: 1, questionKeys: [...questionKeys] }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Attempt cleanup: a finished attempt leaves no arming behind on this device. */
export function clearSatEliminatorArms(scheduleId: string, attemptId: string): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.removeItem(satEliminatorArmsKey(scheduleId, attemptId));
  } catch {
    // Storage cleanup is best-effort and must never interfere with completion.
  }
}
