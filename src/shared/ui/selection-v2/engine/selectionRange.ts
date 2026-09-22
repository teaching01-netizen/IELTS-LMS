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
import type { NodeWordSegment, WordDragSide } from '../domain/selectionSegmenter';
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
 * A position kept inside the span it describes.
 *
 * The caret the lens magnifies and the range the student sees are two views of
 * one selection, so a caret pointing at a character the highlight does not cover
 * would describe a range that does not exist. A position past either end is
 * pulled to that end.
 *
 * A span that runs ACROSS nodes — a word run into the next paragraph, or through
 * an inline element — is clamped by the end the position is in: a point in the
 * start container only cannot precede the span's start, and one in the end
 * container only cannot follow its end. Every node between them is inside the
 * span by construction. A position in a node the span does not touch is left
 * alone: there is no span between them to be inside of — that case already went
 * through `createSelectionRange`'s ordering and the boundary clamp.
 */
export function clampPointToRange(point: TextPoint, range: Range): TextPoint {
  const inStart = point.node === range.startContainer;
  const inEnd = point.node === range.endContainer;
  if (!inStart && !inEnd) return point;
  if (inStart && inEnd) {
    const offset = Math.max(range.startOffset, Math.min(range.endOffset, point.offset));
    return offset === point.offset ? point : { node: point.node, offset };
  }
  const offset = inStart
    ? Math.max(range.startOffset, point.offset)
    : Math.min(range.endOffset, point.offset);
  return offset === point.offset ? point : { node: point.node, offset };
}

/**
 * The run a body-touch drag means once the finger has LEFT the claimed node.
 *
 * An inline element splitting a word and the next paragraph are the same
 * gesture to a student, so the rule is the one `resolveWordDragSpan` states, read
 * through document order instead of offsets: the claim's far side is fixed and
 * the word the finger reached supplies the moving edge — its start when the
 * finger's node precedes the claim, its end when it follows. Both edges stay on
 * word boundaries, which is the whole point: a body gesture may not produce a
 * partial word, and the earlier fall-through to raw offsets did exactly that the
 * moment a drag crossed a node boundary (`eta ga` out of `beta` + `gamma`).
 *
 * `target` is null where the node the finger reached holds no word at all (a
 * whitespace-only inline node, an empty one). The claim then stands, for the same
 * reason `resolveWordDragSpan` leaves it standing: "no word there" is not a
 * reason to resize what the student can see — and it is certainly not a reason to
 * fall back to the characters under the finger. A node that is not in the same
 * document as the claim cannot describe a span to it either, so that stands too.
 */
export function resolveWordRunAcrossNodes(
  origin: NodeWordSegment,
  target: NodeWordSegment | null,
): { fixed: TextPoint; moving: TextPoint; side: WordDragSide } {
  const claimStart = { node: origin.node, offset: origin.start };
  const claimEnd = { node: origin.node, offset: origin.end };
  if (!target) return { fixed: claimStart, moving: claimEnd, side: 'unchanged' };
  const order = compareTextPoints({ node: target.node, offset: target.start }, claimStart);
  if (order === 0) return { fixed: claimStart, moving: claimEnd, side: 'unchanged' };
  return order < 0
    ? { fixed: claimEnd, moving: { node: target.node, offset: target.start }, side: 'before' }
    : { fixed: claimStart, moving: { node: target.node, offset: target.end }, side: 'after' };
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
