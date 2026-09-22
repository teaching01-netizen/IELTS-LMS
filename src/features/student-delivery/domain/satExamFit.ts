import { SAT_EXAM_ZOOM_MIN, SAT_EXAM_ZOOM_STEP } from "./satReadingPreferences";

/**
 * Screen-zoom auto-fit ("open at a zoom where the question fits").
 *
 * The exam has one screen-zoom preference (`examZoom`), owned by the student
 * through the Display panel. This module answers a different, narrower
 * question: *when a student opens the exam and has not chosen a zoom yet, what
 * is the largest zoom at which the panes do not have to scroll?*
 *
 * The answer is found by WALKING the candidates, largest first, and stopping at
 * the first one whose panes fit — not by measuring once and computing. Zooming
 * out hands the panes more room and the content reflows, so the overflow at 75%
 * is not a function of the overflow at 100%: only a rendering can answer for a
 * rendering. What lives here is therefore the sequence (what to try next, when
 * to stop) and the verdict for one rendering; the hook owns the measuring.
 *
 * Two properties are deliberate: it only ever shrinks, because magnifying a
 * question past its natural size would be a display preference no student asked
 * for; and it lands on the same 25% grid the Display control steps, so a fitted
 * value is one the student can see, step away from, and keep.
 */

/** The resting point: auto-fit never magnifies, and 1 means "leave it alone". */
export const SAT_EXAM_FIT_CEILING = 1;

/**
 * Zoom steps below the ceiling, largest first: `[1, 0.75, 0.5]`.
 *
 * Spelled from the zoom grid rather than computed, and pinned by a test that
 * checks every value is one `clampSatExamZoom` returns unchanged: a finer step
 * (0.9, say) would be silently normalized back to 1 by the Display control, so
 * the fit would offer a zoom the student could never keep.
 */
export const SAT_EXAM_FIT_CANDIDATES: readonly number[] = [
  SAT_EXAM_FIT_CEILING,
  SAT_EXAM_FIT_CEILING - SAT_EXAM_ZOOM_STEP,
  SAT_EXAM_ZOOM_MIN,
];

/**
 * Slack allowed before a pane counts as overflowing.
 *
 * Rounding is real — a pane whose content is 0.4px taller than its box is not
 * something a student can see, and picking a smaller zoom for it would shrink
 * the whole exam for nothing.
 */
export const SAT_EXAM_FIT_TOLERANCE_PX = 4;

/** One pane's overflow, keeping height against height (see `satExamFitVerdict`). */
export interface SatExamFitPane {
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * What one rendering of the exam says about the fit.
 *
 * Heights are compared against heights only, on purpose: both come from the
 * same element geometry API, so the comparison holds under `zoom` whether an
 * engine reports lengths scaled or unscaled, and nothing here needs the factor.
 *
 * `unmeasurable` is a state of its own rather than "does not fit": a pane that
 * has not been laid out yet (or is hidden, or reports NaN) cannot answer the
 * question, and reading it as overflow would shrink the exam on the strength of
 * a pane the student cannot even see. Such a pane is left out of the verdict,
 * and a rendering with nothing readable in it is never acted on.
 */
export type SatExamFitVerdict = "fits" | "overflows" | "unmeasurable";

export function satExamFitVerdict(
  panes: readonly SatExamFitPane[],
  tolerance = SAT_EXAM_FIT_TOLERANCE_PX,
): SatExamFitVerdict {
  const measurable = panes.filter(
    (pane) =>
      Number.isFinite(pane.scrollHeight) &&
      Number.isFinite(pane.clientHeight) &&
      pane.clientHeight > 0,
  );
  if (measurable.length === 0) return "unmeasurable";
  return measurable.some((pane) => pane.scrollHeight > pane.clientHeight + tolerance)
    ? "overflows"
    : "fits";
}

/**
 * The next zoom to try when the current one does not fit; null at the floor.
 *
 * A current value that is not one of the candidates (a student's own 125%, say)
 * starts the walk at the top: the question is always "what is the largest step
 * at or below the resting point that fits", never "one step below whatever is
 * showing".
 */
export function satExamFitNextZoom(current: number): number | null {
  const index = SAT_EXAM_FIT_CANDIDATES.indexOf(current);
  if (index === -1) return SAT_EXAM_FIT_CANDIDATES[0] ?? null;
  return SAT_EXAM_FIT_CANDIDATES[index + 1] ?? null;
}

/**
 * Which zoom the exam is showing.
 *
 * A walk in flight owns the zoom it is measuring — rendering a candidate is the
 * only way to measure it — and at every other moment the attempt's stored zoom
 * does, or the resting 100% when it has none. Stated once, here, because two
 * places disagreeing about it is how an exam ends up rendering a zoom nobody
 * chose.
 */
export interface SatExamZoomRenderInput {
  /** The candidate a fit is measuring right now; null when no walk is running. */
  probing: number | null;
  /** The attempt's own zoom; null when it has none. */
  stored: number | null;
}

export function resolveSatExamZoom(input: SatExamZoomRenderInput): number {
  return input.probing ?? input.stored ?? SAT_EXAM_FIT_CEILING;
}

export interface SatExamFitGateInput {
  /** The route asked for auto-fit (real delivery, or a harness that opted in). */
  enabled: boolean;
  /**
   * The attempt has already had its automatic zoom decision.
   *
   * Attempt-scoped, not mount-scoped, and it is why this input exists
   * separately from `storedZoom`: an attempt whose first module needed no
   * shrink stores no zoom at all, so "nothing stored" would otherwise let the
   * next module — a fresh mount of the same attempt — decide all over again.
   */
  zoomDecided: boolean;
  /** The attempt's own zoom, or null when it has none. */
  storedZoom: number | null;
  /** Compact/phone layout: it keeps its own scale, never auto-shrinks. */
  compact: boolean;
  /** Paused, submitting, or otherwise not interactive. */
  blocked: boolean;
  /** The fit already ran in this mount (the answer for a walk that gave up). */
  attempted: boolean;
}

/**
 * Whether this mount may fit the zoom.
 *
 * Each input is a way the fit would be wrong: it would run where the route did
 * not ask, re-decide an attempt that already has, override a zoom the student
 * made their own — an explicit 100% included, since a chosen value is a choice
 * and not an absence — shrink a layout that keeps its own scale, move a display
 * setting under a veil, or try a second time in one mount after a walk that
 * already had its answer.
 */
export function satExamFitShouldRun(input: SatExamFitGateInput): boolean {
  return (
    input.enabled &&
    !input.zoomDecided &&
    input.storedZoom === null &&
    !input.compact &&
    !input.blocked &&
    !input.attempted
  );
}
