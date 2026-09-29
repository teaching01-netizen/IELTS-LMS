import { clampSatReadingSplitRatio } from './satReadingPreferences';
import {
  SAT_NOTES_CHROME_PADDING_PX,
  SAT_NOTES_COLUMN_TRACK,
  SAT_NOTES_PAIR_TRACK,
  satNotesColumnWidth,
} from './satNotesUi';

/**
 * One layout truth for the SAT reading workspace.
 *
 * Workspace, Notes, Display, and the auto-fit all used to answer "how much room
 * is there?" separately — a 767px media query here, a 1024px one there, a
 * popover height rule somewhere else — which is how four responsive systems end
 * up disagreeing inside one exam. This module answers the question once, for a
 * real logical box measured off the workspace itself, and everything else
 * consumes that answer.
 *
 * It is deliberately pure: no React, no DOM, no device names, no viewport
 * breakpoints. "Does the content have enough usable space?" is arithmetic on a
 * width, and arithmetic is the only part of this that can be pinned by a cheap
 * test matrix.
 *
 * Two inputs are kept conceptually independent on purpose:
 *
 * - `textScale` is the student's Text size (reading content only). It raises the
 *   width a pane needs before it is worth reading.
 * - screen zoom is NOT an input. It changes the logical plane the workspace is
 *   laid out in (`SatExamZoomPlane` widens the plane as it shrinks the scale),
 *   so the ResizeObserver sees the changed width and this resolver reacts to the
 *   measurement. Passing zoom in here would be a second copy of that math, and
 *   the two copies would eventually disagree.
 */
export type SatReadingPresentation = 'single' | 'split' | 'stacked';

/** How the Display panel is allowed to present itself. */
export type SatDisplayPresentation = 'anchored' | 'compact';

/**
 * Why the presentation came out the way it did — the machine-readable half of
 * "the layout did not do what I expected", for diagnostics and e2e attributes.
 */
export type SatReadingLayoutReason =
  | 'single-question'
  | 'readable-split'
  | 'insufficient-pane-width';

/**
 * The width one reading pane needs before it counts as readable.
 *
 * This is a PANE BUDGET, not a text width: it already accounts for the padding
 * and chrome a pane carries at 100% text, so it is not "360px of prose plus
 * another 80px of gutters". Calibrating it is therefore a one-constant change
 * rather than a rewrite of a formula.
 */
export const SAT_READING_BASE_READABLE_PANE_PX = 360;

/** Bluebook's hard 2px divider between two panes. */
export const SAT_READING_SPLIT_DIVIDER_PX = 2;

/**
 * The split handle's touch target, in pixels — the button that rides the seam.
 *
 * A layout number, not a style choice. The button is centred on the divider so
 * the grip is draggable from either side of it, which means
 * `(SAT_READING_SPLIT_HANDLE_PX - SAT_READING_SPLIT_DIVIDER_PX) / 2 = 21`px of
 * it reaches into the pane on each side. Whatever an arrangement places flush
 * against a divider this handle moves has to clear that reach, or the handle's
 * hit area sits on top of its controls and swallows their taps. Two arrangements
 * do: the collapsed Notes tab (`SAT_NOTES_RAIL_PX`) and the open Notes panel
 * (`SAT_NOTES_SEAT_GUTTER_PX`). The handle carries `w-11` (= 44px) and
 * `justify-self-center` (the symmetric reach); `SatReadingSplitHandle.test.tsx`
 * reads the source to hold the two together, because a Tailwind width cannot
 * reference this constant.
 */
export const SAT_READING_SPLIT_HANDLE_PX = 44;

/**
 * How far the handle's target reaches past the divider, into the pane on either
 * side — `21`px at the sizes above.
 *
 * This is the number every arrangement beside a divider has to stand clear of.
 * It is derived rather than written down: a change to the handle's touch target
 * moves it, and the seats that stand clear of it follow.
 */
export const SAT_READING_SPLIT_HANDLE_REACH_PX =
  (SAT_READING_SPLIT_HANDLE_PX - SAT_READING_SPLIT_DIVIDER_PX) / 2;

