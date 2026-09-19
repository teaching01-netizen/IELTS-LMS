/**
 * Where a finger is, expressed as a position in text.
 *
 * An exam on a touch device cannot use the platform's own text selection: the
 * moment a selection exists, iOS and Android paint their own Copy / Look Up /
 * Search / Share bar over the passage, and no amount of `contextmenu`
 * suppression or `-webkit-touch-callout` removes it. So touch highlighting is
 * built on positions we resolve ourselves, and this module is that half — a
 * pointer coordinate turned into a text node and an offset, plus the ordering
 * and containment facts the gesture needs to decide what was selected.
 *
 * Everything here is pure and total: a position that cannot be resolved returns
 * null rather than a plausible substitute, because a wrong offset silently
 * anchors an annotation over the wrong words.
 */

import { describeTouchSelectionNode, type TouchSelectionDiagnosticRecord } from './touchSelectionDiagnostics';

/** An offset into one rendered text node. */
export interface TextPoint {
  node: Text;
  offset: number;
}

/** A half-open run of characters inside one text node. */
export interface WordSegment {
  start: number;
  end: number;
}

/**
 * The slice of `Intl.Segmenter` a word lookup needs, narrowed so a test (and a
 * runtime without ICU data) can supply its own.
 */
export interface WordSegmenter {
  segment: (text: string) => Iterable<{ start: number; end: number; isWordLike?: boolean }>;
}

/**
 * Document order for two text positions: negative when `a` precedes `b`, positive
 * when it follows, zero when they are the same position or live in different
 * trees.
 *
 * `Node.compareDocumentPosition` rather than `Range.comparePoint`: the offset
 * within one node is the whole answer when the nodes match, and for two nodes the
 * bitmask says which comes first without materializing a Range.
 *
 * The DISCONNECTED flag is checked FIRST, and that ordering is the whole point.
 * A spec-compliant answer for two separate trees carries DISCONNECTED *plus* an
 * arbitrarily chosen PRECEDING or FOLLOWING flag, so reading the direction flag
 * first would report a confident order between nodes that have none — and a
 * gesture that resolved a stray position outside the document would then select
 * a span by accident.
 */
