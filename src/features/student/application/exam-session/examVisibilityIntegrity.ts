/**
 * Exam visibility integrity — the ONE detection rule.
 *
 * Product claim (deliberately narrow): the exam document became hidden during
 * the exam and the student came back. The browser cannot report *why* it became
 * hidden — another tab, another app, a locked screen, and a system overlay all
 * look the same — and it cannot report that anyone cheated. So the violation
 * stays `TAB_SWITCH` (the vocabulary the proctor auto-response rules already
 * understand) and the payload says only what Page Visibility establishes.
 *
 * The rule is an excursion, not a timer:
 *
 *   visible --hidden--> remember hiddenAt only (no timers, nothing to run)
 *   hidden  --visible-> emit exactly ONE excursion with hiddenDurationMs
 *
 * That matters most on iPhone/iPad: WebKit suspends background pages, so any
 * "hidden + setTimeout(500ms)" heuristic silently loses real switches. Nothing
 * here needs to execute while the page is away, and a reload/navigation never
 * completes a same-document excursion, so refreshes are not violations.
 *
 * `blur` is intentionally not evidence. A soft keyboard, native picker,
 * permission prompt, address bar, or accessibility interaction can blur the
 * page while it stays visible; a violation requires an actual Page Visibility
 * transition.
 */

export const EXAM_VISIBILITY_VIOLATION_TYPE = 'TAB_SWITCH' as const;
export const EXAM_VISIBILITY_SOURCE = 'page_visibility' as const;

/** Canonical student-facing copy — one wording for every provider. */
export const EXAM_VISIBILITY_WARNING_TITLE = 'Stay on the exam screen';
export const EXAM_VISIBILITY_WARNING_MESSAGE =
  'You left the exam screen while the exam was in progress. This event has been recorded. Please remain on this screen until the section is finished.';
export const EXAM_VISIBILITY_WARNING_ACKNOWLEDGE = 'Continue exam';

/** One `visible -> hidden -> visible` sequence of the exam page. */
export interface ExamVisibilityExcursion {
  readonly violationType: typeof EXAM_VISIBILITY_VIOLATION_TYPE;
  readonly source: typeof EXAM_VISIBILITY_SOURCE;
  /** ISO timestamp of the hide transition. */
  readonly hiddenAt: string;
  /** ISO timestamp of the return transition. */
  readonly returnedAt: string;
  readonly hiddenDurationMs: number;
}

export interface ExamVisibilityIntegrityState {
  readonly visibility: 'visible' | 'hidden';
  /**
   * Hide timestamp to charge the current excursion to, or `null` when the page
   * went hidden outside the exam (before it started, after it finished, or while
   * the rule was disabled) — such a return is not this exam's violation.
   */
  readonly hiddenAtEpochMs: number | null;
}

export interface ExamVisibilityTransition {
  readonly visible: boolean;
  readonly atEpochMs: number;
}

export interface ExamVisibilityIntegrityResult {
  readonly state: ExamVisibilityIntegrityState;
  readonly excursion: ExamVisibilityExcursion | null;
}

export function createExamVisibilityIntegrityState(
  visibility: 'visible' | 'hidden' = 'visible',
): ExamVisibilityIntegrityState {
  // Starting hidden (reload into a background tab, mount while away) is a
  // baseline, not an excursion: there is no observed hide to charge.
  return { visibility, hiddenAtEpochMs: null };
}

export function reduceExamVisibilityIntegrity(
  state: ExamVisibilityIntegrityState,
  transition: ExamVisibilityTransition,
): ExamVisibilityIntegrityResult {
  const visibility = transition.visible ? 'visible' : 'hidden';

  // Duplicate lifecycle noise (hidden/hidden, visible/visible) is not an event.
  if (visibility === state.visibility) {
    return { state, excursion: null };
  }

  if (!transition.visible) {
    return {
      state: { visibility: 'hidden', hiddenAtEpochMs: transition.atEpochMs },
      excursion: null,
    };
  }

  // hidden -> visible. Nothing to charge when the hide was never armed.
  if (state.hiddenAtEpochMs === null) {
    return { state: { visibility: 'visible', hiddenAtEpochMs: null }, excursion: null };
  }

  return {
    state: { visibility: 'visible', hiddenAtEpochMs: null },
    excursion: {
      violationType: EXAM_VISIBILITY_VIOLATION_TYPE,
      source: EXAM_VISIBILITY_SOURCE,
      hiddenAt: new Date(state.hiddenAtEpochMs).toISOString(),
      returnedAt: new Date(transition.atEpochMs).toISOString(),
      hiddenDurationMs: Math.max(0, transition.atEpochMs - state.hiddenAtEpochMs),
    },
  };
}

/**
 * The audit payload both providers send. Provider-specific envelopes differ
 * (IELTS writes a student audit event, SAT posts a delivery audit), but the
 * facts about the excursion must not.
 */
export function examVisibilityAuditDetail(excursion: ExamVisibilityExcursion): {
  source: typeof EXAM_VISIBILITY_SOURCE;
  hiddenAt: string;
  returnedAt: string;
  hiddenDurationMs: number;
} {
  return {
    source: excursion.source,
    hiddenAt: excursion.hiddenAt,
    returnedAt: excursion.returnedAt,
    hiddenDurationMs: excursion.hiddenDurationMs,
  };
}
