/**
 * Where a contextual menu goes, decided from geometry alone.
 *
 * ONE rule, for every product and every selection. SAT, IELTS, ACT and every
 * future exam differ in what their actions DO, never in where a toolbar sits: a
 * menu that flips sides because the component that rendered it was written by a
 * different team is exactly the inconsistency a student reads as unreliability.
 * So placement is a pure function of the selection's box, the visible region and
 * the menu's measured size, and it touches no DOM — the anchor is measured by the
 * caller (`satSelectionAnchor` for SAT, the gesture engine's rects for a selection
 * the exam owns), the environment by whoever owns the surface, and the timing by
 * whoever owns the scroll listeners. The rule itself needs no browser.
 *
 * This used to be two engines: an SAT-specific one and a second, simpler one for
 * the shared menu. Two rules meant two answers to "which side", and the one the
 * student saw depended on which component had rendered the toolbar. There is now
 * one; SAT's numbers arrive as `budgets` rather than as a separate implementation.
 *
 * The order of the decisions IS the design, and it is the order a student would
 * make them in:
 *
 *   1. the source is gone → nothing to show;
 *   2. on a coarse pointer, the lane the native selection menu will claim is not
 *      a candidate: the browser paints that menu OVER our surface, so sharing it
 *      means being covered by it. We take the lane the menu leaves;
 *   3. keep the side already in use while it still offers real room;
 *   4. otherwise move only to a side that justifies the move;
 *   5. and if no side satisfies the budget, float anyway: "no comfortable room"
 *      is not a reason to take the controls away from the student who just
 *      selected text, and it is not a reason to invent a second presentation
 *      either. The clamp keeps it reachable and `clamped` keeps the caret honest.
 *
 * Where the menu goes is expressed in the coordinate space of its container,
 * which is why only the CONTAINER-RECT (bounds) and the VISIBLE-RECT (visual
 * viewport) are needed — never a scroll offset.
 *
 * The menu is positioned from the LIVE anchor, never from geometry stored at
 * capture time: a stored rect goes stale on scroll, zoom, or a line-spacing
 * change, and a toolbar floating over the wrong sentence is worse than no
 * toolbar. Callers re-measure on scroll/resize instead.
 */

export type SelectionMenuMode = 'floating' | 'hidden';

export type SelectionMenuSide = 'above' | 'below';

export interface SelectionMenuBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One rendered line of the anchored span. */
export interface SelectionMenuLine {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The anchored span, in the browser's viewport coordinate space.
 *
 * The per-line rects exist for the HORIZONTAL question, which is the one the
 * union box answers badly: a wrapped selection's union spans its widest line, so
 * a caret centred on it can point at empty space beside a short first or last
 * line. Above the selection the caret belongs to the first line, below it to the
 * last. Vertically the union box already IS first-line-top to last-line-bottom,
 * and this makes that explicit for the side decision.
 */
export interface SelectionMenuAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
  firstLine: SelectionMenuLine;
  lastLine: SelectionMenuLine;
}

/**
 * The numbers that decide where the floating menu sits.
 *
 * One vocabulary, whatever the product: the engine takes them as input, a
 * product's CSS declares them (SAT's `--sat-annotation-*` tokens), and nobody
 * should have to open a second file to find out which value wins. The defaults
 * matter twice: they are what the engine uses in a renderer with no style
 * resolution (jsdom, a headless pass) and what a malformed or missing token
 * falls back to in a browser.
 */
