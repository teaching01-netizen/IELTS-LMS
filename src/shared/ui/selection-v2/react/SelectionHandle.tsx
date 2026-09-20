import React from 'react';
import { motion } from 'motion/react';
import type { SelectionHandleGeometry } from '../domain/selectionTypes';
import { useGripMotion } from './useSelectionMotion';
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
 */
export function SelectionHandle({
  handle,
  label,
  held = false,
  onPointerDown,
}: {
  handle: SelectionHandleGeometry;
  label: string;
  /** This endpoint is the one being dragged right now. */
  held?: boolean | undefined;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const { initial, animate, transition, ...witness } = useGripMotion(held);

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
      <motion.span
        aria-hidden="true"
        className="selection-v2-grip"
        initial={initial}
        animate={animate}
        transition={transition}
        {...witness}
      />
    </button>
  );
}
