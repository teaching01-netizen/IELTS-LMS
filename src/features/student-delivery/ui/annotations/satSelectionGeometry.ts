import {
  resolveSatAnnotationBudgets,
  type SatAnnotationBudgets,
} from './satAnnotationBudgets';
import type { SatAnchorGeometry, SatRectLike } from './satSelectionAnchor';

/**
 * Where the contextual annotation surface goes, decided from geometry alone.
 *
 * One pure function of measured numbers and a budget, and it touches no DOM: the
 * anchor is resolved in `satSelectionAnchor`, the environment in
 * `satAnnotationPlacementRuntime`, and timing in `useSatAnnotationPlacement`. So
 * every rule the student feels — "float only if there is comfortably enough
 * room", "choose a side once and stay there", "dock when the selection is the
 * whole screen" — is testable without a browser, and the React component never
 * has to know what a visual viewport is.
 *
 * Where the surface goes is expressed in the coordinate space of its container,
 * which is why only the CONTAINER-RECT (bounds) and the VISIBLE-RECT (visual
 * viewport) are needed — never a scroll offset.
 *
 * The toolbar is positioned from the LIVE anchor, never from geometry stored
 * at capture time: a stored rect goes stale on scroll, zoom, or a line-spacing
 * change, and a toolbar floating over the wrong sentence is worse than no
 * toolbar. Callers re-measure on scroll/resize instead.
 */

export type SatAnnotationMode = 'floating' | 'docked' | 'hidden';

export type SatAnnotationSide = 'above' | 'below';

export interface AnnotationPlacement {
  /**
   * `floating` sits against the selection, `docked` is the sheet at the bottom
   * of the visible region the geometry asked for, and `hidden` keeps the surface
   * mounted (and its focus intact) while its anchor is off screen or the
   * viewport is still moving.
   */
  mode: SatAnnotationMode;
  /** Position relative to `bounds` (the surface's positioning container). */
  left: number;
  top: number;
  /** Width the surface must take, so one owner decides its shape. */
  width: number;
  /**
   * Tallest the surface may be without leaving the visible region, measured from
   * its own top. A sheet whose contents need more than the viewport has scrolls
   * inside this bound instead of hanging off the edge of the screen.
   */
  maxHeight: number;
  side: SatAnnotationSide | null;
  /** Where the caret sits along the surface's top edge, in surface-local px. */
  arrowX: number;
  /** A move big enough to settle, rather than a nudge to apply directly. */
  animated: boolean;
}

export interface SatAnnotationPlacementInput {
  anchor: SatAnchorGeometry;
  /** Positioning container; `left`/`top`/`width` in the result are relative to it. */
  bounds: SatRectLike;
  /** The region the surface must stay inside — the VISUAL viewport. */
  viewport: SatRectLike;
  /** Measured surface size. */
  size: { width: number; height: number };
  /** What the surface is doing now, for hysteresis. Null for a fresh selection. */
  previous: AnnotationPlacement | null;
  /** Coarse pointer: the native selection menu exists and claims its own zone. */
  touch: boolean;
  budgets?: Partial<SatAnnotationBudgets> | undefined;
}

