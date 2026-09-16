import type { SatTextAnchor } from '../../domain/satResponses';

/**
 * Selection geometry for the contextual annotation toolbar.
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

/**
 * Viewport rect of an anchored span. Returns null for anchors that are
 * currently unmounted, scrolled out of view, or zero-sized — callers hide the
 * toolbar in that case instead of guessing a position.
 */
export function satAnnotationRectFor(anchor: SatTextAnchor): DOMRect | null {
  if (typeof window === 'undefined') return null;
  const range = satAnnotationRangeFor(anchor);
  if (!range) return null;
  // Some DOM implementations (jsdom, older engines) omit range measurement.
  // Callers fall back to a safe placement instead of failing to render tools.
  if (typeof range.getBoundingClientRect !== 'function') return null;
  const rect = range.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || rect.width === 0) return null;
  return rect;
}

/** The slice of DOMRect geometry the placement math needs. */
export interface SatRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AnnotationPlacement {
  /** Position relative to `bounds` (the toolbar's positioning container). */
  left: number;
  top: number;
  /** True when the toolbar sits below the mark because there was no room above. */
  flipped: boolean;
}

/**
 * Place a floating toolbar next to an anchored span without ever leaving the
 * exam body: prefer above the mark's first line (the way a system selection
 * menu behaves), flip below when there is no room, and clamp horizontally.
 */
export function placeSatAnnotationToolbar(
  anchor: SatTextAnchor,
  bounds: SatRectLike,
  size: { width: number; height: number },
  inset: number = 8,
): AnnotationPlacement | null {
  const rect = satAnnotationRectFor(anchor);
  if (!rect) return null;
  const gap = 10;
  const aboveTop = rect.top - bounds.top - size.height - gap;
  const belowTop = rect.bottom - bounds.top + gap;
  const roomAbove = aboveTop >= inset;
  const top = roomAbove ? aboveTop : belowTop;
  const centered = rect.left - bounds.left + rect.width / 2 - size.width / 2;
  const maxLeft = Math.max(inset, bounds.width - size.width - inset);
  return {
    left: Math.min(Math.max(centered, inset), maxLeft),
    top: Math.min(Math.max(top, inset), Math.max(inset, bounds.height - size.height - inset)),
    flipped: !roomAbove,
  };
}

/**
 * Mobile dock: a full-width sheet pinned to the bottom of the exam body, so
 * the selected sentence never moves (the dock overlays instead of consuming
 * layout). Returns a placement in the same `bounds` coordinate space.
 */
export function placeSatAnnotationDock(
  bounds: SatRectLike,
  size: { width: number; height: number },
  inset: number = 8,
): AnnotationPlacement {
  return {
    left: inset,
    top: Math.max(inset, bounds.height - size.height - inset),
    flipped: false,
  };
}
