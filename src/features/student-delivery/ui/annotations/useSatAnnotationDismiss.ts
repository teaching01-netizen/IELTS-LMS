import { useEffect, useRef } from 'react';

/**
 * Close an annotation popover when the student presses anywhere outside it.
 *
 * A toolbar that appeared for a selection and then refuses to leave is the thing
 * students complain about: they read on, and the controls for a sentence three
 * paragraphs back are still on screen. Every system selection menu on the
 * platform dismisses on an outside press, and this is that behavior.
 *
 * Three decisions are the whole implementation:
 *
 * - `pointerdown`, in the CAPTURE phase. One event, ahead of any control's own
 *   handler — a pointer that lands outside is the student leaving, and it must
 *   be read that way even when the press turns out to be the beginning of a NEW
 *   selection (which opens the tools again, for the new text).
 * - Containment, and only containment. The caret layer and every control are
 *   children of the surface's node, so "is the target inside this node" is the
 *   entire test for "was this press a command".
 * - No `preventDefault`, and nothing that touches the native selection.
 *   Dismissing our chrome is not the same as clearing what the student
 *   highlighted in the page: the browser's own selection stays exactly as they
 *   left it, and closing the surface is a pure state change (the interaction
 *   machine's `selectionCleared`, which never touches `window.getSelection()`).
 *
 * The latest callback is called through a ref, so a re-render can never re-bind
 * the listener mid-gesture and no stale closure can close the wrong surface.
 *
 * Documented consequences: a wheel or trackpad scroll is not a press and does
 * not dismiss anything; and on a coarse pointer, dragging a native selection
 * handle is an outside press, so the tools close and come back a moment later
 * when the drag ends and the selection is reported again.
 */
export function useSatAnnotationDismiss(
  containerRef: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      dismiss.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [containerRef]);
}
