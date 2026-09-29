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
import type { SatReadingPresentation } from './satReadingLayout';

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
 * Where the column goes, from the shared reading-layout decision.
 *
 * The placement used to be derived here from two viewport media queries
 * (767px, 1024px) — a second responsive system, sitting beside the workspace's
 * own. It now reads the one measurement of the actual workspace, so "the column
 * has room" and "the passage has room" are the same fact:
 *
 * - `column` — passage | notes | question, or question | notes when there is no
 *   passage: three (or two) readable panes, side by side.
 * - `pair` — passage | notes while notes are open, because a third column would
 *   squeeze both reading panes to slivers; the question comes back the moment
 *   notes close, which is what the close control says.
 * - `row` — notes stack beneath the panes; either the base layout is stacked, or
 *   the question and the notes pane cannot share a row.
 * - `none` — closed.
 *
 * `readingPresentation` replaces the old `compact` flag and `hasStimulus` both:
 * `single` IS "this question has no stimulus pane".
 */
export type SatNotesPlacement = 'none' | 'column' | 'pair' | 'row';

export function satNotesPlacement(input: {
  open: boolean;
  /** The shared reading decision's presentation. */
  readingPresentation: SatReadingPresentation;
  /** True when passage, notes, and question all clear the readable budget. */
  threeColumnFits: boolean;
  /** True when the pane beside the notes column clears the budget on its own. */
  sideColumnFits: boolean;
}): SatNotesPlacement {
  if (!input.open) return 'none';
  if (input.readingPresentation === 'stacked') return 'row';
  if (input.readingPresentation === 'split') return input.threeColumnFits ? 'column' : 'pair';
  return input.sideColumnFits ? 'column' : 'row';
}

/**
 * The notes column's width band, in pixels, stated once.
 *
 * The track strings below and the resolver that decides whether the column fits
 * beside the passage both read these numbers: a CSS `clamp()` and a layout
 * calculation that disagree about what "20%" means is how a column that the
 * policy believed fits ends up squeezing the passage anyway.
 */
export const SAT_NOTES_MIN_PX = 280;
export const SAT_NOTES_MAX_PX = 340;
export const SAT_NOTES_COLUMN_FRACTION = 0.2;
export const SAT_NOTES_PAIR_FRACTION = 0.32;

/**
 * The notes panel's own inset from its edges, in pixels — `px-3`/`p-3` on its
 * chrome, and the reason every control inside it starts 12px in.
 *
 * Stated as a number because a layout decision is written against it: the seat
 * the panel takes from the reading panes has to stand clear of the divider
 * handle beside it, and this inset is already part of that clearance (the panel
 * puts nothing interactive in it). `SAT_NOTES_SEAT_GUTTER_PX` in
 * `satReadingLayout.ts` therefore owes only the difference. If this inset ever
 * shrinks, that gutter has to grow, or the first note control slides back under
 * the divider's grab zone — which is why `SatNotesColumn.test.tsx` asserts the
 * chrome really carries it.
 */
export const SAT_NOTES_CHROME_PADDING_PX = 12;

/** `0.2` → `20%`, without float drift leaking into a CSS string. */
function satNotesPercent(fraction: number): string {
  return `${Number((fraction * 100).toFixed(4))}%`;
}

/**
 * Track width for the column: the brief's 280–340px band, taking a fifth of a
 * wide screen and never stealing the passage's reading width.
 */
export const SAT_NOTES_COLUMN_TRACK =
  `clamp(${SAT_NOTES_MIN_PX}px, ${satNotesPercent(SAT_NOTES_COLUMN_FRACTION)}, ${SAT_NOTES_MAX_PX}px)`;

/** The same band as a share of a two-pane layout. */
export const SAT_NOTES_PAIR_TRACK =
  `clamp(${SAT_NOTES_MIN_PX}px, ${satNotesPercent(SAT_NOTES_PAIR_FRACTION)}, ${SAT_NOTES_MAX_PX}px)`;

/**
 * The column's numeric width at a workspace width — the same arithmetic the
 * clamp above performs, callable by the layout resolver.
 */
export function satNotesColumnWidth(workspaceWidth: number): number {
  if (!Number.isFinite(workspaceWidth)) return SAT_NOTES_MIN_PX;
  return Math.min(
    SAT_NOTES_MAX_PX,
    Math.max(SAT_NOTES_MIN_PX, workspaceWidth * SAT_NOTES_COLUMN_FRACTION),
  );
}

/**
 * The seat a hidden column leaves behind: a handle, not a pane.
 *
 * It takes the column's own place in the grid, so hiding and opening move exactly
 * one edge — the passage never shifts and the question never jumps. That
 * stability is what makes the two states read as one pane that collapses rather
 * than two layouts the student has to re-learn.
 *
 * Its width is held by two numbers, neither a matter of taste, and both of them
 * measured against the thing it sits beside:
 *
 * 1. It has to clear the split handle's reach. The handle is a 44px target
 *    centred on the divider it moves, so
 *    `(SAT_READING_SPLIT_HANDLE_PX - SAT_READING_SPLIT_DIVIDER_PX) / 2 = 21`px
 *    of it lands in whatever sits flush beside that divider — and when the
 *    column is collapsed, this tab is exactly what sits there. At the 36px it
 *    used to be, the tab's own centre fell inside that 21px, so the divider's
 *    grab zone was eating the taps meant to reopen the pane: one control painted
 *    on top of another, and the a11y suite clicked the tab and hit the slider.
 * 2. It has to be a control a finger can hit at all — the same 44px floor the
 *    exam holds every other button to, which 36px quietly broke.
 *
 * Stated in pixels rather than `rem` on purpose: the reach it has to clear is
 * measured in pixels, and a root font-size that shrank would take the clearance
 * with it. `satNotesUi.test.ts` asserts both inequalities against the handle's
 * own numbers, so shrinking this tab back for looks fails a test instead of a
 * student's tap.
 */
export const SAT_NOTES_RAIL_PX = 48;

/** The track string that seat is built from. */
export const SAT_NOTES_RAIL_TRACK = `${SAT_NOTES_RAIL_PX}px`;

/**
 * True when the hidden column should leave its handle on screen.
 *
 * The handle is how the pane's ability to come back is visible without decoding
 * the top bar: it stands exactly where the column was, so hiding is visibly
 * reversible. It is skipped when the panes are stacked, where the column takes no
 * side of the layout to leave a handle on and every pixel of reading height is
 * spoken for; there the labeled top-bar entry stays the way back.
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
  /** The shared reading decision's presentation. */
  readingPresentation: SatReadingPresentation;
  /** Without the surface there is nothing to open. */
  available: boolean;
  /** True once the question holds at least one written note (`satNotesCount`). */
  hasNotes: boolean;
}): boolean {
  return (
    input.available &&
    input.hasNotes &&
    !input.open &&
    input.readingPresentation !== 'stacked'
  );
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
