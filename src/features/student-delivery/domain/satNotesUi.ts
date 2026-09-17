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
 * `editingMarkId` is the one input the machine cannot own: it is the edit dock's
 * own presentation state ("this mark's colour/underline controls are showing"),
 * and it only ever *rings* a card, never opens a column.
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
