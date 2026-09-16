import { defaultSatHighlightColor, isSatHighlightColor, type SatHighlightColor } from './satResponses';

/**
 * Highlights & Notes education state — what the interface has already TAUGHT
 * this student, never what it can DO.
 *
 * This module is deliberately ignorant of annotations: it answers only "should
 * this cue still appear?". Deleting the entire education layer (this file, the
 * store, the ui/education components) leaves annotation functionality intact,
 * which is the contract that keeps teaching removable.
 *
 * Storage is per attempt (see the education store); it exists to SUPPRESS
 * introductory cues after the student has demonstrated understanding, never to
 * change what any control does.
 */
export interface SatAnnotationEducationState {
  /** The passive "Select text to highlight" line has been shown once. */
  sawHighlightHint: boolean;
  /** The student has made a highlight; the one-time confirmation is spent. */
  createdFirstHighlight: boolean;
  /** The student has written a note on selected text. */
  createdFirstNote: boolean;
  /** Ink used last — the swatch the next highlight starts from. */
  lastHighlightColor: SatHighlightColor;
}

export function createDefaultSatAnnotationEducationState(): SatAnnotationEducationState {
  return {
    sawHighlightHint: false,
    createdFirstHighlight: false,
    createdFirstNote: false,
    lastHighlightColor: defaultSatHighlightColor,
  };
}

function bool(value: unknown): boolean {
  return value === true;
}

/**
 * Strict normalizer: unknown shapes repair to defaults instead of throwing, so
 * a corrupted or future-shaped education record can never block the exam.
 */
export function normalizeSatAnnotationEducationState(value: unknown): SatAnnotationEducationState {
  const base = createDefaultSatAnnotationEducationState();
  if (!value || typeof value !== 'object') return base;
  const record = value as Record<string, unknown>;
  return {
    sawHighlightHint: bool(record['sawHighlightHint']),
    createdFirstHighlight: bool(record['createdFirstHighlight']),
    createdFirstNote: bool(record['createdFirstNote']),
    lastHighlightColor: isSatHighlightColor(record['lastHighlightColor'])
      ? record['lastHighlightColor']
      : base.lastHighlightColor,
  };
}

/** Delay before the passive hint appears, so it reads as an aside, not an alert. */
export const SAT_ANNOTATION_HINT_DELAY_MS = 1200;
/** How long the untouched passive hint stays before it retires itself. */
export const SAT_ANNOTATION_HINT_DURATION_MS = 5000;
/** Lifetime of the one-time "Highlighted" confirmation. */
export const SAT_ANNOTATION_CONFIRMATION_MS = 800;
/** How long the removal toast (with Undo) stays reachable. */
export const SAT_ANNOTATION_UNDO_MS = 5000;

/**
 * The whole teaching policy in one place.
 *
 * Rules from the spec, encoded so they cannot drift: the hint appears once per
 * attempt, only on an interactive R&W question, and only while nothing else is
 * happening. A selection retires it permanently — demonstrating the gesture is
 * exactly the moment to stop explaining it.
 */
export function shouldShowSatAnnotationHint(
  state: SatAnnotationEducationState,
  context: { annotationsAvailable: boolean; blocked: boolean; hasSelection: boolean; answered: boolean },
): boolean {
  if (state.sawHighlightHint) return false;
  if (!context.annotationsAvailable || context.blocked) return false;
  if (context.hasSelection || context.answered) return false;
  return true;
}
