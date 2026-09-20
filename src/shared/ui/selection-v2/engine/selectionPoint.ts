/**
 * Where a finger is, expressed as a position in text — measured, never guessed.
 *
 * An exam on a touch device cannot use the platform's own text selection: the
 * moment a selection exists, iOS and Android paint their own Copy / Look Up /
 * Search / Share bar over the passage, and no amount of `contextmenu`
 * suppression or `-webkit-touch-callout` removes it. So touch selection is built
 * on positions the engine resolves itself, and this module is that half — a
 * pointer coordinate turned into a text node and an offset, plus the ordering
 * and containment facts every other part of the engine needs.
 *
 * Everything here is pure and total: a position that cannot be resolved returns
 * null rather than a plausible substitute, because a wrong offset silently
 * anchors a highlight over the wrong words — and on a locked exam surface there
 * is no second, platform-drawn answer for the student to compare it against.
 */

import {
  describeTouchSelectionNode,
  type TouchSelectionDiagnosticRecord,
  type TouchSelectionDiagnostics,
} from '../../touch-selection/touchSelectionDiagnostics';
import type { TextPoint } from '../domain/selectionTypes';

export type { TextPoint } from '../domain/selectionTypes';

/**
 * The default coordinate resolver, spelled out so a host component can pass it
 * without knowing which of the two platform hit tests its browser ships.
 *
 * The root is required rather than optional: an unbounded caret query is how a
 * Safari answer from a toolbar's text becomes the anchor of the student's
 * highlight.
 */