/**
 * What a notes seat owes the divider handle beside it, beyond the panel's own
 * inset.
 *
 * The notes panel puts nothing interactive in its first
 * `SAT_NOTES_CHROME_PADDING_PX` — that inset is already clearance, so the seat
 * owes only the remainder. Both the CSS track and this resolver read this one
 * number, so the seat the grid builds and the seat the model measured cannot
 * come out different widths; `satReadingLayout.test.ts` asserts the clearance is
 * the full reach and that the difference is what the gutter adds.
 */
export const SAT_NOTES_SEAT_GUTTER_PX = Math.max(
  0,
  SAT_READING_SPLIT_HANDLE_REACH_PX - SAT_NOTES_CHROME_PADDING_PX,
);

/**
 * The gutter a notes seat owes at this presentation.
 *
 * Zero wherever no handle stands beside the pane: a single-pane question has no
 * divider to move, and stacked notes are a full-width row under the panes, so
 * neither reserves anything. Only the split presentation — where the width
 * control rides the divider between the passage and the notes pane — pays it.
 */
export function satNotesSeatGutter(presentation: SatReadingPresentation): number {
  return presentation === 'split' ? SAT_NOTES_SEAT_GUTTER_PX : 0;
}

/** The notes seat at a workspace width: the panel, plus the clearance it owes. */
export function satReadingNotesSeatWidth(
  workspaceWidth: number,
  presentation: SatReadingPresentation,
): number {
  return satNotesColumnWidth(workspaceWidth) + satNotesSeatGutter(presentation);
}

/**
 * The notes seat as the workspace's grid writes it: the panel's band plus the
 * gutter, in the same string the resolver's arithmetic is written against.
 *
 * These live beside the reach rather than beside the band because the gutter is
 * the handle's business: the band says how wide the panel is, and the seat says
 * how much room the pane claims once a divider the student can drag sits against
 * it. (The two modules cannot both hold the number — `satNotesUi` may not import
 * a value from here, or the pair would be a cycle — so the band stays there and
 * the composition happens here.)
 */
export const SAT_READING_NOTES_COLUMN_SEAT_TRACK =
  `calc(${SAT_NOTES_COLUMN_TRACK} + ${SAT_NOTES_SEAT_GUTTER_PX}px)`;
export const SAT_READING_NOTES_PAIR_SEAT_TRACK =
  `calc(${SAT_NOTES_PAIR_TRACK} + ${SAT_NOTES_SEAT_GUTTER_PX}px)`;

/**
 * Slack around the threshold, so the layout cannot flicker at one pixel.
 *
 * Browsers move a width by a pixel or two on their own (scrollbars appearing,
 * safe-area insets, zoom geometry rounding), and a mode that flips back and
 * forth under the student's eyes reads as a bug even when each decision was
 * individually defensible. A split therefore survives until the narrowest pane
 * is meaningfully below the budget, and a stacked layout only returns to split
 * once it is comfortably above it.
 */
export const SAT_READING_LAYOUT_HYSTERESIS_PX = 24;

/** The Display panel's own width when it is anchored over the question pane. */
export const SAT_DISPLAY_PANEL_WIDTH_PX = 320;

/** Breathing room between the anchored Display panel and the question it covers. */
export const SAT_DISPLAY_PANEL_GAP_PX = 24;

/** The readable-pane budget at a student's Text size. */
export function satReadingMinPaneWidth(textScale: number): number {
  const scale = Number.isFinite(textScale) && textScale > 0 ? textScale : 1;
  return SAT_READING_BASE_READABLE_PANE_PX * scale;
}

export interface SatReadingLayoutInput {
  /** The workspace's own logical layout width (`clientWidth`), not a viewport. */
  workspaceWidth: number;
  /** The workspace's own logical layout height; only used for the zero-box check. */
  workspaceHeight: number;
  /** False for a question with no stimulus: one pane, no presentation to pick. */
  hasStimulus: boolean;
  textScale: number;
  splitRatio: number;
  /**
   * The presentation on screen before this measurement; it is what hysteresis
   * anchors to. Derived state only — never persisted, so nothing about a
   * rotation or a narrow window can rewrite the student's saved split ratio.
   */
  previousPresentation?: SatReadingPresentation | undefined;
}

export interface SatReadingLayoutDecision {
  presentation: SatReadingPresentation;
  reason: SatReadingLayoutReason;

