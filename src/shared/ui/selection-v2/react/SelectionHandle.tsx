import React from 'react';
import { motion } from 'motion/react';
import type { SelectionHandleGeometry } from '../domain/selectionTypes';
import { useCaretSnapMotion, useGripMotion } from './useSelectionMotion';
import { selectionMotion } from '@shared/motion';
import '../styles/selection.css';

/**
 * One end of a selection, and the only part of the overlay a finger can hit.
 *
 * A real `<button>`, not a painted dot. The visual grabber is 12px because that
 * is what reads as precise; the control around it is the full 44×44 a finger
 * actually needs, and it carries a label so the same adjustment is reachable
 * without sight and without a drag. Everything is positioned by transform, so a
 * reflow moves the handle without laying the line out again under the finger.
 *
 * The grip is the app's one animated thing here, and it is animated INSIDE the
 * target: the button's transform is the engine's measurement, written directly
 * and never tweened, so the thing a student aims at is exactly where the text
 * says it is. A handle that eased its way to its endpoint would be a control that
 * arrives after the finger does — and it would put the entrance animation in the
 * path of every drag, which is the one thing the overlay may not do.
 *
 * There are therefore exactly two animations inside this button and they are
 * nested rather than merged: the grip's own settle (does it swell because it is
 * being held), and around it the TICK (did the resolved caret just cross into a
 * new character). Nesting is what lets the second exist without the first having
 * to learn about it, and without either of them ever reaching the 44×44 target —
 * which is item one of this file's contract and is never tweened.
 */
export function SelectionHandle({
  handle,
  label,
  held = false,
  snapRevision = 0,
  onPointerDown,
}: {
  handle: SelectionHandleGeometry;
  label: string;
  /** This endpoint is the one being dragged right now. */
  held?: boolean | undefined;
  /**
   * How many times the resolved caret has changed. Drives the tick on the grip —
   * a swelled dot on a crossed boundary, and nothing at all on a finger moving
   * inside one glyph. Zero means there has never been one (see
   * `useCaretSnapMotion`, including why the handle's own target and the grip's
   * settle animation are both left out of it).
   */
  snapRevision?: number | undefined;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const { initial, animate, transition, ...witness } = useGripMotion(held);
  const snap = useCaretSnapMotion(snapRevision, selectionMotion.caretSnapGripScale);

  return (
    <button
      type="button"
      data-student-selection-handle={handle.edge}
      data-stem={handle.stem}
      aria-label={label}
      className="selection-v2 selection-v2-handle"
      style={{ transform: `translate3d(${handle.x}px, ${handle.y}px, 0) translate(-50%, -50%)`, pointerEvents: 'auto' }}
      onPointerDown={onPointerDown}
    >
      {/* The tick lives HERE, around the grip: swelling this scales the grip and
          its stem and dot with it, while the measured target above and the grip's
          own settle below stay exactly as they were. */}
      <motion.span className="selection-v2-grip-tick" animate={snap}>
        <motion.span
          aria-hidden="true"
          className="selection-v2-grip"
          initial={initial}
          animate={animate}
          transition={transition}
          {...witness}
        />
      </motion.span>
    </button>
  );
}
