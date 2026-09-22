/**
 * Two positions, turned into the one range the exam owns.
 *
 * The `Range` built here is deliberately NEVER installed into
 * `window.getSelection()`. That is not an implementation detail: the whole
 * reason the engine exists is that the platform must never learn a selection
 * exists, because that is what stops iOS and Android raising their Copy / Look
 * Up / Share bar over the passage. The range is enough for everything the exam
 * needs — annotation anchors are computed from character offsets, the toolbars
 * measure themselves from a stored anchor — and it is kept private to the engine
 * so no component can leak it into a browser selection by accident.
 */

import { clampTextPointTo, compareTextPoints } from './selectionPoint';
import type { TextPoint } from '../domain/selectionTypes';

/**
 * A forward range between two positions, or null when the gesture selected
 * nothing.
 *
 * The two positions arrive in gesture order, not reading order — a drag runs
 * right-to-left just as often — so they are ordered here and the caller never
 * has to know which end the finger started from.
 */
export function createSelectionRange(a: TextPoint, b: TextPoint): Range | null {
  const [from, to] = compareTextPoints(a, b) <= 0 ? [a, b] : [b, a];
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
export function createSelectionRangeWithin(
  boundary: Element,
  a: TextPoint,
  b: TextPoint,
): Range | null {
  const clampedA = clampTextPointTo(a, boundary);
  const clampedB = clampTextPointTo(b, boundary);
  if (!clampedA || !clampedB) return null;
  return createSelectionRange(clampedA, clampedB);
}

/**
 * The word under a position, as a range — what a long press with no drag means.
 *
 * A press that reaches no word resolves to nothing rather than to a nearby
 * guess: selecting the wrong word and selecting none are different mistakes, and
 * only one of them can be seen by the student.
 */
export function createWordRangeAt(
  point: TextPoint,
  word: { start: number; end: number } | null,
): Range | null {
  if (!word) return null;
  return createSelectionRange(
    { node: point.node, offset: word.start },
    { node: point.node, offset: word.end },
  );
}
