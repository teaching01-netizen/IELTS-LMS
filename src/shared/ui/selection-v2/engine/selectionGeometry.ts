/**
 * What a range looks like: its lines, its handles, and where a menu may hang.
 *
 * Measuring is separated from deciding on purpose. This module reads a `Range`
 * once and returns plain numbers, so the placement rules (which side a menu
 * takes, where a handle is allowed to sit) can be reasoned about — and tested —
 * without a browser, and so the overlay never measures layout for itself.
 *
 * Two rules here are load-bearing rather than cosmetic:
 *
 * MERGED LINES. A selection crossing an inline `<mark>` or a bidi run comes back
 * from `Range.getClientRects()` as several fragments for ONE rendered line.
 * Painting them separately double-darkens their overlap and leaves visible
 * seams, so fragments sharing a line are merged into one rect.
 *
 * OUTWARD HANDLES. Each grabber sits at the line edge it belongs to and extends
 * away from the selection — the start handle above its line, the end handle
 * below its line — which is what makes the two ends read as one object instead
 * of two dots on top of the words. RTL swaps the horizontal side, because the
 * reading-order start of an Arabic line is its right edge.
 */

import type {
  CaretGeometry,
  SelectionDirection,
  SelectionEdge,
  SelectionHandleGeometry,
  SelectionPresentation,
  SelectionRect,
  TextPoint,
} from '../domain/selectionTypes';

/** Two client rects whose tops differ by less than this belong to one rendered line. */
const LINE_TOLERANCE = 1;

/**
 * The line-by-line paint of a range, or an empty list when it cannot be
 * measured.
 *
 * A renderer with no range measurement at all (jsdom) reports nothing rather
 * than throwing, which is what keeps the engine testable without a layout
 * engine. Zero-area rects are dropped: a collapsed boundary or an empty inline
 * run reports one, and painting it would draw a stray mark at the end of a line.
 */
export function selectionRectsFrom(range: Range | null): SelectionRect[] {
  if (!range || typeof range.getClientRects !== 'function') return [];
  let clientRects: ArrayLike<SelectionRect>;
  try {
    clientRects = range.getClientRects();
  } catch {
    return [];
  }
  return mergeSelectionLines(clientRects);
}

/**
 * One entry per rendered line, with fragments of the same line merged.
 *
 * Edges are derived from left/width rather than read off `rect.right`, so the
 * merge depends only on the fields this module declares and stays correct
 * against a narrowed rect (a test double, a renderer that reports
 * `DOMRectReadOnly` with a partial surface).
 */
