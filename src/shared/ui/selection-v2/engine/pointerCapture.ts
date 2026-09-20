/**
 * Follow one pointer from wherever the browser retargets it to.
 *
 * The gesture needs every move and the one release that belongs to the pointer
 * that started it, even after the finger has travelled off the element — a passage
 * is long, the finger leaves the paragraph's box, and a drag that stopped
 * receiving moves would freeze the selection mid-gesture.
 *
 * Pointer capture is the platform's answer and this module's first choice: the
 * subsequent events are delivered to the element the gesture started on, so the
 * listeners live there and die with it, and a stray finger elsewhere cannot move
 * this selection. Capture can be absent or refused — a synthetic event from a
 * test, a renderer without the API, a pointer id the browser no longer knows —
 * and the only way to tell "held" from "accepted and did nothing" is
 * `hasPointerCapture`, which is why the document is listened on in exactly that
 * case rather than always. A document-wide drag listener for every gesture is
 * what this replaces.
 *
 * Owned nothing beyond the listeners it returns a way to remove, so it is a plain
 * function rather than a hook: the caller decides when a follow begins and ends.
 */

export interface PointerFollow {
  /** Stop following, and drop capture if it is still held. */
  release: () => void;
}

export interface PointerFollowTargets {
  onMove: (event: PointerEvent) => void;
  onUp: (event: PointerEvent) => void;
  onCancel: (event: PointerEvent) => void;
}

export function followPointer(
  pointerId: number,
  element: Element | null,
  targets: PointerFollowTargets,
): PointerFollow | null {
  if (!element) return null;

  const guarded = (handler: (event: PointerEvent) => void) => (raw: Event) => {
    const pointerEvent = raw as PointerEvent;
    if (pointerEvent.pointerId !== pointerId) return;
    handler(pointerEvent);
  };

  const move = guarded(targets.onMove);
  const up = guarded(targets.onUp);
  const cancel = guarded(targets.onCancel);

  const capable = element as Element & {
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
    hasPointerCapture?: (pointerId: number) => boolean;
  };
  let captured = false;
  try {
    if (typeof capable.setPointerCapture === 'function') {
      capable.setPointerCapture(pointerId);
      captured = typeof capable.hasPointerCapture !== 'function' || capable.hasPointerCapture(pointerId);
    }
  } catch {
    captured = false;
  }

  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', up);
  element.addEventListener('pointercancel', cancel);
  if (!captured) {
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
  }

  return {
    release: () => {
      try {
        capable.releasePointerCapture?.(pointerId);
      } catch {
        // A pointer that is already gone cannot be released.
      }
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
    },
  };
}
