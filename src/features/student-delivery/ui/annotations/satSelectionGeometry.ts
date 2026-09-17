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
 * every rule the student feels — "sit against the selection", "choose a side
 * once and stay there", "stay inside what you can see, even if that means
 * leaving the line" — is testable without a browser, and the React component
 * never has to know what a visual viewport is.
 *
 * There is exactly ONE presentation, and it is not a setting: `floating` is a
 * toolbar with a caret pointing at the line it belongs to. A second
 * presentation used to exist — a full-bleed sheet docked to the bottom of the
 * visible region — and it is gone on purpose. Two presentations meant two sets
 * of chrome, two entrance animations, and a surface that changed shape under the
 * student for reasons that had nothing to do with what they had just asked for.
 * What the dock used to answer (a selection that covers the screen, a viewport
 * too short for the controls) is answered by the same toolbar, clamped inside
 * the visible region: `clamped` says when that clamp moved it away from its
 * line, so the caret can be dropped rather than lie about where the surface is,
 * and the surface's own body scrolls inside the placement's `maxHeight`.
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

export type SatAnnotationMode = 'floating' | 'hidden';

export type SatAnnotationSide = 'above' | 'below';

export interface AnnotationPlacement {
  /**
   * `floating` sits against the selection; `hidden` keeps the surface mounted
   * (and its focus intact) while its anchor is off screen or the viewport is
   * still moving. There is no third mode: an overlay that changed shape when the
   * room ran out was a second presentation for a student to learn.
   */
  mode: SatAnnotationMode;
  /** Position relative to `bounds` (the surface's positioning container). */
  left: number;
  top: number;
  /** Width the surface must take, so one owner decides its shape. */
  width: number;
  /**
   * Tallest the surface may be without leaving the visible region, measured from
   * its own top. The rows scroll inside this bound when they need more room.
   */
  maxHeight: number;
  side: SatAnnotationSide | null;
  /** Where the caret sits along the surface's top edge, in surface-local px. */
  arrowX: number;
  /** A move big enough to settle, rather than a nudge to apply directly. */
  animated: boolean;
  /**
   * The surface had to be pinned inside the visible region instead of sitting
   * the usual gap away from its line, so it is no longer against the text it
   * belongs to. The caret is drawn from this: a caret that points at a line the
   * panel is nowhere near is worse than no caret at all.
   */
  clamped: boolean;
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

/** A clamp under this many px is a rounding difference, not a lost line. */
const CLAMP_EPSILON = 0.5;

/** The surface is mounted but out of the way; nothing about it can be acted on. */
export function hiddenSatAnnotationPlacement(): AnnotationPlacement {
  return { mode: 'hidden', left: 0, top: 0, width: 0, maxHeight: 0, side: null, arrowX: 0, animated: false, clamped: false };
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
 * Where the contextual surface goes, from geometry alone.
 *
 * The order of the decisions IS the design, and it is the order a student would
 * make them in:
 *
 * 1. the source is gone → nothing to show;
 * 2. on a coarse pointer, the lane the native selection menu will claim is not
 *    a candidate: the browser paints that menu OVER our surface, so sharing it
 *    means being covered by it. We take the lane the menu leaves;
 * 3. keep the side already in use while it still offers real room;
 * 4. otherwise move only to a side that justifies the move;
 * 5. and if no side satisfies the budget, float anyway (see `fallbackSide`):
 *    "no comfortable room" is not a reason to take the controls away from the
 *    student who just selected text, and it is not a reason to invent a second
 *    presentation either. The clamp keeps it reachable and `clamped` keeps the
 *    caret honest.
 *
 * Every move — side to side — costs `switchMargin` of extra room, so the surface
 * can never oscillate between two arrangements that are both merely adequate.
 */
export function placeSatAnnotationSurface(input: SatAnnotationPlacementInput): AnnotationPlacement {
  const budgets = resolveSatAnnotationBudgets(input.touch, input.budgets);
  const { anchor, bounds, size, viewport } = input;
  const region = visibleRegion(bounds, viewport, budgets.edge);

  if (!intersectsViewport(anchor, viewport)) return hiddenSatAnnotationPlacement();

  // Room is measured from the safe region's edge, so the comfort buffer is part
  // of the question "does it fit", not a later fixup.
  const requirement = size.height + budgets.gap + budgets.comfort;
  const roomAbove = anchor.top - bounds.top - region.top;
  const roomBelow = region.bottom - (anchor.bottom - bounds.top);

  // Which lane will the native selection menu claim? iOS paints it above the
  // selection and only flips below when it cannot fit there — and it is drawn
  // over everything we render, so on touch that lane is not ours to take. A
  // mouse has no menu, so nothing is reserved.
  const nativeLane: SatAnnotationSide | null = input.touch
    ? (roomAbove >= budgets.nativeUiZone ? 'above' : 'below')
    : null;
  const previousSide = input.previous?.mode === 'floating' ? input.previous.side : null;
  const room = (candidate: SatAnnotationSide) => (candidate === 'above' ? roomAbove : roomBelow);
  const fits = (candidate: SatAnnotationSide, extra: number) =>
    candidate !== nativeLane && room(candidate) >= requirement + extra;

  const changeCost = previousSide === null ? 0 : budgets.switchMargin;
  let side: SatAnnotationSide | null = previousSide !== null && fits(previousSide, 0) ? previousSide : null;
  if (!side && fits('above', changeCost)) side = 'above';
  if (!side && fits('below', changeCost)) side = 'below';

  /**
   * Nothing fits comfortably. Room is a preference here, not a permission: the
   * surface floats either way, and this only decides what it floats AGAINST.
   *
   * 1. the side it is already on, if that side can hold it at all — a toolbar
   *    that kept its place through a tight measurement is worth more than a
   *    slightly roomier position that moves on every scroll tick;
   * 2. the lane nobody else is using (on touch, the one the native menu leaves);
   * 3. the lane the native menu will claim, but beyond the menu's own zone:
   *    sitting past the menu is usable, sitting under it is not. With a mouse no
   *    lane is reserved, so this step and the next one are touch-only;
   * 4. otherwise the lane that is ours, at the usual distance, which the clamp
   *    below then pins inside the visible region (`clamped` true).
   */
  let offset = budgets.gap;
  if (!side) {
    const free: SatAnnotationSide = nativeLane === 'above' ? 'below' : 'above';
    const keepsRoom = (candidate: SatAnnotationSide) => room(candidate) >= size.height + budgets.gap;
    const clearOfTheMenu = budgets.nativeUiZone + budgets.gap;
    if (previousSide !== null && keepsRoom(previousSide)) side = previousSide;
    else if (nativeLane === null) side = roomBelow >= roomAbove ? 'below' : 'above';
    else if (keepsRoom(free)) side = free;
    else if (room(nativeLane) >= size.height + clearOfTheMenu) {
      side = nativeLane;
      offset = clearOfTheMenu;
    } else side = free;
  }

  // The line the surface sits against is the one its caret should point at: the
  // first selected line above the text, the last one below it.
  const line = side === 'above' ? anchor.firstLine : anchor.lastLine;
  const width = Math.min(size.width, Math.max(0, region.right - region.left));
  const anchorCenterX = (line.left + line.right) / 2 - bounds.left;
  const left = clampNumber(anchorCenterX - width / 2, region.left, region.right - width);
  const arrowX = clampNumber(
    anchorCenterX - left,
    Math.min(budgets.caretInset, width / 2),
    Math.max(budgets.caretInset, width - budgets.caretInset),
  );
  const edgeY = (side === 'above' ? anchor.firstLine.top : anchor.lastLine.bottom) - bounds.top;
  const preferredTop = side === 'above' ? edgeY - size.height - offset : edgeY + offset;
  const top = clampNumber(preferredTop, region.top, region.bottom - size.height);

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
    clamped: Math.abs(top - preferredTop) > CLAMP_EPSILON,
  };
}