export interface SelectionMenuBudgets {
  /** Smallest distance the menu keeps from any visible edge. */
  edge: number;
  /**
   * Height the native selection menu needs. On a coarse pointer this answers one
   * question — does the menu fit above the selection? — because iOS puts it there
   * when it does and flips it below when it does not, and it is painted OVER our
   * surface. So this decides WHICH LANE the menu will take, and therefore which
   * lane is left for us, rather than how far from the selection our own lane has
   * to start. Zero under a mouse, where no menu exists and no lane is given up.
   */
  nativeUiZone: number;
  /** Breathing room between the selection and the menu. */
  gap: number;
  /** Extra room demanded on touch, so "comfortable" is not "just fits". */
  comfort: number;
  /** The same idea for a mouse, where just-fits is merely tight. */
  comfortFine: number;
  /** Keeps the caret away from the menu's rounded corners. */
  caretInset: number;
  /** Extra room a side must offer to justify moving to it. */
  switchMargin: number;
  /** A move larger than this settles; anything smaller is applied directly. */
  stableDelta: number;
}

export const SELECTION_MENU_BUDGET_DEFAULTS: SelectionMenuBudgets = {
  edge: 12,
  nativeUiZone: 80,
  gap: 12,
  comfort: 24,
  comfortFine: 12,
  caretInset: 20,
  switchMargin: 24,
  stableDelta: 8,
};

/**
 * Resolve a budget for this input. A coarse pointer is the only difference
 * between the two worlds: it introduces the native selection menu, whose lane is
 * reserved for the browser (see `placeSelectionMenu`), and it asks for a comfort
 * buffer rather than a mouse's tighter one.
 */
export function resolveSelectionMenuBudgets(
  touch: boolean,
  base: Partial<SelectionMenuBudgets> | undefined = {},
): SelectionMenuBudgets {
  const merged: SelectionMenuBudgets = { ...SELECTION_MENU_BUDGET_DEFAULTS, ...base };
  return {
    ...merged,
    nativeUiZone: touch ? merged.nativeUiZone : 0,
    comfort: touch ? merged.comfort : merged.comfortFine,
  };
}

export interface SelectionMenuPlacement {
  /**
   * `floating` sits against the selection; `hidden` keeps the menu mounted (and
   * its focus intact) while its anchor is off screen or the viewport is still
   * moving. There is no third mode: an overlay that changed shape when the room
   * ran out was a second presentation for a student to learn.
   */
  mode: SelectionMenuMode;
  /** Position relative to `bounds` (the menu's positioning container). */
  left: number;
  top: number;
  /** Width the menu must take, so one owner decides its shape. */
  width: number;
  /**
   * Tallest the menu may be without leaving the visible region, measured from its
   * own top. The rows scroll inside this bound when they need more room.
   */
  maxHeight: number;
  side: SelectionMenuSide | null;
  /** Where the caret sits along the menu's top edge, in menu-local px. */
  arrowX: number;
  /** A move big enough to settle, rather than a nudge to apply directly. */
  animated: boolean;
  /**
   * The menu had to be pinned inside the visible region instead of sitting the
   * usual gap away from its line, so it is no longer against the text it belongs
   * to. The caret is drawn from this: a caret that points at a line the toolbar
   * is nowhere near is worse than no caret at all.
   */
  clamped: boolean;
}

export interface SelectionMenuPlacementInput {
  anchor: SelectionMenuAnchor;
  /** Positioning container; `left`/`top`/`width` in the result are relative to it. */
  bounds: SelectionMenuBox;
  /** The region the menu must stay inside — the VISUAL viewport. */
  viewport: SelectionMenuBox;
  /** Measured menu size. */
  size: { width: number; height: number };
  /** What the menu is doing now, for hysteresis. Null for a fresh selection. */
  previous?: SelectionMenuPlacement | null | undefined;
  /** Coarse pointer: the native selection menu exists and claims its own zone. */
  touch?: boolean | undefined;
  budgets?: Partial<SelectionMenuBudgets> | undefined;
}

/** A clamp under this many px is a rounding difference, not a lost line. */
const CLAMP_EPSILON = 0.5;

