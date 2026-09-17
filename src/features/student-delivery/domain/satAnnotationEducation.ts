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
  /**
   * The passive "Select text to highlight" line has retired.
   *
   * It used to mean "the line was shown once", set by a five-second timer once
   * the cue appeared — which is how a student who read slowly, or who opened
   * Highlights & Notes later, was never taught at all. It now means only that
   * the lesson is over: the student demonstrated the gesture. The stored name is
   * unchanged so per-attempt records written by earlier builds still read.
   */
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
/** How long the removal toast (with Undo) stays reachable. */
export const SAT_ANNOTATION_UNDO_MS = 5000;

/**
 * True once the student has shown they know the gesture, whatever cue did it:
 * a selection (the store's `sawHighlightHint`), a first mark, or a first note.
 */
export function satAnnotationHintRetired(state: SatAnnotationEducationState): boolean {
  return state.sawHighlightHint || state.createdFirstHighlight || state.createdFirstNote;
}

/**
 * The whole teaching policy in one place.
 *
 * Rules from the spec, encoded so they cannot drift: the line appears only on an
 * interactive R&W question, only while nothing else is happening, and only for a
 * student who has not annotated anything yet.
 *
 * It is deliberately a function of state rather than of the clock. The line stays
 * available until the student demonstrates the gesture, then never returns for
 * the attempt — a student can discover it by looking at the passage whenever they
 * are ready, instead of having five seconds to notice it on question one.
 */
export function shouldShowSatAnnotationHint(
  state: SatAnnotationEducationState,
  context: {
    annotationsAvailable: boolean;
    blocked: boolean;
    hasSelection: boolean;
    answered: boolean;
    /** True once this question carries a mark or a note; the lesson is over. */
    hasAnnotations: boolean;
  },
): boolean {
  if (satAnnotationHintRetired(state)) return false;
  if (context.hasAnnotations) return false;
  if (!context.annotationsAvailable || context.blocked) return false;
  if (context.hasSelection || context.answered) return false;
  return true;
}

/**
 * How long the line waits before appearing.
 *
 * Pressing Highlights & Notes is a direct request for the tool, so the lesson
 * arrives at once; otherwise it waits, so it reads as a quiet aside rather than
 * an alert firing on load.
 */
export function satAnnotationHintDelayMs(notesColumnOpen: boolean): number {
  return notesColumnOpen ? 0 : SAT_ANNOTATION_HINT_DELAY_MS;
}