export function browserCaretResolver(
  doc: Document = document,
  diagnostics?: TouchSelectionDiagnostics,
): (x: number, y: number, root: HTMLElement) => TextPoint | null {
  return (x, y, root) => {
    try {
      return caretPositionAtPoint(doc, x, y, diagnostics?.record, root);
    } catch (error) {
      diagnostics?.record('caret-error', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
}

/**
 * Document order for two text positions: negative when `a` precedes `b`,
 * positive when it follows, zero when they are the same position or live in
 * different trees.
 *
 * `Node.compareDocumentPosition` rather than `Range.comparePoint`: the offset
 * within one node is the whole answer when the nodes match, and for two nodes
 * the bitmask says which comes first without materializing a Range.
 *
 * The DISCONNECTED flag is checked FIRST, and that ordering is the whole point.
 * A spec-compliant answer for two separate trees carries DISCONNECTED *plus* an
 * arbitrarily chosen PRECEDING or FOLLOWING flag, so reading the direction flag
 * first would report a confident order between nodes that have none — and a
 * gesture that resolved a stray position outside the document would then select
 * a span by accident.
 */
export function compareTextPoints(a: TextPoint, b: TextPoint): number {
  if (a.node === b.node) return a.offset - b.offset;
  const position = a.node.compareDocumentPosition(b.node);
  if (position & Node.DOCUMENT_POSITION_DISCONNECTED) return 0;
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

/** True when the position sits inside the boundary subtree. */
export function textPointIsWithin(point: TextPoint, boundary: Element): boolean {
  return boundary.contains(point.node);
}

/** The first character of the boundary's text, or null when it holds none. */
export function firstTextPointIn(boundary: Element): TextPoint | null {
  const node = edgeTextNode(boundary, false);
  return node ? { node, offset: 0 } : null;
}

/** The last character of the boundary's text, or null when it holds none. */
export function lastTextPointIn(boundary: Element): TextPoint | null {
  const node = edgeTextNode(boundary, true);
  return node ? { node, offset: node.data.length } : null;
}

/**
 * Move a position into the boundary, leaving one already inside it alone.
 *
 * A gesture that runs off the end of a paragraph is still a gesture about that
 * paragraph, so the position is pulled to the near edge instead of being
 * discarded. Null when the boundary holds no text, where there is no edge to
 * pull it to.
 */
export function clampTextPointTo(point: TextPoint, boundary: Element): TextPoint | null {
  if (textPointIsWithin(point, boundary)) return point;
  if (compareTextPoints(point, edgePointOf(boundary, false)) < 0) return firstTextPointIn(boundary);
  return lastTextPointIn(boundary);
}

function edgePointOf(boundary: Element, fromEnd: boolean): TextPoint {
  return (fromEnd ? lastTextPointIn(boundary) : firstTextPointIn(boundary)) ?? {
    node: boundary.ownerDocument.createTextNode(''),
    offset: 0,
  };
}

/**
 * The first (or last) NON-EMPTY text node under a boundary.
 *
 * Empty text nodes are skipped deliberately: they render nothing, so a caret
 * resolved into one points at no character at all and would make an offset
 * meaningless.
 */
function edgeTextNode(boundary: Element, fromEnd: boolean): Text | null {
  const doc = boundary.ownerDocument ?? document;
  const walker = doc.createTreeWalker(boundary, NodeFilter.SHOW_TEXT);
  let found: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.data.length > 0) {
      if (!fromEnd) return node;
      found = node;
    }
    node = walker.nextNode() as Text | null;
  }
  return found;
}

/**
 * The renderer's own hit test, in its two historical spellings, plus geometry.
 *
 * `caretPositionFromPoint` is the standard; `caretRangeFromPoint` is WebKit's
 * (and Chrome's) older name. Both are consulted in that order, and a null from
 * the first is not the end of the search — a renderer can expose both and answer
 * only through one of them.
 *
 * The two spellings answer at two levels of precision, and only the precise one
 * used to be accepted: a point between two glyphs, or in the whitespace at the
 * end of a line, hit-tests to the ELEMENT with a child index. Reporting nothing
 * for that was a silent dead end on exactly the surfaces that need this most —
 * the exam prose has its platform selection suppressed, so a press that resolved
 * to nothing could not become a selection by any other route either. Geometry
 * resolves it instead, and the element the renderer named is where it looks.
 *
 * `root` BOUNDS THE ANSWER. Safari will happily return selectable text from
 * outside the touched surface — a toolbar label, a heading, another pane — and a
 * caret there is not a hit in this passage: it would anchor the student's
 * highlight to words they never touched. An answer outside the root is therefore
 * treated as no answer, the remaining hit tests are still tried, and the final
 * fallback measures the touched surface itself.
 *
 * ORDER MATTERS, and it is precise queries first, geometry last. An
 * element-level answer from one spelling is a HINT about where to measure, not
 * an answer, so it is held while the other spelling is asked — a renderer can
 * answer precisely through `caretRangeFromPoint` and coarsely through
 * `caretPositionFromPoint`, and geometry must not shadow that.
 */
export function caretPositionAtPoint(
  doc: Document,
  x: number,
  y: number,
  trace?: TouchSelectionDiagnosticRecord,
  root?: Element,
): TextPoint | null {
  const capable = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let measuredWithin: Element | null = null;
  const inRoot = (node: Node | null): boolean => !root || (!!node && root.contains(node));

  if (typeof capable.caretPositionFromPoint === 'function') {
    const position = capable.caretPositionFromPoint(x, y);
    trace?.('caretPositionFromPoint', { nodeType: position?.offsetNode.nodeType ?? null, node: describeTouchSelectionNode(position?.offsetNode ?? null), offset: position?.offset ?? null, insideRoot: root ? inRoot(position?.offsetNode ?? null) : null, x, y });
    const point = textPointFrom(position?.offsetNode ?? null, position?.offset ?? 0);
    if (point && inRoot(point.node)) return point;
    measuredWithin = inRoot(position?.offsetNode ?? null) ? elementFor(position?.offsetNode ?? null) : null;
  } else if (trace) {
    trace('caretPositionFromPoint', { available: false });
  }

  if (typeof capable.caretRangeFromPoint === 'function') {
    const range = capable.caretRangeFromPoint(x, y);
    trace?.('caretRangeFromPoint', { nodeType: range?.startContainer.nodeType ?? null, node: describeTouchSelectionNode(range?.startContainer ?? null), offset: range?.startOffset ?? null, insideRoot: root ? inRoot(range?.startContainer ?? null) : null, x, y });
    if (range) {
      const point = textPointFrom(range.startContainer, range.startOffset);
      if (point && inRoot(point.node)) return point;
      measuredWithin = measuredWithin ?? (inRoot(range.startContainer) ? elementFor(range.startContainer) : null);
    }
  } else if (trace) {
    trace('caretRangeFromPoint', { available: false });
  }

  const hit = measuredWithin ?? elementAtPoint(doc, x, y);
  if (!measuredWithin) trace?.('elementFromPoint', { node: describeTouchSelectionNode(hit), insideRoot: root ? inRoot(hit) : null });
  const element = inRoot(hit) ? hit : root ?? null;
  const point = nearestTextPointIn(element, x, y);
  trace?.('geometry', { resolved: !!point, node: describeTouchSelectionNode(point?.node ?? null), offset: point?.offset ?? null, insideRoot: root ? inRoot(point?.node ?? null) : null, x, y });
  return point;
}

function elementFor(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

function elementAtPoint(doc: Document, x: number, y: number): Element | null {
  const capable = doc as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
  };
  return typeof capable.elementFromPoint === 'function' ? capable.elementFromPoint(x, y) : null;
}

/**
 * The closest position in text, measured rather than guessed.
 *
 * For a renderer that answered a coordinate with an element — or answered with
 * nothing at all — this asks layout instead: the nearest rendered text run under
 * the root, then the nearest character in it, and an offset on whichever side of
 * that character's midpoint the point fell. That is the same rule a text cursor
 * obeys, arrived at from geometry.
 *
 * It refuses to answer when nothing is measurable. A fabricated offset would
 * anchor an annotation over words the student never touched, and on a surface
 * with its platform selection suppressed there is no second chance to notice.
 *
 * Cost is bounded by the text under the root and only runs when a hit test
 * failed. The character walk stops at the first character whose rectangle
 * contains the point, which is the common case; a press that lands in a gap
 * scans that run's characters instead of the whole root.
 */
export function nearestTextPointIn(root: Element | null, x: number, y: number): TextPoint | null {
  if (!root) return null;
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let node = walker.nextNode() as Text | null;
  let bestNode: Text | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  while (node) {
    if (node.data.length > 0) {
      const distance = distanceToNode(doc, node, x, y);
      if (distance !== null && distance < bestDistance) {
        bestDistance = distance;
        bestNode = node;
      }
    }
    node = walker.nextNode() as Text | null;
  }

  if (!bestNode) return null;
  const offset = nearestOffsetIn(doc, bestNode, x, y);
  return offset === null ? null : { node: bestNode, offset };
}

/** The nearest character of a run, as an offset on one side of its midpoint. */
function nearestOffsetIn(doc: Document, node: Text, x: number, y: number): number | null {
  let bestOffset: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < node.data.length; index += 1) {
    const measured = nearestRect(doc, node, index, x, y);
    if (!measured) continue;
    if (measured.distance === 0) {
      // The point is inside this character: nothing later can be closer.
      return x < measured.rect.left + measured.rect.width / 2 ? index : index + 1;
    }
    if (measured.distance < bestDistance) {
      bestDistance = measured.distance;
      bestOffset = x < measured.rect.left + measured.rect.width / 2 ? index : index + 1;
    }
  }

  return bestOffset;
}

interface MeasuredRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The distance to a whole run, or null when it renders nothing measurable. */
function distanceToNode(doc: Document, node: Text, x: number, y: number): number | null {
  const rects = measure(doc, () => {
    const range = doc.createRange();
    range.selectNodeContents(node);
    return range.getClientRects();
  });
  let best: number | null = null;
  for (const rect of rects) {
    const distance = distanceToRect(rect, x, y);
    if (best === null || distance < best) best = distance;
  }
  return best;
}

/** One character of a run, measured, with its distance from the point. */
function nearestRect(
  doc: Document,
  node: Text,
  index: number,
  x: number,
  y: number,
): { rect: MeasuredRect; distance: number } | null {
  const rects = measure(doc, () => {
    const range = doc.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    return range.getClientRects();
  });

  let best: { rect: MeasuredRect; distance: number } | null = null;
  for (const rect of rects) {
    const distance = distanceToRect(rect, x, y);
    if (!best || distance < best.distance) best = { rect, distance };
  }
  return best;
}

/**
 * Rects for a range, with zero-area and unmeasurable results dropped.
 *
 * A renderer that exposes no range measurement returns nothing here rather than
 * throwing, which is what keeps every caller's answer honest: no measurement, no
 * position.
 */
function measure(doc: Document, read: () => ArrayLike<MeasuredRect> | null): MeasuredRect[] {
  let list: ArrayLike<MeasuredRect> | null = null;
  try {
    list = read();
  } catch {
    return [];
  }
  if (!list) return [];
  const rects: MeasuredRect[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const rect = list[index];
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    rects.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  return rects;
}

/** Euclidean distance from a point to a rectangle, zero when inside it. */
function distanceToRect(rect: MeasuredRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
  const dy = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * A position, but only in a text node.
 *
 * A hit test between two block elements answers with an element and a CHILD
 * index, which is not a character offset; callers here build ranges and anchors
 * out of character offsets, so an element answer is reported as unresolvable
 * instead of being converted into a number that means something else.
 */
function textPointFrom(node: Node | null, offset: number): TextPoint | null {
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node as Text;
  const length = text.data.length;
  if (length === 0) return null;
  return { node: text, offset: Math.max(0, Math.min(length, Math.trunc(offset))) };
}
