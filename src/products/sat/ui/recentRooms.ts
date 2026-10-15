const STORAGE_KEY = 'sat-recent-rooms';
const MAX_ENTRIES = 20;

export type RecentRoom = { scheduleId: string; examId: string; at: number };

function read(): RecentRoom[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is RecentRoom =>
      Boolean(entry) && typeof entry.scheduleId === 'string' && typeof entry.examId === 'string' && typeof entry.at === 'number');
  } catch {
    return [];
  }
}

/**
 * Remembers that this browser opened a room, so the exam's Rooms tab can offer
 * "Jump back in". A per-viewer convenience only: blocked storage just means no
 * recents are shown.
 */
export function rememberRoom(scheduleId: string, examId: string, at = Date.now()): void {
  const next = [{ scheduleId, examId, at }, ...read().filter((entry) => entry.scheduleId !== scheduleId)].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: recents are optional.
  }
}

/** Rooms of one exam this browser opened, newest first. */
export function readRecentRooms(examId: string): RecentRoom[] {
  return read().filter((entry) => entry.examId === examId).sort((left, right) => right.at - left.at);
}
