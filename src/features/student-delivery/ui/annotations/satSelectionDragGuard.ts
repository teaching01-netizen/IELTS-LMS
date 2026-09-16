/**
 * Gesture guard shared by the answer controls and the annotated content.
 *
 * Two jobs, both about the same fact — a text-selection gesture and a tap look
 * identical to the browser once the finger lifts:
 *
 * 1. ANSWER SAFETY (spec §34). On a touch device a drag that ends over an
 *    answer choice can return as a `click` on the row under the finger, so an
 *    activation arriving inside the guard window is treated as the tail of the
 *    selection, not as intent to answer.
 * 2. TAP vs DRAG on annotated text. A plain tap on a mark opens its editor; a
 *    drag across a mark is a student expressing a NEW selection, and must not
 *    be swallowed as a tap.
 *
 * Both answers are read at activation time and never from a control the
 * gesture does not actually touch: the previous design armed this state from a
 * `pointerdown` on the visually hidden radio input, which a pointer landing on
 * the option's text never reaches — so the guard never armed at all.
 */
let selectionGestureEndedAt = 0;
let gestureOrigin: { x: number; y: number; at: number } | null = null;

/** How long after a selection gesture a click is still treated as a mis-tap. */
export const SAT_SELECTION_GUARD_MS = 400;

/** Movement beyond this many CSS pixels turns a tap into a drag. */
export const SAT_TAP_SLOP_PX = 8;

/**
 * A press this old is no longer the gesture that is now releasing — a slow
 * deliberate drag stays well inside it, while a press from an earlier gesture
 * can never be mistaken for this one's origin.
 */
export const SAT_GESTURE_MAX_MS = 5_000;

/** Called by the annotated content when a text-selection gesture completes. */
export function markSatSelectionGestureEnded(now: number = Date.now()): void {
  selectionGestureEndedAt = now;
}

export function clearSatSelectionGesture(): void {
  selectionGestureEndedAt = 0;
}

/**
 * True when an activation arriving now is better explained as the tail of a
 * text selection than as a deliberate answer choice.
 */
export function isSatSelectionGestureEcho(now: number = Date.now()): boolean {
  if (selectionGestureEndedAt === 0) return false;
  const elapsed = now - selectionGestureEndedAt;
  return elapsed >= 0 && elapsed < SAT_SELECTION_GUARD_MS;
}

/** Called on pointerdown inside annotated content: remember where it began. */
export function markSatPointerDown(x: number, y: number, now: number = Date.now()): void {
  gestureOrigin = { x, y, at: now };
}

export function clearSatGestureOrigin(): void {
  gestureOrigin = null;
}

/**
 * True when the pointer that is now lifting has travelled far enough to be a
 * drag. An unknown origin (a keyboard activation, a programmatic click) is a
 * tap, never a drag — a missing measurement must not swallow an activation.
 */
export function isSatDragRelease(
  x: number,
  y: number,
  slop: number = SAT_TAP_SLOP_PX,
  now: number = Date.now(),
): boolean {
  if (!gestureOrigin) return false;
  if (now - gestureOrigin.at >= SAT_GESTURE_MAX_MS) return false;
  const dx = x - gestureOrigin.x;
  const dy = y - gestureOrigin.y;
  return dx * dx + dy * dy > slop * slop;
}