  /** The pane budget this decision was measured against. */
  minReadablePaneWidth: number;

  /** The passage pane's width when split; null when there is no passage pane. */
  passageWidth: number | null;
  /** The question pane's width in the active presentation. */
  questionWidth: number;

  /** True when both reading panes clear the budget (hysteresis included). */
  splitFits: boolean;
  /** True when passage, notes, and question all clear the budget side by side. */
  threeColumnNotesFit: boolean;
  /** True when a single question and the notes pane fit side by side. */
  sideNotesFit: boolean;

  displayPresentation: SatDisplayPresentation;
}

/**
 * Resolve the whole reading layout from one measured box.
 *
 * The order is deliberate: the presentation first (can the two reading panes
 * coexist?), then whether the notes pane can join them, then whether Display can
 * sit beside the question without eating it. Each answer is derived from the
 * same width, so none of them can contradict another.
 */
export function resolveSatReadingLayout(
  input: SatReadingLayoutInput,
): SatReadingLayoutDecision {
  const minReadablePaneWidth = satReadingMinPaneWidth(input.textScale);
  const workspaceWidth =
    Number.isFinite(input.workspaceWidth) && input.workspaceWidth > 0 ? input.workspaceWidth : 0;

  // Hysteresis is read off the presentation already on screen: a layout that is
  // split hangs on below the budget, a stacked one waits above it. Everything
  // the resolver decides about readability shares this threshold, so Notes and
  // Display cannot disagree with the panes they sit beside.
  const threshold =
    input.previousPresentation === 'split'
      ? minReadablePaneWidth - SAT_READING_LAYOUT_HYSTERESIS_PX
      : input.previousPresentation === 'stacked'
        ? minReadablePaneWidth + SAT_READING_LAYOUT_HYSTERESIS_PX
        : minReadablePaneWidth;

  const usableWidth = Math.max(0, workspaceWidth - SAT_READING_SPLIT_DIVIDER_PX);
  const ratio = clampSatReadingSplitRatio(input.splitRatio);
  const passageWidth = input.hasStimulus ? usableWidth * ratio : null;
  const questionWidth = input.hasStimulus ? usableWidth * (1 - ratio) : workspaceWidth;
  const narrowestPane = input.hasStimulus
    ? Math.min(passageWidth ?? 0, questionWidth)
    : questionWidth;

  const splitFits = input.hasStimulus && narrowestPane >= threshold;
  const presentation: SatReadingPresentation = !input.hasStimulus
    ? 'single'
    : splitFits
      ? 'split'
      : 'stacked';
  const reason: SatReadingLayoutReason = !input.hasStimulus
    ? 'single-question'
    : splitFits
      ? 'readable-split'
      : 'insufficient-pane-width';

  // The notes SEAT, not the bare panel: the column takes the same track the CSS
  // builds it from — panel band plus the clearance the divider handle needs — so
  // "notes takes a fifth" cannot mean two different widths in two files, and the
  // gutter the handle stands in is not silently handed back to the panes. What
  // this measures is whether the panes that are LEFT still clear the budget,
  // which is exactly the claim `threeColumnNotesFit` makes.
  const notesSeatWidth = satReadingNotesSeatWidth(workspaceWidth, presentation);
  const besideNotesWidth = Math.max(
    0,
    usableWidth - notesSeatWidth - SAT_READING_SPLIT_DIVIDER_PX,
  );
  const threeColumnNotesFit =
    input.hasStimulus &&
    Math.min(besideNotesWidth * ratio, besideNotesWidth * (1 - ratio)) >= threshold;
  const sideNotesFit = besideNotesWidth >= threshold;

  const uncoveredQuestionWidth =
    questionWidth - SAT_DISPLAY_PANEL_WIDTH_PX - SAT_DISPLAY_PANEL_GAP_PX;
  const displayPresentation: SatDisplayPresentation =
    presentation !== 'stacked' && uncoveredQuestionWidth >= minReadablePaneWidth
      ? 'anchored'
      : 'compact';

  return {
    presentation,
    reason,
    minReadablePaneWidth,
    passageWidth,
    questionWidth,
    splitFits,
    threeColumnNotesFit,
    sideNotesFit,
    displayPresentation,
  };
}
