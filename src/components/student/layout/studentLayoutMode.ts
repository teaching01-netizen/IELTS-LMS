// S1-C1 / P2.1: layout mode is a pure policy over shell geometry facts, not
// width alone. The decision order (invalid → phone → wide → standard →
// compact/focus) comes from plans/ielts-act-ux-production/phase-02-adaptive-workspace.md:
//
//   1. Invalid/unmeasured geometry gets a safe focus/compact layout while
//      the UI stays mounted awaiting measurements.
//   2. Width <600px means phone (compact).
//   3. Width >=1180px, stable shell height >=650px, and pane-fit = wide.
//   4. Width >=900px, stable shell height >=600px, and pane-fit = standard.
//   5. Otherwise compact/focus presentation.
//
// The 650/600 thresholds refer to the OUTER stable shell height after
// safe-area clearance — not the remaining content height. Pane-fit is
// decided separately: both readable minimum pane widths plus one rail must
// fit, and split view needs an initial 360px of usable workspace height.

/** Widths below this are phone presentation. */
export const STUDENT_PHONE_MAX_WIDTH_PX = 600;
/** Wide mode requires at least this shell width. */
export const STUDENT_WIDE_MIN_WIDTH_PX = 1180;
/** Standard mode requires at least this shell width. */
export const STUDENT_STANDARD_MIN_WIDTH_PX = 900;
/** Wide mode requires at least this stable shell height. */
export const STUDENT_WIDE_MIN_SHELL_HEIGHT_PX = 650;
/** Standard mode requires at least this stable shell height. */
export const STUDENT_STANDARD_MIN_SHELL_HEIGHT_PX = 600;
/** Split view needs at least this usable workspace height. */
export const STUDENT_SPLIT_MIN_WORKSPACE_HEIGHT_PX = 360;

/**
 * Readable outer-pane minimums at normal text size, including each pane's
 * own padding. These replace the unusable 48px historical minimums; callers
 * enlarge them for explicit text-size preferences via
 * `scalePaneMinimumsForFontScale`.
 */
export const STUDENT_MIN_MATERIAL_PANE_WIDTH_PX = 380;
export const STUDENT_MIN_ANSWER_PANE_WIDTH_PX = 430;
/** One rail between the panes, subtracted exactly once. */
export const STUDENT_SPLIT_RAIL_WIDTH_PX = 10;

export type StudentLayoutMode = 'phone' | 'compact' | 'standard' | 'wide';

export interface StudentLayoutFacts {
  /** Outer shell/container width in CSS px. */
  readonly containerWidth: number;
  /** Outer stable shell height after safe-area clearance (px), or null while unmeasured. */
  readonly stableShellHeight: number | null;
  /** Remaining actual content height of the workspace (px), or null while unmeasured. */
  readonly workspaceHeight: number | null;
  /** Readable minimum outer width of the material pane (px). */
  readonly minMaterialWidth: number;
  /** Readable minimum outer width of the answer pane (px). */
  readonly minAnswerWidth: number;
  /** Rail width between panes, counted once (px). */
  readonly railWidth: number;
}

export interface StudentLayoutDecision {
  readonly layoutMode: StudentLayoutMode;
  /** True when both split panes fit at their readable minimums. */
  readonly splitView: boolean;
}

/** Enlarge readable pane minimums for explicit text preferences (Large = 1.16). */
export function scalePaneMinimumsForFontScale(min: number, fontScale: number): number {
  const safeScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return Math.round(min * safeScale);
}

/** True when both outer panes plus one rail fit within the given width. */
export function panesFitWidth(facts: Pick<StudentLayoutFacts, 'containerWidth' | 'minMaterialWidth' | 'minAnswerWidth' | 'railWidth'>): boolean {
  return (
    facts.containerWidth >=
    facts.minMaterialWidth + facts.railWidth + facts.minAnswerWidth
  );
}

/** True when split view has enough usable workspace height. Unmeasured (null) is assumed to fit; the measured check is decisive once the shell reports real geometry. */
export function panesFitHeight(workspaceHeight: number | null): boolean {
  return workspaceHeight === null ? true : workspaceHeight >= STUDENT_SPLIT_MIN_WORKSPACE_HEIGHT_PX;
}

/**
 * Pure layout decision. Invalid/unmeasured geometry resolves to the safe
 * compact layout (UI stays mounted while measurements arrive); pane-fit is
 * decisive inside each width band and can only downgrade split → compact,
 * never upgrade compact → split.
 */
export function resolveStudentLayoutMode(facts: StudentLayoutFacts): StudentLayoutDecision {
  const width = facts.containerWidth;
  const widthValid = Number.isFinite(width) && width > 0;
  if (!widthValid) {
    return { layoutMode: 'compact', splitView: false };
  }

  const splitFits = panesFitWidth(facts) && panesFitHeight(facts.workspaceHeight);

  if (width >= STUDENT_WIDE_MIN_WIDTH_PX) {
    const heightOk =
      facts.stableShellHeight === null || facts.stableShellHeight >= STUDENT_WIDE_MIN_SHELL_HEIGHT_PX;
    if (heightOk && splitFits) {
      return { layoutMode: 'wide', splitView: true };
    }
    // Wide width but split cannot fit (short window / enlarged text): the
    // shell keeps its wide chrome, panes collapse to one (focus override).
    return { layoutMode: heightOk ? 'wide' : 'standard', splitView: false };
  }

  if (width >= STUDENT_STANDARD_MIN_WIDTH_PX) {
    const heightOk =
      facts.stableShellHeight === null || facts.stableShellHeight >= STUDENT_STANDARD_MIN_SHELL_HEIGHT_PX;
    if (heightOk && splitFits) {
      return { layoutMode: 'standard', splitView: true };
    }
    return { layoutMode: 'compact', splitView: false };
  }

  if (width < STUDENT_PHONE_MAX_WIDTH_PX) {
    return { layoutMode: 'phone', splitView: false };
  }

  return { layoutMode: 'compact', splitView: false };
}

/**
 * Back-compat helper for callers that only know the width (tests, previews).
 * Uses the normal-text pane minimums and treats height as unknown, matching
 * the previous width-only signature while resolving through the new policy.
 */
export function getStudentLayoutMode(width: number): StudentLayoutMode {
  return resolveStudentLayoutMode({
    containerWidth: width,
    stableShellHeight: null,
    workspaceHeight: null,
    minMaterialWidth: STUDENT_MIN_MATERIAL_PANE_WIDTH_PX,
    minAnswerWidth: STUDENT_MIN_ANSWER_PANE_WIDTH_PX,
    railWidth: STUDENT_SPLIT_RAIL_WIDTH_PX,
  }).layoutMode;
}

/** Width-only breakpoints kept for callers that need them in isolation. */
export const STUDENT_LAYOUT_BREAKPOINTS = {
  phoneMaxWidth: STUDENT_PHONE_MAX_WIDTH_PX,
  standardMinWidth: STUDENT_STANDARD_MIN_WIDTH_PX,
  wideMinWidth: STUDENT_WIDE_MIN_WIDTH_PX,
} as const;
