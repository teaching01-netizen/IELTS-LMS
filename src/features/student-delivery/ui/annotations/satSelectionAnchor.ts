import type { SatTextAnchor } from '../../domain/satResponses';
import { parseSatAnnotationNodeId } from '../../domain/satAnnotationIdentity';

/**
 * Turning an anchor into the DOM it names: the block, the Range, and where that
 * Range sits on screen line by line.
 *
 * This is the MEASURING half of placement, and it is deliberately not in the
 * rule itself (`placeSelectionMenu`): that function decides, from plain numbers,
 * and a pure decision cannot be tested or reasoned about if it can also read the
 * DOM. Every function here returns null rather than guessing, because "cannot
 * measure" is a real answer the caller has an honest response to (a reachable
 * fallback position), and a plausible-looking substitute rect would be worse
 * than none.
 */

/** The rendered text block an anchor points at, or null when it is not mounted. */
export function satAnnotationBlockFor(anchor: SatTextAnchor): HTMLElement | null {
  const parts = parseSatAnnotationNodeId(anchor.nodeId);
  if (!parts || typeof document === 'undefined') return null;
  const block = document.querySelector<HTMLElement>(
    `[data-sat-annotation-region="${CSS.escape(parts.region)}"] [data-content-text-node="${CSS.escape(parts.contentNodeId)}"]`,
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
 * The per-line rects exist for the HORIZONTAL question, which is the one the
 * union box answers badly: a wrapped selection's union spans its widest line, so
 * a caret centred on it can point at empty space beside a short first or last
 * line. Above the selection the caret belongs to the first line, below it to the
 * last. Vertically the union box already IS first-line-top to last-line-bottom,
 * and this makes that explicit for the side decision.
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
 * no Range measurement at all (jsdom). Callers fall back to a reachable spot
 * rather than vanishing, and never invent a position from nothing.
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