/** The surface is mounted but out of the way; nothing about it can be acted on. */
export function hiddenSatAnnotationPlacement(): AnnotationPlacement {
  return { mode: 'hidden', left: 0, top: 0, width: 0, maxHeight: 0, side: null, arrowX: 0, animated: false };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The part of the surface's container that is both on screen and inset. */
function visibleRegion(
  bounds: SatRectLike,
  viewport: SatRectLike,
  edge: number,
): { left: number; top: number; right: number; bottom: number } {
  const viewLeft = viewport.left - bounds.left;
  const viewTop = viewport.top - bounds.top;
  return {
    left: Math.max(edge, viewLeft + edge),
    top: Math.max(edge, viewTop + edge),
    right: Math.min(bounds.width - edge, viewLeft + viewport.width - edge),
    bottom: Math.min(bounds.height - edge, viewTop + viewport.height - edge),
  };
}

function intersectsViewport(anchor: SatAnchorGeometry, viewport: SatRectLike): boolean {
  const overlapsVertically = anchor.bottom > viewport.top && anchor.top < viewport.top + viewport.height;
  const overlapsHorizontally = anchor.right > viewport.left && anchor.left < viewport.left + viewport.width;
  return overlapsVertically && overlapsHorizontally;
}

/**
 * The dock: a sheet pinned to the bottom of what the student can SEE.
 *
 * The vertical edge is the visible region's bottom, not the container's. They
 * differ exactly when the container is taller than the viewport — which is what
 * a software keyboard does to an exam shell that deliberately freezes its own
 * height — and a sheet placed against the container would then be pinned under
 * the keyboard, present but unreachable. Same reasoning for the width: a zoomed
 * or narrowed visible region is the sheet's extent.
 *
 * Both the engine's dock answer and the runtime's forced dock come through here,
 * so there is one definition of where the dock is.
 */
export function placeSatAnnotationDock(
  bounds: SatRectLike,
  viewport: SatRectLike,
  size: { width: number; height: number },
  edge: number,
): AnnotationPlacement {
  const region = visibleRegion(bounds, viewport, edge);
  const top = Math.max(region.top, region.bottom - size.height);
  return {
    mode: 'docked',
    left: region.left,
    top,
    width: Math.max(0, region.right - region.left),
    maxHeight: Math.max(0, region.bottom - top),
    side: null,
    arrowX: 0,
    animated: false,
  };
}

/**
 * Where the contextual surface goes, from geometry alone.
 *
 * The order of the decisions IS the design, and it is the order a student would
 * make them in:
 *
 * 1. the source is gone → nothing to show;
 * 2. the selection IS the screen → there is no "nearby", so dock;
 * 3. the controls would not fit at a usable size → dock;
 * 4. on a coarse pointer, the lane the native selection menu will claim is not
 *    a candidate: the browser paints that menu OVER our surface, so sharing it
 *    means being covered by it. We take the lane the menu leaves;
 * 5. side, kept from the previous placement unless it genuinely stopped
 *    fitting, and moved only to a side that offers real room;
 * 6. otherwise the dock, which is a presentation mode and not a failure.
 *
 * Every move — side to side, and dock back to floating — costs the same
 * `switchMargin` of extra room, so the surface can never oscillate between two
 * arrangements that are both merely adequate.
 */
export function placeSatAnnotationSurface(input: SatAnnotationPlacementInput): AnnotationPlacement {
  const budgets = resolveSatAnnotationBudgets(input.touch, input.budgets);
  const { anchor, bounds, size, viewport } = input;
  const region = visibleRegion(bounds, viewport, budgets.edge);
  const dock = () => placeSatAnnotationDock(bounds, viewport, size, budgets.edge);

  if (!intersectsViewport(anchor, viewport)) return hiddenSatAnnotationPlacement();
  if (anchor.height / Math.max(1, viewport.height) > budgets.selectionRatio) return dock();
  if (region.right - region.left < budgets.surfaceMin) return dock();
  if (region.bottom - region.top < size.height + budgets.gap) return dock();

  // Room is measured from the safe region's edge, so the comfort buffer is part
  // of the question "does it fit", not a later fixup.
  const requirement = size.height + budgets.gap + budgets.comfort;
  const roomAbove = anchor.top - bounds.top - region.top;
  const roomBelow = region.bottom - (anchor.bottom - bounds.top);

  // Which lane will the native selection menu claim? iOS paints it above the
  // selection and only flips below when it cannot fit there — and it is drawn
  // over everything we render, so on touch that lane is not ours to take: we
  // float in the one it leaves, or we dock. A mouse has no menu, so nothing is
  // reserved and desktop keeps the preference it has always had.
  const nativeLane: SatAnnotationSide | null = input.touch
    ? (roomAbove >= budgets.nativeUiZone ? 'above' : 'below')
    : null;
  const previousSide = input.previous?.mode === 'floating' ? input.previous.side : null;
  const room = (candidate: SatAnnotationSide) => (candidate === 'above' ? roomAbove : roomBelow);
  const fits = (candidate: SatAnnotationSide, extra: number) =>
    candidate !== nativeLane && room(candidate) >= requirement + extra;

  // Keep the side we are already on while it still fits; otherwise take a side
  // that justifies the move. Coming out of the dock costs the same margin as
  // changing sides, so the surface cannot oscillate inside a band where both
  // arrangements are merely adequate — and it is never locked into the dock for
  // the rest of the selection's life either.
  const changeCost = previousSide === null ? (input.previous?.mode === 'docked' ? budgets.switchMargin : 0) : budgets.switchMargin;
  let side: SatAnnotationSide | null = previousSide !== null && fits(previousSide, 0) ? previousSide : null;
  if (!side && fits('above', changeCost)) side = 'above';
  if (!side && fits('below', changeCost)) side = 'below';
  if (!side) return dock();

  // The line the surface sits against is the one its caret should point at: the
  // first selected line above the text, the last one below it.
  const line = side === 'above' ? anchor.firstLine : anchor.lastLine;
  const width = Math.min(size.width, region.right - region.left);
  const anchorCenterX = (line.left + line.right) / 2 - bounds.left;
  const left = clampNumber(anchorCenterX - width / 2, region.left, region.right - width);
  const arrowX = clampNumber(
    anchorCenterX - left,
    Math.min(budgets.caretInset, width / 2),
    Math.max(budgets.caretInset, width - budgets.caretInset),
  );
  const edgeY = (side === 'above' ? anchor.firstLine.top : anchor.lastLine.bottom) - bounds.top;
  const top = clampNumber(
    side === 'above' ? edgeY - size.height - budgets.gap : edgeY + budgets.gap,
    region.top,
    region.bottom - size.height,
  );

  const previous = input.previous;
  const sameSide = previous?.mode === 'floating' && previous.side === side;
  const moved = sameSide
    && (Math.abs(left - previous.left) > budgets.stableDelta || Math.abs(top - previous.top) > budgets.stableDelta);
  return {
    mode: 'floating',
    left,
    top,
    width,
    maxHeight: Math.max(0, region.bottom - top),
    side,
    arrowX,
    // Settle a one-off move; while the surface is already moving — a passage
    // being dragged open, Safari auto-scrolling under a selection handle — keep
    // reapplying it directly, or the transition would make it trail the finger
    // for the whole gesture.
    animated: Boolean(moved) && !previous?.animated,
  };
}
