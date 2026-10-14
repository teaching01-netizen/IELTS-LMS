import type { SatRoomFields } from "../contracts/satCreateRoom";

/**
 * In-memory only, never persisted: a roster carries student names and codes, and
 * this exists solely so an author who leaves Create room to fix an exam issue
 * comes back to the form they had filled in. Entries are per exam and expire.
 */
const DRAFT_TTL_MS = 30 * 60 * 1000;
const drafts = new Map<string, { fields: SatRoomFields; savedAt: number }>();

export function stashSatRoomDraft(examId: string, fields: SatRoomFields, now = Date.now()): void {
  drafts.set(examId, { fields, savedAt: now });
}

export function peekSatRoomDraft(examId: string, now = Date.now()): SatRoomFields | null {
  const entry = drafts.get(examId);
  if (!entry) return null;
  if (now - entry.savedAt > DRAFT_TTL_MS) {
    drafts.delete(examId);
    return null;
  }
  return entry.fields;
}

export function clearSatRoomDraft(examId: string): void {
  drafts.delete(examId);
}
