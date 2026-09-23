import type { CSSProperties, ReactNode } from 'react';
import type { SelectionMenuMode, SelectionMenuPlacement } from '@shared/ui/selection-v2/engine/selectionPlacement';
import { createSatExamZoomGeometry } from '../zoom/satExamZoomGeometry';

/**
 * The chrome of the annotation surface, in one place for every surface that has
 * it: the selection tools and a mark's edit tools are the same object in two
 * states, and the only thing that distinguishes them is which actions they hold.
 *
 * This exists because placement runs to three outcomes — floating, hidden, and
 * "floating but pinned away from its line" — and a second copy of that mapping
 * in the edit surface would drift from this one the first time either changed. It
 * is deliberately not a component: the surfaces need the mode themselves (to
 * choose their own actions), so they take the chrome and render their own
 * children inside it, and the caret comes along for the ride.
 *
 * A full-bleed sheet docked to the bottom of the visible region used to be a
 * second mode here. It is gone: one presentation, one entrance, one place to
 * fix. What it answered — a viewport too short for the actions — is now the
 * body's own scroll, bounded by the placement.
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

export interface SatAnnotationSurfaceChrome {
  mode: SelectionMenuMode | null;
  /** Toolbar against the selection, with a caret pointing at it. */
  floating: boolean;
  /** Mounted but out of the way: off screen, or waiting for geometry to settle. */
  hidden: boolean;
  /**
   * Tallest the surface's rows may be, in px, or null when the placement has not
   * said. Handed to `SatAnnotationSurfaceBody`, which is the only thing here that
   * scrolls.
   */
  bodyMaxHeight: number | null;
  className: string;
  style: CSSProperties;
}

export function satAnnotationSurfaceChrome(
  placement: SelectionMenuPlacement | null,
  visualScale = 1,
): SatAnnotationSurfaceChrome {
  const geometry = createSatExamZoomGeometry(visualScale);
  const mode = placement?.mode ?? null;
  const floating = mode === 'floating';
  const hidden = mode === null || mode === 'hidden';
  return {
    mode,
    floating,
    hidden,
    bodyMaxHeight: placement && placement.maxHeight > 0
      ? geometry.viewportToLogicalLength(placement.maxHeight)
      : null,
    className:
      SURFACE_BASE
      + SURFACE_FLOATING
      // Only a move big enough to notice settles; a nudge is applied directly, so
      // the surface never chases a selection handle.
      + (floating && placement?.animated ? ' sat-annotation-settle' : ''),
    style: {
      left: placement ? geometry.viewportToLogicalPoint({ x: placement.left, y: 0 }).x : SAT_ANNOTATION_SURFACE_INSET,
      top: placement ? geometry.viewportToLogicalPoint({ x: 0, y: placement.top }).y : SAT_ANNOTATION_SURFACE_INSET,
      // The engine owns the shape once it has measured one: it is the only thing
      // that knows how much of the visible region the surface may have. Until
      // then the natural width is the token maximum, and NEVER zero — a hidden
      // placement that collapsed the box would have its own collapse measured
      // back on the next pass, and the surface would stay 30px wide (padding and
      // border) for the rest of the selection's life.
      width: placement && placement.width > 0
        ? geometry.viewportToLogicalLength(placement.width)
        : 'min(var(--sat-annotation-surface-max), 100%)',
      // The bound the rows scroll inside. Deliberately NOT `overflow` on this
      // node: the caret is drawn just outside the border box, and a scroll
      // container clips whatever overflows it — on both axes, because a single
      // `auto` axis forces the other one too. So the box stays visible and the
      // body below it does the scrolling.
      maxHeight: placement && placement.maxHeight > 0
        ? geometry.viewportToLogicalLength(placement.maxHeight)
        : undefined,
      visibility: hidden ? 'hidden' : 'visible',
    },
  };
}

/**
 * The scrolling body: every row of the surface, inside the bound the placement
 * measured, so a viewport too short for the actions scrolls them instead of
 * hiding them under the keyboard or hanging them off the screen.
 *
 * The caret layer is a sibling of this element, not a child, which is what keeps
 * it out of the clip. The bound subtracts the surface's own padding and border
 * (the tokens the chrome uses) rather than a hand-written number, so a change to
 * either cannot silently start the rows overflowing.
 *
 * `max-height: 100%` is not an option here: a percentage resolves against the
 * parent's height, and the parent is content-sized — the percentage would be
 * read as `none` and the body would never scroll.
 */
export function SatAnnotationSurfaceBody({
  maxHeight,
  children,
}: {
  /** From `chrome.bodyMaxHeight`; null leaves the body uncapped. */
  maxHeight: number | null;
  children: ReactNode;
}) {
  return (
    <div
      data-sat-annotation-surface-body="true"
      className="overflow-y-auto overscroll-contain"
      style={{
        maxHeight: maxHeight === null
          ? undefined
          : `calc(${maxHeight}px - 2 * var(--sat-annotation-surface-padding-y) - 2 * var(--sat-annotation-surface-border))`,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The caret: the whole spatial argument that this control belongs to THAT line.
 *
 * Only when the surface really is against that line. A placement that had to be
 * pinned inside the visible region — a selection covering the screen, a viewport
 * with no room beside the text — is still the right place for the controls to
 * be, but it is no longer beside the line the arrow would point at, so there is
 * nothing honest for a caret to say and it is not drawn.
 *
 * Positioned inside a layer that sits on the surface's border box, so the
 * engine's border-box coordinates and the browser's padding-box positioning
 * agree.
 */
export function SatAnnotationCaret({
  placement,
  visualScale = 1,
}: {
  placement: SelectionMenuPlacement | null;
  visualScale?: number | undefined;
}) {
  if (!placement || placement.mode !== 'floating' || placement.clamped) return null;
  const geometry = createSatExamZoomGeometry(visualScale);
  return (
    <span aria-hidden="true" className="sat-annotation-caret-layer">
      <span
        data-sat-annotation-caret={placement.side === 'above' ? 'down' : 'up'}
        className="sat-annotation-caret"
        style={{ left: geometry.viewportToLogicalLength(placement.arrowX) }}
      />
    </span>
  );
}
