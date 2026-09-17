import { SAT_ANNOTATION_NOTE_LIMIT } from './satResponses';

/**
 * Rules for a note field that has no Save button.
 *
 * Two things a note field has to get right without any instruction: it must
 * keep what the student typed (idle autosave plus an explicit commit on close,
 * so a fast typist who leaves immediately loses nothing), and it must not
 * narrate its own constraints. A count that reads "0/2000" tells almost nobody
 * anything; the same count appearing at 1,6xx tells them to wrap up.
 */

/** Idle pause after which a draft is committed. */
export const SAT_NOTE_AUTOSAVE_MS = 700;

/** How long the quiet "Saved" confirmation stays on screen. */
export const SAT_NOTE_SAVED_MS = 1_000;

/** The count appears once the student is in range of the limit. */
export const SAT_NOTE_COUNTER_VISIBLE_AT = Math.floor(SAT_ANNOTATION_NOTE_LIMIT * 0.8);

/** At this point the count stops being a footnote and becomes a warning. */
export const SAT_NOTE_COUNTER_URGENT_AT = Math.floor(SAT_ANNOTATION_NOTE_LIMIT * 0.95);

/** Progressive disclosure: nothing, then the count, then the count in warning ink. */
export function satNoteCounterVisible(length: number): boolean {
  return length >= SAT_NOTE_COUNTER_VISIBLE_AT;
}

export function satNoteCounterUrgent(length: number): boolean {
  return length >= SAT_NOTE_COUNTER_URGENT_AT;
}

/** Grouped digits, because "1623/2000" is read, not parsed. */
export function satNoteCounterLabel(length: number, limit: number = SAT_ANNOTATION_NOTE_LIMIT): string {
  return `${length.toLocaleString('en-US')}/${limit.toLocaleString('en-US')}`;
}

/** Trims a draft to the stored limit (the field is capped, paste is not). */
export function clampSatNote(draft: string, limit: number = SAT_ANNOTATION_NOTE_LIMIT): string {
  return draft.slice(0, limit);
}