export function mergeSelectionLines(rects: ArrayLike<SelectionRect>): SelectionRect[] {
  const lines: SelectionRect[] = [];
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    const previous = lines[lines.length - 1];
    if (previous && Math.abs(rect.top - previous.top) < LINE_TOLERANCE) {
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

/** Reading direction of the text a selection was made in. */
export function selectionDirection(element: Element | null | undefined): SelectionDirection {
  if (!element || typeof getComputedStyle !== 'function') return 'ltr';
  try {
    const style = getComputedStyle(element);
    return style?.direction === 'rtl' ? 'rtl' : 'ltr';
  } catch {
    return 'ltr';
  }
}

/**
 * Where one endpoint's grabber sits, or null when there is nothing to grab.
 *
 * `x` is the line edge the endpoint owns — left for an LTR start, right for an
 * RTL one — and `y` is the outward edge of that line, so the grabber extends
 * away from the text rather than over it.
 */
export function handleGeometryFor(
  edge: SelectionEdge,
  lines: readonly SelectionRect[],
  direction: SelectionDirection = 'ltr',
): SelectionHandleGeometry | null {
  if (lines.length === 0) return null;
  const line = edge === 'start' ? lines[0] : lines[lines.length - 1];
  if (!line) return null;
  const outwardLeft = edge === 'start' ? direction === 'ltr' : direction === 'rtl';
  return {
    edge,
    x: outwardLeft ? line.left : line.left + line.width,
    y: edge === 'start' ? line.top : line.top + line.height,
    direction,
    stem: edge === 'start' ? 'up' : 'down',
  };
}

/** Both handles of a selection, or an empty pair when it cannot be measured. */
export function selectionHandleGeometry(
  lines: readonly SelectionRect[],
  direction: SelectionDirection = 'ltr',
): { start: SelectionHandleGeometry | null; end: SelectionHandleGeometry | null } {
  return {
    start: handleGeometryFor('start', lines, direction),
    end: handleGeometryFor('end', lines, direction),
  };
}

/**
 * The accessible size of one handle control — `--selection-target` in
 * `styles/selection.css`, the full 44×44 a finger actually needs.
 *
 * The DOM control keeps this box for accessibility; the POINTER acquisition
 * rule below is directional instead. The two are deliberately different sizes
 * of claim: a 44px accessibility target is not a 44px unconditional drag
 * acquisition (see `canAcquireSelectionHandle`).
 */
const SELECTION_HANDLE_TARGET_PX = 44;

/**
 * How far an acquisition zone may reach past its line's outward edge.
 *
 * The handle's optical anchor sits exactly ON the line edge, and a hit test
 * against a rendered box arrives with sub-pixel — often sub-device-pixel —
 * rounding, so a strict comparison would reject a press on the very anchor it
 * is meant to accept. Two pixels cover that rounding while staying far inside
 * the line's body, which is the part that must never acquire.
 */
const HANDLE_ANCHOR_EPSILON_PX = 2;

/**
 * The pair `canAcquireSelectionHandle` judges: this edge's endpoint and the
 * line it belongs to — the selection's FIRST line for `start`, its LAST for
 * `end` — read straight off the paint.
 *
 * One owner because there are two callers that must never disagree: the
 * overlay arbitrates a press with it and the hook's entry gate enforces the
 * same rule with it, both against the same paint. A second copy of "which line
 * is this handle's" in each layer is an answer waiting to drift.
 */
export function handleAcquisitionFor(
  presentation: SelectionPresentation,
  edge: SelectionEdge,
): { handle: SelectionHandleGeometry | null; line: SelectionRect | null } {
  const handle = edge === 'start' ? presentation.startHandle : presentation.endHandle;
  const line = edge === 'start'
    ? presentation.rects[0] ?? null
    : presentation.rects[presentation.rects.length - 1] ?? null;
  return { handle, line };
}

/**
 * Whether a press may BEGIN a drag on this handle.
 *
 * Acquisition is strict so that tracking can be permissive: a resting
 * selection may only be resized from the outward side of one of its two VISIBLE
 * endpoints, and once acquired the finger may travel anywhere — including over
 * the selected text and past the other endpoint.
 *
 * This is the short-selection fix. Two 44×44 boxes on a two-word selection
 * geometrically overlap above and below the highlighted line, so treating the
 * whole box as draggable made the MIDDLE of the selection grab an endpoint.
 * The rule therefore has two gates: the press must be inside the accessible
 * box centred on the endpoint, AND on the handle's own side of its own line —
 * `stem: 'up'` accepts only at/above the line's top edge, `stem: 'down'` only
 * at/below its bottom. A coordinate inside the body of the selected line can
 * satisfy neither, no matter which handle box physically covers it.
 *
 * Pure geometry — endpoint, its first/last line, and a client coordinate — so
 * the arbitration in `SelectionOverlay` is testable without a browser and the
 * 44px DOM button never has to decide anything by itself.
 */
export function canAcquireSelectionHandle(
  handle: SelectionHandleGeometry,
  line: SelectionRect | null,
  x: number,
  y: number,
): boolean {
  if (!line || line.width <= 0 || line.height <= 0) return false;
  const half = SELECTION_HANDLE_TARGET_PX / 2;
  if (x < handle.x - half || x > handle.x + half) return false;
  if (y < handle.y - half || y > handle.y + half) return false;
  if (handle.stem === 'up') return y <= line.top + HANDLE_ANCHOR_EPSILON_PX;
  return y >= line.top + line.height - HANDLE_ANCHOR_EPSILON_PX;
}

/**
 * Whether a viewport coordinate is inside the painted body of the selection.
 *
 * The selected text is an explicit NO-DRAG zone: a press here preserves the
 * selection and consumes the gesture rather than dismissing it or letting the
 * same pointerdown start another selection (see `SelectionOverlay`).
 */
export function selectionContainsPoint(
  rects: readonly SelectionRect[],
  x: number,
  y: number,
): boolean {
  for (const rect of rects) {
    if (
      x >= rect.left && x <= rect.left + rect.width
      && y >= rect.top && y <= rect.top + rect.height
    ) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ caret -- */

/** The rects a range paints that a human could actually see ink in. */
function inkRects(range: Range, requireWidth: boolean): SelectionRect[] {
  if (typeof range.getClientRects !== 'function') return [];
  let rects: ArrayLike<DOMRect>;
  try {
    rects = range.getClientRects();
  } catch {
    return [];
  }
  const usable: SelectionRect[] = [];
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (!rect) continue;
    const { left, top, width, height } = rect;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(height)) continue;
    // A caret is legitimately zero-WIDTH (that is what a caret is) but never
    // zero-height; a glyph is neither.
    if (height <= 0) continue;
    if (requireWidth && width <= 0) continue;
    usable.push({ left, top, width, height });
  }
  return usable;
}

/** The rects of ONE character of a text node — its actual glyph box(es). */
function characterRects(node: Text, from: number, to: number): SelectionRect[] {
  const doc = node.ownerDocument;
  if (!doc) return [];
  const range = doc.createRange();
  try {
    range.setStart(node, from);
    range.setEnd(node, to);
  } catch {
    return [];
  }
  // A glyph split by bidi runs comes back as several rects; the caller takes
  // the edge-bearing one, so they are merged by line first.
  return mergeSelectionLines(inkRects(range, true));
}

function caretGeometry(x: number, box: SelectionRect): CaretGeometry {
  const bottom = box.top + box.height;
  return { x, y: box.top + box.height / 2, height: box.height, top: box.top, bottom };
}

/**
 * WHERE THE CARET IS — measured from the text, never estimated.
 *
 * `caretPositionAtPoint` answers "which position in the text is this finger
 * choosing"; this answers "where is that position, on screen". It is the
 * snapped, discrete point the lens is pointed at and the tick indexes, and it
 * is the whole reason a magnifier can say WHICH character rather than merely
 * roughly where.
 *
 * It is measured, and only measured. `fontSize * characterIndex` is a lie
 * within one word of any proportional font, and a different lie for Thai,
 * punctuation, RTL, emoji, ligatures and mixed styling — the browser already
 * knows where the boundary is, and a `Range` is how it is asked.
 *
 * THREE READINGS, IN ORDER:
 *
 *   1. a COLLAPSED range at the position, where the platform draws one (Safari
 *      answers with a zero-width, full-height rect; Blink and Gecko answer with
 *      nothing at all, which is why this reading alone is not enough);
 *   2. the ADJACENT characters, whose real glyph edges bound the boundary —
 *      the preceding character's far edge, or the following one's near edge
 *      where the position begins a line: a soft wrap puts the boundary at the
 *      start of the line the next glyph is on, not at the end of the line the
 *      finger has just left;
 *   3. null, where nothing measurable exists — a renderer with no layout
 *      (jsdom), a node the document has let go of, a position with no ink on
 *      either side of it. Callers fall back to the finger rather than painting
 *      the lens at the origin.
 *
 * Reads `getComputedStyle` for direction, so it belongs in the same frame as
 * every other geometry read this engine makes — never in an event handler.
 */
export function caretGeometryFromTextPoint(point: TextPoint | null | undefined): CaretGeometry | null {
  if (!point) return null;
  const node = point.node;
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const doc = node.ownerDocument;
  if (!doc || typeof doc.createRange !== 'function') return null;
  const text = node.data ?? '';
  if (typeof point.offset !== 'number' || !Number.isFinite(point.offset)) return null;
  const offset = Math.max(0, Math.min(Math.trunc(point.offset), text.length));
  const rtl = selectionDirection(node.parentElement) === 'rtl';

  // 1. The caret itself, collapsed at the position.
  const caret = doc.createRange();
  try {
    caret.setStart(node, offset);
    caret.collapse(true);
  } catch {
    return null;
  }
  const drawn = inkRects(caret, false)[0];
  if (drawn) {
    return caretGeometry(rtl && drawn.width > 0 ? drawn.left + drawn.width : drawn.left, drawn);
  }

  // 2. The glyphs on either side of the boundary, and their real edges.
  const before = offset > 0 ? characterRects(node, offset - 1, offset) : [];
  const after = offset < text.length ? characterRects(node, offset, offset + 1) : [];
  const previous = before.length > 0 ? before[before.length - 1] : null;
  const next = after.length > 0 ? after[0] : null;

  if (previous && next) {
    if (Math.abs(previous.top - next.top) < LINE_TOLERANCE) {
      // Same line: the boundary is the edge the two glyphs share.
      return caretGeometry(rtl ? previous.left : previous.left + previous.width, next);
    }
    // A wrap: the position begins the line the FOLLOWING glyph sits on.
    return caretGeometry(rtl ? next.left + next.width : next.left, next);
  }
  if (previous) return caretGeometry(rtl ? previous.left : previous.left + previous.width, previous);
  if (next) return caretGeometry(rtl ? next.left + next.width : next.left, next);
  return null;
}

/**
 * The union box of a selection, which is what a menu anchors against.
 *
 * The per-line rects exist for the HORIZONTAL question, which the union box
 * answers badly: a wrapped selection's union spans its widest line, so a menu
 * centred on it can point at empty space beside a short first or last line. The
 * union is still the right answer for "is any of this on screen" and for the
 * vertical extent, which is why both are offered.
 */
export function selectionAnchorRect(lines: readonly SelectionRect[]): SelectionRect | null {
  if (lines.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    left = Math.min(left, line.left);
    top = Math.min(top, line.top);
    right = Math.max(right, line.left + line.width);
    bottom = Math.max(bottom, line.top + line.height);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

