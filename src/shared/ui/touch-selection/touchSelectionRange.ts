/**
 * Turning two positions into a range, and a range into paint.
 *
 * This is the second half of app-owned touch selection (see
 * `touchSelectionPoint`). The range built here is deliberately NEVER installed
 * into `window.getSelection()`: the point of the whole exercise is that the
 * platform never learns a selection exists, because that is the only thing that
 * stops iOS and Android from raising their own edit menu over the passage. A
 * `Range` is enough for everything the exam needs — the annotation anchors are
 * computed from character offsets, and the toolbar measures itself from a stored
 * anchor.
 */

import { clampTextPointTo, compareTextPoints, type TextPoint } from './touchSelectionPoint';

/** One painted line of a selection, in viewport coordinates. */
export interface TouchSelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Two client rects whose tops differ by less than this belong to one rendered line. */
const LINE_TOLERANCE = 1;

/**
 * A forward range between two positions, or null when the gesture selected
 * nothing.
 *
 * The two positions arrive in gesture order, not reading order — a drag runs
 * right-to-left just as often — so they are ordered here and the caller never
 * has to know which end the finger started from.
 */
export function createTouchSelectionRange(start: TextPoint, end: TextPoint): Range | null {
  const [from, to] = compareTextPoints(start, end) <= 0 ? [start, end] : [end, start];
  if (from.node === to.node && from.offset === to.offset) return null;

  const doc = from.node.ownerDocument;
  if (!doc) return null;

  const range = doc.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    // Positions that cannot be bridged in one range (disconnected trees, an
    // offset past the node's length) are not a selection we can describe.
    return null;
  }
  return range.collapsed ? null : range;
}

/**
 * The same, but confined to one boundary element.
 *
 * Both ends are clamped, so a drag that leaves the paragraph still selects the
 * paragraph's text up to the edge the finger crossed. Null when the boundary
 * holds no text — there is nothing to confine a selection to.
 */
export function createTouchSelectionRangeWithin(
  boundary: Element,
  start: TextPoint,
  end: TextPoint,
): Range | null {
  const clampedStart = clampTextPointTo(start, boundary);
  const clampedEnd = clampTextPointTo(end, boundary);
  if (!clampedStart || !clampedEnd) return null;
  return createTouchSelectionRange(clampedStart, clampedEnd);
}

/**
 * The line-by-line paint of a range, or an empty list when it cannot be
 * measured.
 *
 * Fragments that share a rendered line are merged: a selection crossing an
 * inline mark or a bidi run comes back as several client rects for one line, and
 * painting them separately double-darkens the overlap. A renderer with no range
 * measurement at all (jsdom) reports nothing rather than throwing, which is what
 * keeps the gesture testable without a layout engine.
 */
export function touchSelectionRects(range: Range | null): TouchSelectionRect[] {
  if (!range || typeof range.getClientRects !== 'function') return [];
  const clientRects = range.getClientRects();
  const lines: TouchSelectionRect[] = [];

  for (let index = 0; index < clientRects.length; index += 1) {
    const rect = clientRects[index];
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    const previous = lines[lines.length - 1];
    if (previous && Math.abs(rect.top - previous.top) < LINE_TOLERANCE) {
      // Edges are derived from left/width rather than read off `rect.right`, so
      // the merge depends only on the fields this module declares and stays
      // correct against a narrowed rect.
      const right = Math.max(previous.left + previous.width, rect.left + rect.width);
      const bottom = Math.max(previous.top + previous.height, rect.top + rect.height);
      previous.left = Math.min(previous.left, rect.left);
      previous.top = Math.min(previous.top, rect.top);
      previous.width = right - previous.left;
      previous.height = bottom - previous.top;
      continue;
    }
    lines.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }

  return lines;
}