/** The menu is mounted but out of the way; nothing about it can be acted on. */
export function hiddenSelectionMenu(): SelectionMenuPlacement {
  return { mode: 'hidden', left: 0, top: 0, width: 0, maxHeight: 0, side: null, arrowX: 0, animated: false, clamped: false };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** The part of the menu's container that is both on screen and inset. */
function visibleRegion(
  bounds: SelectionMenuBox,
  viewport: SelectionMenuBox,
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

function intersectsViewport(anchor: SelectionMenuAnchor, viewport: SelectionMenuBox): boolean {
  const overlapsVertically = anchor.bottom > viewport.top && anchor.top < viewport.top + viewport.height;
  const overlapsHorizontally = anchor.right > viewport.left && anchor.left < viewport.left + viewport.width;
  return overlapsVertically && overlapsHorizontally;
}

/**
 * Where the contextual menu goes, from geometry alone. See the module comment for
 * the decision order; every move — side to side — costs `switchMargin` of extra
 * room, so the menu can never oscillate between two arrangements that are both
 * merely adequate.
 */
export function placeSelectionMenu(input: SelectionMenuPlacementInput): SelectionMenuPlacement {
  const budgets = resolveSelectionMenuBudgets(input.touch === true, input.budgets);
  const { anchor, bounds, size, viewport } = input;
  const region = visibleRegion(bounds, viewport, budgets.edge);

  if (!intersectsViewport(anchor, viewport)) return hiddenSelectionMenu();

  // Room is measured from the safe region's edge, so the comfort buffer is part
  // of the question "does it fit", not a later fixup.
  const requirement = size.height + budgets.gap + budgets.comfort;
  const roomAbove = anchor.top - bounds.top - region.top;
  const roomBelow = region.bottom - (anchor.bottom - bounds.top);

  // Which lane will the native selection menu claim? iOS paints it above the
  // selection and only flips below when it cannot fit there — and it is drawn
  // over everything we render, so on touch that lane is not ours to take. A
  // mouse has no menu, so nothing is reserved.
  const nativeLane: SelectionMenuSide | null = input.touch === true
    ? (roomAbove >= budgets.nativeUiZone ? 'above' : 'below')
    : null;
  const previousSide = input.previous?.mode === 'floating' ? input.previous.side : null;
  const room = (candidate: SelectionMenuSide) => (candidate === 'above' ? roomAbove : roomBelow);
  const fits = (candidate: SelectionMenuSide, extra: number) =>
    candidate !== nativeLane && room(candidate) >= requirement + extra;

  const changeCost = previousSide === null ? 0 : budgets.switchMargin;
  let side: SelectionMenuSide | null = previousSide !== null && fits(previousSide, 0) ? previousSide : null;
  if (!side && fits('above', changeCost)) side = 'above';
  if (!side && fits('below', changeCost)) side = 'below';

  /**
   * Nothing fits comfortably. Room is a preference here, not a permission: the
   * menu floats either way, and this only decides what it floats AGAINST.
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
    const free: SelectionMenuSide = nativeLane === 'above' ? 'below' : 'above';
    const keepsRoom = (candidate: SelectionMenuSide) => room(candidate) >= size.height + budgets.gap;
    const clearOfTheMenu = budgets.nativeUiZone + budgets.gap;
    if (previousSide !== null && keepsRoom(previousSide)) side = previousSide;
    else if (nativeLane === null) side = roomBelow >= roomAbove ? 'below' : 'above';
    else if (keepsRoom(free)) side = free;
    else if (room(nativeLane) >= size.height + clearOfTheMenu) {
      side = nativeLane;
      offset = clearOfTheMenu;
    } else side = free;
  }

  // The line the menu sits against is the one its caret should point at: the
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
    // Settle a one-off move; while the menu is already moving — a passage being
    // dragged open, Safari auto-scrolling under a selection handle — keep
    // reapplying it directly, or the transition would make it trail the finger
    // for the whole gesture.
    animated: Boolean(moved) && !previous?.animated,
    clamped: Math.abs(top - preferredTop) > CLAMP_EPSILON,
  };
}

