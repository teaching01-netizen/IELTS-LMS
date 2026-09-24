/**
 * The Notes surface as one state, and the one rule that places it.
 *
 * Before this existed, "is the column open, which card is active, which editor
 * is showing" was answered in three places — the interaction machine's surface
 * kind, the shell's own derivation, and the annotation being edited — which is
 * how the Add-note path ended up closing without giving focus back. One union,
 * one owner:
 *
 *     idle       nothing annotation-shaped is on screen
 *     selection  a selection is live, so the contextual toolbar owns the surface
 *     notes      the Notes column is part of the layout
 *
 * `editorId` is an annotation id, or `SAT_QUESTION_NOTE_EDITOR` when the student
 * is writing about the question itself. That sentinel is why writing a note with
 * no selection is a state rather than a missing capability.
 */
export type SatNotesUiState =
  | { kind: 'idle' }
  | { kind: 'selection' }
  | { kind: 'notes'; editorId: string | null; activeId: string | null };

/** Editor id meaning "the question's own note", not a marked span. */
export const SAT_QUESTION_NOTE_EDITOR = 'question';

import type { SatExclusiveSurface } from './satInteractionState';

export const idleSatNotesUi = (): SatNotesUiState => ({ kind: 'idle' });
export const selectionSatNotesUi = (): SatNotesUiState => ({ kind: 'selection' });
export function notesSatNotesUi(editorId: string | null, activeId: string | null): SatNotesUiState {
  return { kind: 'notes', editorId, activeId };
}

/** True when the Notes column belongs in the layout. */
export function satNotesColumnOpen(state: SatNotesUiState): boolean {
  return state.kind === 'notes';
}

/**
 * The single translation from the interaction machine to the notes UI.
 *
 * `editingMarkId` is the one input the machine cannot own: it is the mark's own
 * edit controls' presentation state ("this mark's colour/underline controls are
 * showing"), and it only ever *rings* a card, never opens a column.
 */
export function satNotesUiFromSurface(
  surface: SatExclusiveSurface,
  editingMarkId: string | null,
  selectionLive: boolean,
): SatNotesUiState {
  switch (surface.kind) {
    case 'annotation-note-editor':
      return notesSatNotesUi(surface.annotationId, surface.annotationId);
    case 'question-note-editor':
      return notesSatNotesUi(SAT_QUESTION_NOTE_EDITOR, editingMarkId);
    case 'question-notes':
      return notesSatNotesUi(null, editingMarkId);
    case 'none':
      return selectionLive ? selectionSatNotesUi() : idleSatNotesUi();
    default:
      // Directions, Display, the navigator, More: exam surfaces, not notes.
      return idleSatNotesUi();
  }
}

/**
 * Where the column goes at the current width.
 *
 * - `column` — passage | notes | question, three readable panes (wide screens).
 * - `pair` — passage | notes while notes are open, because at tablet widths a
 *   third column would squeeze the passage and question to slivers; the question
 *   comes back the moment notes close, which is what the close control says.
 * - `row` — notes stack beneath both panes (phone widths).
 * - `none` — closed.
 */
export type SatNotesPlacement = 'none' | 'column' | 'pair' | 'row';

export function satNotesPlacement(input: {
  open: boolean;
  /** True below the split breakpoint (one pane at a time). */
  compact: boolean;
  /** True when three panes actually fit. */
  threeColumn: boolean;
}): SatNotesPlacement {
  if (!input.open) return 'none';
  if (input.compact) return 'row';
  return input.threeColumn ? 'column' : 'pair';
}

/**
 * Track width for the column: the brief's 280–340px band, taking a fifth of a
 * wide screen and never stealing the passage's reading width.
 */
export const SAT_NOTES_COLUMN_TRACK = 'clamp(280px, 20%, 340px)';

/** The same band as a share of a two-pane layout. */
export const SAT_NOTES_PAIR_TRACK = 'clamp(280px, 32%, 340px)';

/**
 * The track a hidden column leaves behind: a handle, not a pane.
 *
 * It takes the column's own place in the grid, so hiding and opening move
exactly one edge — the passage never shifts and the question never jumps. That
stability is what makes the two states read as one pane that collapses rather
than two layouts the student has to re-learn.
 */
export const SAT_NOTES_RAIL_TRACK = '2.25rem';

/**
 * True when the hidden column should leave its handle on screen.
 *
 * The handle is how the pane's ability to come back is visible without decoding
the top bar: it stands exactly where the column was, so hiding is visibly
reversible. It is skipped on phone widths, where the column takes no side of the
layout to leave a handle on and every pixel of reading height is spoken for;
there the labeled top-bar entry stays the way back.
 *
 * It also waits for a note to exist. A handle promises something to come back to,
 * and a student who has highlighted but written nothing does not have one yet: a
 * "Notes" strip standing in the middle of the exam is the app advertising a
 * feature rather than the student's own work. The labeled top-bar entry is still
 * the way in.
 */
export function satNotesRailVisible(input: {
  /** True while the column is part of the layout. */
  open: boolean;
  /** True below the split breakpoint (stacked panes). */
  compact: boolean;
  /** Without the surface there is nothing to open. */
  available: boolean;
  /** True once the question holds at least one written note (`satNotesCount`). */
  hasNotes: boolean;
}): boolean {
  return input.available && input.hasNotes && !input.open && !input.compact;
}

/**
 * What counts as a note.
 *
 * A mark whose card is merely open for a first note is not a note until there are
 * words in it — whitespace is not writing either. Three surfaces need exactly
 * this answer (the heading's count, the decision to leave a handle behind, and
 * the margin dot beside a marked phrase), and they must not be able to disagree
 * about what they are counting, so the definition lives here once.
 */
export function satAnnotationHasNote(annotation: { note?: string | undefined }): boolean {
  return (annotation.note ?? '').trim().length > 0;
}

/**
 * How many notes the question actually holds.
 *
 * The heading's summary and the decision to leave a handle behind both need that
 * answer, so it is derived once here instead of twice downstream — which is how
 * "3 notes" and "there is something to come back to" could otherwise disagree.
 */
export function satNotesCount(
  annotations: readonly { note?: string | undefined }[],
  questionNote: string,
): number {
  return (
    annotations.filter(satAnnotationHasNote).length +
    (questionNote.trim().length > 0 ? 1 : 0)
  );
}