export function compareTextPoints(a: TextPoint, b: TextPoint): number {
  if (a.node === b.node) {
    return a.offset - b.offset;
  }
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
 * the first is not the end of the search — a renderer can expose both and
 * answer only through one of them.
 *
 * The two spellings answer at two levels of precision, and only the precise one
 * used to be accepted: a point between two glyphs, or in the whitespace at the
 * end of a line, hit-tests to the ELEMENT with a child index. Reporting nothing
 * for that was a silent dead end on exactly the surfaces that need this most —
 * the exam prose has its platform selection suppressed, so a press that resolved
 * to nothing could not become a selection by any other route either. Geometry
 * resolves it instead, and the element the renderer named is where it looks.
 *
 * A renderer with neither hit test still gets one last chance through
 * `elementFromPoint`, which is layout geometry rather than a caret query and is
 * therefore a different capability, not a duplicate of the two above.
 *
 * ORDER MATTERS, and it is precise queries first, geometry last. An
 * element-level answer from one spelling is a HINT about where to measure, not
 * an answer, so it is held while the other spelling is asked — a renderer can
 * answer precisely through `caretRangeFromPoint` and coarsely through
 * `caretPositionFromPoint`, and geometry must not shadow that.
 */
export function caretPositionAtPoint(doc: Document, x: number, y: number, trace?: TouchSelectionDiagnosticRecord): TextPoint | null {
  const capable = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let measuredWithin: Element | null = null;

  if (typeof capable.caretPositionFromPoint === 'function') {
    const position = capable.caretPositionFromPoint(x, y);
    trace?.('caretPositionFromPoint', { nodeType: position?.offsetNode.nodeType ?? null, node: describeTouchSelectionNode(position?.offsetNode ?? null), offset: position?.offset ?? null, x, y });
    const point = textPointFrom(position?.offsetNode ?? null, position?.offset ?? 0);
    if (point) return point;
    measuredWithin = elementFor(position?.offsetNode ?? null);
  } else if (trace) {
    trace('caretPositionFromPoint', { available: false });
  }

  if (typeof capable.caretRangeFromPoint === 'function') {
    const range = capable.caretRangeFromPoint(x, y);
    trace?.('caretRangeFromPoint', { nodeType: range?.startContainer.nodeType ?? null, node: describeTouchSelectionNode(range?.startContainer ?? null), offset: range?.startOffset ?? null, x, y });
    if (range) {
      const point = textPointFrom(range.startContainer, range.startOffset);
      if (point) return point;
      measuredWithin = measuredWithin ?? elementFor(range.startContainer);
    }
  } else if (trace) {
    trace('caretRangeFromPoint', { available: false });
  }

  const element = measuredWithin ?? elementAtPoint(doc, x, y);
  if (!measuredWithin) trace?.('elementFromPoint', { node: describeTouchSelectionNode(element) });
  const point = nearestTextPointIn(element, x, y);
  trace?.('geometry', { resolved: !!point, node: describeTouchSelectionNode(point?.node ?? null), offset: point?.offset ?? null, x, y });
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
 * throwing, which is what keeps every caller's answer honest: no measurement,
 * no position.
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

/**
 * A word segmenter when the runtime has one, else null.
 *
 * ICU data is what makes this worth asking for: a script without spaces between
 * words (Thai, Chinese, Japanese) has no word boundaries for a regular
 * expression to find, and `Intl.Segmenter` is the only thing in the platform
 * that knows them. When it is absent the regex fallback still segments
 * space-separated scripts correctly, and reports the rest as one long run.
 *
 * The native segments are translated rather than passed through: `Intl.Segmenter`
 * reports `index` plus the matched `segment` string, so reading `start`/`end` off
 * it directly yields `undefined` and every word lookup silently finds nothing.
 */
export function defaultWordSegmenter(): WordSegmenter | null {
  const IntlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: new (
      locales?: string,
      options?: { granularity: string },
    ) => {
      segment: (text: string) => Iterable<{ index: number; segment: string; isWordLike?: boolean }>;
    };
  };
  if (typeof IntlWithSegmenter.Segmenter !== 'function') return null;
  try {
    const native = new IntlWithSegmenter.Segmenter(undefined, { granularity: 'word' });
    return {
      *segment(text: string) {
        for (const part of native.segment(text)) {
          yield {
            start: part.index,
            end: part.index + part.segment.length,
            isWordLike: part.isWordLike ?? false,
          };
        }
      },
    };
  } catch {
    return null;
  }
}

const WORD_CHARACTER = /[\p{L}\p{N}_']/u;

/**
 * The word a finger landed on, as offsets into its own text node.
 *
 * Three rules, in order:
 *
 *   1. A press inside a word takes that word.
 *   2. A press in a gap — the space after a word — takes the word it follows,
 *      which is what the platform's own selection does and what a student
 *      pressing beside a word means.
 *   3. A press in a gap BEFORE any word takes the word that follows. This is the
 *      leading-whitespace case, and rule 2 has already declined to claim it.
 *
 * A press that reaches no word at all — punctuation between runs, a run of
 * spaces — resolves to nothing rather than to a nearby guess, because selecting
 * the wrong word and selecting none are different mistakes and only one of them
 * can be seen by the student.
 */
export function expandToWordAt(
  point: TextPoint,
  segmenter: WordSegmenter | null = defaultWordSegmenter(),
): WordSegment | null {
  const text = point.node.data;
  if (text.length === 0) return null;
  const offset = Math.max(0, Math.min(text.length, point.offset));
  const segments = segmenter ? [...segmenter.segment(text)] : fallbackWordSegments(text);

  for (const segment of segments) {
    if (segment.isWordLike === false) continue;
    if (segment.start <= offset && offset < segment.end) return { start: segment.start, end: segment.end };
  }

  // The nearest word that has already ended. Segments arrive in order, so the
  // last one to qualify is the closest.
  let preceding: WordSegment | null = null;
  for (const segment of segments) {
    if (segment.isWordLike === false) continue;
    if (segment.end > offset) break;
    preceding = { start: segment.start, end: segment.end };
  }
  if (preceding) return preceding;

  for (const segment of segments) {
    if (segment.isWordLike === false) continue;
    if (segment.start === offset && segment.end > offset) return { start: segment.start, end: segment.end };
  }
  return null;
}

/**
 * Word runs found by unicode word characters, for runtimes without ICU
 * segmentation. Everything outside the `\\\\p{L}\\\\p{N}` classes is a boundary, so a
 * script that does not space its words comes back as one long run — honest, and
 * the reason `Intl.Segmenter` is preferred when it is there.
 */
function fallbackWordSegments(text: string): Array<{ start: number; end: number; isWordLike: boolean }> {
  const segments: Array<{ start: number; end: number; isWordLike: boolean }> = [];
  let index = 0;
  while (index < text.length) {
    const isWord = WORD_CHARACTER.test(text[index]!);
    let end = index;
    while (end < text.length && WORD_CHARACTER.test(text[end]!) === isWord) end += 1;
    segments.push({ start: index, end, isWordLike: isWord });
    index = end;
  }
  return segments;
}
