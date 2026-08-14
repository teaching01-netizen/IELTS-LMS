/**
 * Pure viewport policy for the student exam shell.
 *
 * This module deliberately contains no React and no DOM access. It decides
 * three things from raw facts:
 *
 *   - what height the exam shell should keep (`stableExamHeight`)
 *   - whether a software keyboard is probably open (`keyboardOpen`)
 *   - whether a resize event should commit a new layout baseline
 *     (`shouldCommitNewBaseline`)
 *
 * The rule that keeps the footer from jumping above the iPad keyboard:
 *
 *   editable element focused
 *   + meaningful visual viewport reduction
 *   = probable software keyboard
 *
 * A plain viewport shrink without an editable focus is browser chrome
 * (Safari address/tab bars, split view) and is allowed to update the
 * baseline. Orientation changes always establish a new baseline.
 */

export type StudentViewportOrientation = 'portrait' | 'landscape';

export interface StudentViewportPolicyInput {
  /** Height the exam shell was last committed to (px), or null before first settle. */
  readonly previousStableHeight: number | null;
  /** Current visual viewport height (px); 0 or negative when unavailable. */
  readonly currentVisualHeight: number;
  /** Layout viewport height (px), used as a fallback sample. */
  readonly layoutHeight: number;
  /** True while an editable answer control has focus. */
  readonly editableFocused: boolean;
  readonly orientation: StudentViewportOrientation;
  readonly previousOrientation: StudentViewportOrientation | null;
  /** Current keyboard inference state (persisted between evaluations). */
  readonly keyboardOpen: boolean;
}

export interface StudentViewportPolicyOutput {
  readonly stableExamHeight: number;
  readonly keyboardOpen: boolean;
  readonly shouldCommitNewBaseline: boolean;
}

/**
 * A viewport shrink is treated as a software keyboard only when it is
 * meaningful: an absolute reduction of at least KEYBOARD_REDUCTION_PX, or a
 * proportional reduction below KEYBOARD_REDUCTION_RATIO of the stable height.
 * Small jitter (e.g. 900 -> 850) is never a keyboard.
 */
export const KEYBOARD_REDUCTION_PX = 120;
export const KEYBOARD_REDUCTION_RATIO = 0.8;
/** Height (px) the visual viewport must recover to before the keyboard closes. */
export const KEYBOARD_RESTORE_TOLERANCE_PX = 24;

export function isMeaningfulKeyboardReduction(
  currentVisualHeight: number,
  stableHeight: number,
): boolean {
  if (stableHeight <= 0 || currentVisualHeight <= 0) {
    return false;
  }
  const reduction = stableHeight - currentVisualHeight;
  return (
    reduction >= KEYBOARD_REDUCTION_PX ||
    currentVisualHeight <= stableHeight * KEYBOARD_REDUCTION_RATIO
  );
}

export function resolveStudentExamViewportPolicy(
  input: StudentViewportPolicyInput,
): StudentViewportPolicyOutput {
  const {
    previousStableHeight,
    currentVisualHeight,
    layoutHeight,
    editableFocused,
    orientation,
    previousOrientation,
    keyboardOpen,
  } = input;

  const visualHeight =
    Number.isFinite(currentVisualHeight) && currentVisualHeight > 0
      ? currentVisualHeight
      : layoutHeight;

  // Orientation changes invalidate any portrait/landscape baseline, even when
  // an input was focused (the keyboard closes during rotation on iPad).
  if (previousOrientation !== null && previousOrientation !== orientation) {
    return {
      stableExamHeight: visualHeight,
      keyboardOpen: false,
      shouldCommitNewBaseline: true,
    };
  }

  if (editableFocused) {
    const stable = previousStableHeight;
    if (stable !== null && isMeaningfulKeyboardReduction(visualHeight, stable)) {
      // Keyboard: freeze the shell at the pre-keyboard height.
      return {
        stableExamHeight: stable,
        keyboardOpen: true,
        shouldCommitNewBaseline: false,
      };
    }
    if (keyboardOpen && stable !== null && visualHeight >= stable - KEYBOARD_RESTORE_TOLERANCE_PX) {
      // The keyboard closed: the stable height is still the right baseline.
      return {
        stableExamHeight: stable,
        keyboardOpen: false,
        shouldCommitNewBaseline: false,
      };
    }
    // Focused but no meaningful reduction: keep whatever baseline exists.
    return {
      stableExamHeight: stable ?? visualHeight,
      keyboardOpen: false,
      shouldCommitNewBaseline: stable === null,
    };
  }

  // No editable focus: Safari chrome may shrink the viewport freely.
  const baselineChanged =
    previousStableHeight === null || Math.abs(previousStableHeight - visualHeight) > 1;
  return {
    stableExamHeight: visualHeight,
    keyboardOpen: false,
    shouldCommitNewBaseline: baselineChanged,
  };
}
