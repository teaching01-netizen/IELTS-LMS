/**
 * Follow one pointer from wherever the browser retargets it to.
 *
 * The gesture needs every move and the one release that belongs to the pointer
 * that started it, even after the finger has travelled off the element — a passage
 * is long, the finger leaves the paragraph's box, and a drag that stopped
 * receiving moves would freeze the selection mid-gesture.
 *
 * Pointer capture is the platform's answer and this module's first choice for
 * MOVES: the subsequent events are delivered to the element the gesture started
 * on, so a stray finger elsewhere cannot move this selection, and a
 * document-wide move listener for every gesture is what this avoids. Capture can
 * be absent or refused — a synthetic event from a test, a renderer without the
 * API, a pointer id the browser no longer knows — and the only way to tell
 * "held" from "accepted and did nothing" is `hasPointerCapture`, which is why
 * moves fall back to the document in exactly that case.
 *
 * TERMINAL EVENTS ARE DIFFERENT, and this module used to get them wrong. The
 * release and the cancel decide whether the gesture ends with a resting
 * selection or stays in `adjusting-*` with the magnifier open forever, so they
 * may not depend on capture continuing to work: Safari can report capture as
 * held and then fail to deliver the terminal event to that element (the element
 * can also leave the document, taking its listeners with it). So `pointerup`
 * and `pointercancel` are ALWAYS listened for on the document as a backup, and
 * two more signals are read as the same terminal cancel:
 *
 *   `lostpointercapture` — capture disappeared while we still owned the pointer;
 *   `visibilitychange` to hidden — the app went to the background mid-gesture
 *   and no terminal event may ever arrive.
 *
 * Duplicate delivery is expected and harmless: a release on the captured
 * element bubbles past the document backup too. The first terminal signal
 * tears every listener down before running its handler, so one physical event
 * is handled exactly once here, and the session rejects any pointer id it no
 * longer owns as a second line of defence.
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
  // A narrowed alias: `stop` is a hoisted declaration and reads the parameter's
  // declared type, which is `Element | null` before this guard.
  const target: Element = element;

  let stopped = false;

  const guarded = (handler: (event: PointerEvent) => void) => (raw: Event) => {
    const pointerEvent = raw as PointerEvent;
    if (pointerEvent.pointerId !== pointerId) return;
    handler(pointerEvent);
  };

  /**
   * A terminal signal: unbind FIRST, then deliver.
   *
   * Unbinding first is what makes duplicate delivery impossible at the source —
   * a release that bubbles from the element to the document finds the backup
   * listener already gone — and it means the handler's own effect chain
   * (`release()`) can release the capture without the `lostpointercapture`
   * that fires in response reading as a second, contradictory terminal event.
   * Idempotent, because `release()` runs the same teardown again.
   */
  const terminal = (handler: (event: PointerEvent) => void) => (raw: Event) => {
    const pointerEvent = raw as PointerEvent;
    if (pointerEvent.pointerId !== pointerId) return;
    stop();
    handler(pointerEvent);
  };

  const move = guarded(targets.onMove);
  const up = terminal(targets.onUp);
  const cancel = terminal(targets.onCancel);

  // The app leaving the foreground mid-gesture: no terminal event may ever
  // arrive for this pointer, and a magnifier left on screen behind the switch
  // is a loupe nobody can close. Cancelled through the same single path.
  const onVisibilityChange = () => {
    if (document.visibilityState !== 'hidden') return;
    stop();
    targets.onCancel({ pointerId } as PointerEvent);
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', cancel);
    target.removeEventListener('lostpointercapture', cancel);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

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
  element.addEventListener('lostpointercapture', cancel);
  // The terminal backups are unconditional — that is the whole point (see the
  // module comment). Moves stay capture-local when capture is held.
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('visibilitychange', onVisibilityChange);
  if (!captured) {
    document.addEventListener('pointermove', move);
  }

  return {
    release: () => {
      // Listeners first, capture second: releasing the capture fires
      // `lostpointercapture`, and by then there must be nobody listening who
      // could read our own release as the gesture being taken away from us.
      stop();
      try {
        capable.releasePointerCapture?.(pointerId);
      } catch {
        // A pointer that is already gone cannot be released.
      }
    },
  };
}
