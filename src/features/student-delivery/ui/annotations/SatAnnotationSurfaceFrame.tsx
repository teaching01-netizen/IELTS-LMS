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
 * children inside it.
 *
 * The shape it maps to is the reference's: a compact white capsule that hugs the
 * row of actions inside it, hanging off the words. No caret, no heading, no
 * closing control — the placement already says which line it belongs to by
 * sitting against it, centred on it.
 *
 * A full-bleed sheet docked to the bottom of the visible region used to be a
 * second mode here. It is gone: one presentation, one entrance, one place to
 * fix. What it answered — a viewport too short for the actions — is now the
 * body's own scroll, bounded by the placement.
 *
 * The surface is also the positioning context for anything a control discloses
 * (the underline's style menu): the body scrolls, so a popover rendered inside
 * it would be clipped to the height of the bar it hangs off. Disclosed UI is
 * portaled into this node instead, which is why every surface wears
 * `data-sat-annotation-surface`.
 */

/** Where a surface sits before its placement lands. */
export const SAT_ANNOTATION_SURFACE_INSET = 8;

/**
 * The surface's row: one line of glyphs, spaced by the surface's own rhythm.
 *
 * Owned here because it is a property of the surface rather than of any one set
 * of actions — the selection tools and a mark's edit tools lay out identically,
 * and a second copy of these classes is how the two drift apart. There is one
 * row now (the reference's bar), so it is also the whole body.
 *
 * NO `flex-wrap`, and that is the point rather than an omission: the reference
 * bar is one line in every state, and a bar that wrapped into two was answering
 * "the actions do not fit" by growing taller — which is exactly the failure the
 * compact metrics and the hugged width above exist to remove. If the visible
 * region really cannot hold the row, the body scrolls it (see
 * `SatAnnotationSurfaceBody`) rather than stacking it.
 */
export const SAT_ANNOTATION_PILL_ROW =
  'flex items-center gap-[var(--sat-annotation-row-gap)]';

const SURFACE_BASE = 'sat-ui absolute z-[80] ';
// The bar is a pill: the reference rounds its ends fully, and the shape is what
// makes a row of quiet glyphs read as one object hanging off the words rather
// than as a panel placed near them.
const SURFACE_FLOATING =
  'sat-annotation-surface-floating rounded-full'
  + ' border border-[var(--sat-answer-border)] bg-[var(--sat-surface)]'
  + ' px-[var(--sat-annotation-surface-padding-x)] py-[var(--sat-annotation-surface-padding-y)]'
  + ' shadow-[var(--sat-shadow-floating)]';

export interface SatAnnotationSurfaceChrome {
  mode: SelectionMenuMode | null;
  /** Toolbar against the selection, centred on the line it acts on. */
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
      // then the capsule hugs its own row and never collapses — a hidden
      // placement that measured zero would have its own collapse read back on
      // the next pass, and the surface would stay as wide as its padding and
      // border for the rest of the selection's life. Hence a MAXIMUM and not a fixed
      // width: the row inside decides how wide the pill is, the token only caps
      // it, and the cap is a ceiling the placement can always meet because it is
      // narrower than the region the placement guarantees.
      width: placement && placement.width > 0
        ? geometry.viewportToLogicalLength(placement.width)
        : undefined,
      maxWidth: 'min(var(--sat-annotation-surface-max), 100%)',
      // The bound the rows scroll inside. Deliberately NOT `overflow` on this
      // node: the surface keeps its own box (and its rounded ends) visible, and
      // the body below it does the scrolling instead. A scroll container here
      // would also be forced onto both axes by a single `auto` axis, which is
      // how a two-row bar appeared in the first place.
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
 * hiding them under the keyboard or hanging them off the screen — and the same
 * rule scrolls a row that is wider than the region it may occupy, which is what
 * keeps the bar one line on a narrow screen instead of two.
 *
 * The bound subtracts the surface's own padding and border (the tokens the
 * chrome uses) rather than a hand-written number, so a change to either cannot
 * silently start the rows overflowing.
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

