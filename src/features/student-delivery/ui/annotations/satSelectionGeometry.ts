import type { SatTextAnchor } from '../../domain/satResponses';

/**
 * Selection geometry + placement for the contextual annotation surface.
 *
 * Two jobs live here, deliberately in this order:
 *
 * 1. MEASURE the anchored span — which rendered block it points at, the DOM
 *    Range covering it, and where that range sits on screen line by line;
 * 2. DECIDE where the surface goes, as one pure function of that geometry and
 *    a budget. `placeSatAnnotationSurface` touches no DOM, so every rule the
 *    student feels — "float only if there is comfortably enough room", "choose
 *    a side once and stay there", "dock when the selection is the whole
 *    screen" — is testable without a browser, and the React component never
 *    has to know what a visual viewport is.
 *
 * The toolbar is positioned from the LIVE anchor, never from geometry stored
 * at capture time: a stored rect goes stale on scroll, zoom, or a line-spacing
 * change, and a toolbar floating over the wrong sentence is worse than no
 * toolbar. Callers re-measure on scroll/resize instead.
 */

function regionAndNode(anchor: SatTextAnchor): { region: string; nodeId: string } | null {
  const separator = anchor.nodeId.indexOf(':');
  if (separator <= 0 || separator === anchor.nodeId.length - 1) return null;
  return { region: anchor.nodeId.slice(0, separator), nodeId: anchor.nodeId.slice(separator + 1) };
}

/** The rendered text block an anchor points at, or null when it is not mounted. */
export function satAnnotationBlockFor(anchor: SatTextAnchor): HTMLElement | null {
  const parts = regionAndNode(anchor);
  if (!parts || typeof document === 'undefined') return null;
  const block = document.querySelector<HTMLElement>(
    `[data-sat-annotation-region="${CSS.escape(parts.region)}"] [data-content-text-node="${CSS.escape(parts.nodeId)}"]`,
  );
  // Verify rather than trust: a recovered anchor can outlive the node it named.
  if (!block || !(block.textContent ?? '').slice(anchor.startOffset, anchor.endOffset).length) return null;
  return block;
}

/** A DOM Range covering exactly the anchored span, or null when unresolvable. */
export function satAnnotationRangeFor(anchor: SatTextAnchor): Range | null {
  const block = satAnnotationBlockFor(anchor);
  if (!block) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let startNode: Text | null = null;
  let startInNode = 0;
  let endNode: Text | null = null;
  let endInNode = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.data.length;
    if (startNode === null && consumed + length > anchor.startOffset) {
      startNode = node;
      startInNode = anchor.startOffset - consumed;
    }
    if (startNode !== null && endNode === null && consumed + length >= anchor.endOffset) {
      endNode = node;
      endInNode = anchor.endOffset - consumed;
      break;
    }
    consumed += length;
    node = walker.nextNode() as Text | null;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, Math.max(0, startInNode));
  range.setEnd(endNode, Math.max(0, endInNode));
  if (range.collapsed) return null;
  return range;
}

/** The slice of DOMRect geometry the placement math needs. */
export interface SatRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One rendered line of an anchored span. */
export interface SatAnchorLine {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Where an anchored span actually sits, in the browser's viewport coordinate
 * space (what `getBoundingClientRect` returns).
 *
 * The per-line rects exist because a wrapped selection has no single "nearby":
 * a surface above it belongs to its FIRST line and a surface below it belongs
 * to its LAST, which is where the student's eye and the caret should meet. The
 * union box alone would centre both on a ragged paragraph's widest line.
 */
export interface SatAnchorGeometry extends SatRectLike {
  right: number;
  bottom: number;
  firstLine: SatAnchorLine;
  lastLine: SatAnchorLine;
}

/**
 * Two client rects whose tops differ by less than this belong to the same
 * rendered line — an inline mark or a bidi run splitting one line into several
 * fragments. A wrapped line is always at least one line-height away.
 */
const SAT_LINE_TOLERANCE_PX = 1;

/** Merge the rects of a range into one entry per rendered line. */
export function satAnnotationLineRects(range: Range): SatAnchorLine[] {
  if (typeof range.getClientRects !== 'function') return [];
  const rects = range.getClientRects();
  const lines: SatAnchorLine[] = [];
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    const previous = lines[lines.length - 1];
    if (previous && Math.abs(rect.top - previous.top) < SAT_LINE_TOLERANCE_PX) {
      previous.top = Math.min(previous.top, rect.top);
      previous.bottom = Math.max(previous.bottom, rect.bottom);
      previous.left = Math.min(previous.left, rect.left);
      previous.right = Math.max(previous.right, rect.right);
      continue;
    }
    lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
  }
  return lines;
}

