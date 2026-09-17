import type { CSSProperties } from 'react';
import type { AnnotationPlacement, SatAnnotationMode } from './satSelectionGeometry';

/**
 * The chrome of the annotation surface, in one place for every surface that has
 * it: the selection tools and a mark's edit tools are the same object in two
 * states, and the only thing that distinguishes them is which actions they hold.
 *
 * This exists because placement runs to four outcomes — floating above, floating
 * below, docked, hidden — and a second copy of that mapping in the edit surface
 * would drift from this one the first time either changed. It is deliberately
 * not a component: the surfaces need the mode themselves (to choose their own
 * actions and their own quote), so they take the chrome and render their own
 * children inside it, and the caret comes along for the ride.
 */

/** Where a surface sits before its placement lands. */
export const SAT_ANNOTATION_SURFACE_INSET = 8;

/**
 * The surface's row rhythm, owned here because it is a property of the surface
 * rather than of any one set of actions: the selection tools and a mark's edit
 * tools space their rows identically, and a second copy of these classes is how
 * the two drift apart.
 */
export const SAT_ANNOTATION_ROW = 'mt-[var(--sat-annotation-row-gap)]';
/** A row that is separated from the one above it, for a destructive action. */
export const SAT_ANNOTATION_ROW_DIVIDED =
  SAT_ANNOTATION_ROW
  + ' flex flex-wrap items-center gap-2 border-t border-[var(--sat-divider)] pt-[var(--sat-annotation-row-gap)]';

const SURFACE_BASE = 'sat-ui absolute z-[80] ';
const SURFACE_FLOATING =
  'sat-annotation-surface-floating rounded-[10px]'
  + ' border border-[var(--sat-answer-border)] bg-[var(--sat-surface)]'
  + ' px-[var(--sat-annotation-surface-padding-x)] py-[var(--sat-annotation-surface-padding-y)]'
  + ' shadow-[var(--sat-shadow-floating)]';
const SURFACE_DOCKED =
  'sat-annotation-surface-docked overflow-y-auto rounded-t-[10px]'
  + ' border-t border-[var(--sat-divider-strong)] bg-[var(--sat-surface)]'
  + ' px-[var(--sat-annotation-surface-padding-x)]'
  + ' pt-[var(--sat-annotation-surface-padding-y)]'
  + ' pb-[max(var(--sat-annotation-surface-padding-y),env(safe-area-inset-bottom))]'
  + ' shadow-[var(--sat-annotation-dock-shadow)]';

export interface SatAnnotationSurfaceChrome {
  mode: SatAnnotationMode | null;
  /** Full-bleed sheet at the bottom of the visible region. */
  docked: boolean;
  /** Toolbar against the selection, with a caret pointing at it. */
  floating: boolean;
  /** Mounted but out of the way: off screen, or waiting for geometry to settle. */
  hidden: boolean;
  className: string;
  style: CSSProperties;
}

export function satAnnotationSurfaceChrome(placement: AnnotationPlacement | null): SatAnnotationSurfaceChrome {
  const mode = placement?.mode ?? null;
  const docked = mode === 'docked';
  const floating = mode === 'floating';
  const hidden = mode === null || mode === 'hidden';
  return {
    mode,
    docked,
    floating,
    hidden,
    className:
      SURFACE_BASE
      + (docked ? SURFACE_DOCKED : SURFACE_FLOATING)
      // Only a move big enough to notice settles; a nudge is applied directly, so
      // the surface never chases a selection handle.
      + (floating && placement?.animated ? ' sat-annotation-settle' : ''),
    style: {
      left: placement?.left ?? SAT_ANNOTATION_SURFACE_INSET,
      top: placement?.top ?? SAT_ANNOTATION_SURFACE_INSET,
      // The engine owns the shape once it has measured one: it is the only thing
      // that knows how much of the visible region the surface may have. Until
      // then the natural width is the token maximum, and NEVER zero — a hidden
      // placement that collapsed the box would have its own collapse measured
      // back on the next pass, and the surface would stay 30px wide (padding and
      // border) for the rest of the selection's life.
      width: placement && placement.width > 0
        ? placement.width
        : 'min(var(--sat-annotation-surface-max), 100%)',
      // A sheet is bounded by the room beneath its own top edge, so a viewport
      // too short for it makes it scroll rather than hang off the screen. The
      // floating surface is already clamped inside that bound, and carries a
      // caret that lives outside the box — which is why only the dock scrolls.
      maxHeight: placement && placement.maxHeight > 0 ? placement.maxHeight : undefined,
      visibility: hidden ? 'hidden' : 'visible',
    },
  };
}

/**
 * The caret: the whole spatial argument that this control belongs to THAT line.
 *
 * Floating only — a docked sheet is already the student's answer to "where did
 * my tools go" — and positioned inside a layer that sits on the surface's border
 * box, so the engine's border-box coordinates and the browser's padding-box
 * positioning agree.
 */
export function SatAnnotationCaret({ placement }: { placement: AnnotationPlacement | null }) {
  if (!placement || placement.mode !== 'floating') return null;
  return (
    <span aria-hidden="true" className="sat-annotation-caret-layer">
      <span
        data-sat-annotation-caret={placement.side === 'above' ? 'down' : 'up'}
        className="sat-annotation-caret"
        style={{ left: placement.arrowX }}
      />
    </span>
  );
}