/**
 * Viewport geometry of an anchored span, or null when it cannot be measured —
 * an unmounted node, a scrolled-away mark, a zero-sized box, or a renderer with
 * no Range measurement at all (jsdom). Callers hide the surface rather than
 * guessing a position, and fall back to a reachable spot so the controls are
 * never unreachable because geometry failed.
 */
export function satAnnotationAnchorGeometryFor(anchor: SatTextAnchor): SatAnchorGeometry | null {
  if (typeof window === 'undefined') return null;
  const range = satAnnotationRangeFor(anchor);
  if (!range) return null;
  // Some DOM implementations (jsdom, older engines) omit range measurement.
  if (typeof range.getBoundingClientRect !== 'function') return null;
  const box = range.getBoundingClientRect();
  if (!Number.isFinite(box.width) || box.width === 0) return null;
  if (!Number.isFinite(box.height) || box.height === 0) return null;
  const lines = satAnnotationLineRects(range);
  const firstLine = lines[0] ?? { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
  const lastLine = lines[lines.length - 1] ?? firstLine;
  return {
    left: box.left,
    right: box.right,
    top: box.top,
    bottom: box.bottom,
    width: box.width,
    height: box.height,
    firstLine,
    lastLine,
  };
}

/** The measured box of an anchored span, as a DOMRect-shaped plain object. */
export function satAnnotationRectFor(anchor: SatTextAnchor): DOMRect | null {
  const geometry = satAnnotationAnchorGeometryFor(anchor);
  if (!geometry) return null;
  return {
    x: geometry.left,
    y: geometry.top,
    left: geometry.left,
    top: geometry.top,
    right: geometry.right,
    bottom: geometry.bottom,
    width: geometry.width,
    height: geometry.height,
    toJSON: () => ({}),
  } as DOMRect;
}

/* ------------------------------------------------------------------ *
 * Placement budgets
 * ------------------------------------------------------------------ */

/**
 * The numbers that decide float vs dock. Defaults and the CSS tokens in
 * `src/index.css` carry the same values; the runtime prefers the tokens so a
 * theme can retune the surface without touching placement logic.
 */
export interface SatAnnotationBudgets {
  /** Smallest distance the surface keeps from any visible edge. */
  edge: number;
  /**
   * Room the native selection menu owns around the selection. Reserved on
   * touch only: a mouse has no menu hovering over the words, and pretending it
   * does would dock every desktop selection.
   */
  nativeUiZone: number;
  /** Breathing room between the selection and the surface. */
  gap: number;
  /** Extra room demanded on touch, so "comfortable" is not "just fits". */
  comfort: number;
  /** The same idea for a mouse, where just-fits is merely tight. */
  comfortFine: number;
  /**
   * Narrower than this and the controls would have to shrink or cram onto
   * several rows; the dock is the honest answer instead.
   */
  surfaceMin: number;
  /** A selection taller than this fraction of the viewport has no "nearby". */
  selectionRatio: number;
  /** Keeps the caret away from the surface's rounded corners. */
  caretInset: number;
  /** Extra room the opposite side must offer to justify switching sides. */
  switchMargin: number;
  /** A move larger than this settles; anything smaller is applied directly. */
  stableDelta: number;
}

export const SAT_ANNOTATION_BUDGET_DEFAULTS: SatAnnotationBudgets = {
  edge: 12,
  nativeUiZone: 80,
  gap: 12,
  comfort: 24,
  comfortFine: 12,
  surfaceMin: 280,
  selectionRatio: 0.3,
  caretInset: 20,
  switchMargin: 24,
  stableDelta: 8,
};

/**
 * Resolve a budget for this input. A coarse pointer is the only difference
 * between the two worlds: it reserves the native menu's zone and asks for a
 * comfort buffer, which is exactly when docking becomes the kinder answer.
 */
export function resolveSatAnnotationBudgets(
  touch: boolean,
  overrides: Partial<SatAnnotationBudgets> | undefined = {},
): SatAnnotationBudgets {
  const merged: SatAnnotationBudgets = { ...SAT_ANNOTATION_BUDGET_DEFAULTS, ...overrides };
  return {
    ...merged,
    nativeUiZone: touch ? merged.nativeUiZone : 0,
    comfort: touch ? merged.comfort : merged.comfortFine,
  };
}

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

export type SatAnnotationMode = 'floating' | 'docked' | 'hidden';

export type SatAnnotationSide = 'above' | 'below';

export interface AnnotationPlacement {
  /**
   * `floating` sits against the selection, `docked` is the full-bleed bottom
   * sheet the geometry asked for, and `hidden` keeps the surface mounted (and
   * its focus intact) while its anchor is off screen or the viewport is moving.
   */
  mode: SatAnnotationMode;
  /** Position relative to `bounds` (the surface's positioning container). */
  left: number;
  top: number;
  side: SatAnnotationSide | null;
  /** Where the caret sits along the surface's top edge, in surface-local px. */
  arrowX: number;
  /** True when the surface sits below the selection. */
  flipped: boolean;
  /** A move big enough to settle, rather than a nudge to apply directly. */
  animated: boolean;
}

export interface SatAnnotationPlacementInput {
  anchor: SatAnchorGeometry;
  /** Positioning container; `left`/`top` in the result are relative to it. */
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
  return { mode: 'hidden', left: 0, top: 0, side: null, arrowX: 0, flipped: false, animated: false };
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
 * 2. the selection IS the screen → there is no "nearby", so dock;
 * 3. the controls would not fit at a usable size → dock;
 * 4. already docked for this selection → stay docked (a surface that flips
 *    between a sheet and a toolbar while scrolling is worse than either);
 * 5. side, kept from the previous placement unless it genuinely stopped
 *    fitting, and switched only for the side that offers real room;
 * 6. otherwise the dock, which is a presentation mode and not a failure.
 */
export function placeSatAnnotationSurface(input: SatAnnotationPlacementInput): AnnotationPlacement {
  const budgets = resolveSatAnnotationBudgets(input.touch, input.budgets);
  const { anchor, bounds, size, viewport } = input;

  const dock = (): AnnotationPlacement => ({
    mode: 'docked',
    left: budgets.edge,
    top: Math.max(budgets.edge, bounds.height - size.height - budgets.edge),
    side: null,
    arrowX: 0,
    flipped: false,
    animated: false,
  });

  if (!intersectsViewport(anchor, viewport)) return hiddenSatAnnotationPlacement();
  if (anchor.height / Math.max(1, viewport.height) > budgets.selectionRatio) return dock();

  const region = visibleRegion(bounds, viewport, budgets.edge);
  if (region.right - region.left < budgets.surfaceMin) return dock();
  if (region.bottom - region.top < size.height + budgets.gap) return dock();
  if (input.previous?.mode === 'docked') return dock();

  // Room is measured from the safe region's edges, so the native menu's zone and
  // the comfort buffer are part of the question "does it fit", not a later fixup.
  const requirement = size.height + budgets.gap + budgets.nativeUiZone + budgets.comfort;
  const anchorTop = anchor.top - bounds.top;
  const anchorBottom = anchor.bottom - bounds.top;
  const roomAbove = anchorTop - region.top;
  const roomBelow = region.bottom - anchorBottom;
  const previousSide = input.previous?.mode === 'floating' ? input.previous.side : null;

  let side: SatAnnotationSide | null = null;
  if (previousSide === 'above' && roomAbove >= requirement) side = 'above';
  else if (previousSide === 'below' && roomBelow >= requirement) side = 'below';
  else if (previousSide === 'above') side = roomBelow >= requirement + budgets.switchMargin ? 'below' : null;
  else if (previousSide === 'below') side = roomAbove >= requirement + budgets.switchMargin ? 'above' : null;
  else if (roomAbove >= requirement) side = 'above';
  else if (roomBelow >= requirement) side = 'below';
  if (!side) return dock();

  // The line the surface sits against is the one it should point at: the first
  // selected line above the text, the last one below it.
  const line = side === 'above' ? anchor.firstLine : anchor.lastLine;
  const anchorCenterX = (line.left + line.right) / 2 - bounds.left;
  const width = Math.min(size.width, region.right - region.left);
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
    side,
    arrowX,
    flipped: side === 'below',
    // Settle a one-off move; while the surface is already moving — a passage
    // being dragged open, Safari auto-scrolling under a selection handle — keep
    // reapplying it directly, or the transition would make it trail the finger
    // for the whole gesture.
    animated: Boolean(moved) && !previous?.animated,
  };
}

/**
 * Mobile dock: a sheet pinned to the bottom of the exam body, so the selected
 * sentence never moves (the dock overlays instead of consuming layout). Returns
 * a placement in the same `bounds` coordinate space.
 */
export function placeSatAnnotationDock(
  bounds: SatRectLike,
  size: { width: number; height: number },
  inset: number = SAT_ANNOTATION_BUDGET_DEFAULTS.edge,
): AnnotationPlacement {
  return {
    mode: 'docked',
    left: inset,
    top: Math.max(inset, bounds.height - size.height - inset),
    side: null,
    arrowX: 0,
    flipped: false,
    animated: false,
  };
}
