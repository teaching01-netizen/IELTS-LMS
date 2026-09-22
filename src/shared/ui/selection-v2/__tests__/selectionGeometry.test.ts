import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canAcquireSelectionHandle,
  caretGeometryFromTextPoint,
  handleGeometryFor,
  mergeSelectionLines,
  resolveHandleAcquisition,
  selectionAnchorRect,
  selectionDirection,
  selectionHandleGeometry,
  selectionRectsFrom,
} from '../engine/selectionGeometry';
import { IDLE_SELECTION, type SelectionDirection, type SelectionRect, type TextPoint } from '../domain/selectionTypes';

const rect = (left: number, top: number, width: number, height: number): SelectionRect => ({ left, top, width, height });

function rangeWith(rects: SelectionRect[]): Range {
  return { getClientRects: () => rects } as unknown as Range;
}

describe('lines', () => {
  it('merges fragments that share a rendered line so the paint never double-darkens', () => {
    const lines = mergeSelectionLines([rect(10, 100, 20, 18), rect(30, 100, 25, 18), rect(10, 120, 40, 18)]);

    expect(lines).toEqual([rect(10, 100, 45, 18), rect(10, 120, 40, 18)]);
  });

  it('keeps lines that are almost the same distance apart distinct', () => {
    const lines = mergeSelectionLines([rect(0, 10, 5, 18), rect(0, 28.5, 5, 18)]);

    expect(lines).toHaveLength(2);
  });

  it('ignores zero-sized fragments, which paint nothing', () => {
    expect(mergeSelectionLines([rect(10, 100, 0, 0), rect(10, 100, 12, 18)])).toEqual([rect(10, 100, 12, 18)]);
  });

  it('reports nothing for a missing range or a renderer with no measurement', () => {
    expect(selectionRectsFrom(null)).toEqual([]);
    expect(selectionRectsFrom({} as unknown as Range)).toEqual([]);
  });

  it('re-measures a range that moved, so a reflow is never painted from stale geometry', () => {
    let rects = [rect(0, 0, 50, 20)];
    const range = { getClientRects: () => rects } as unknown as Range;

    expect(selectionRectsFrom(range)).toEqual([rect(0, 0, 50, 20)]);
    rects = [rect(0, 40, 50, 20)];
    expect(selectionRectsFrom(range)).toEqual([rect(0, 40, 50, 20)]);
  });
});

describe('direction', () => {
  it('reads the writing direction of the text the selection was made in', () => {
    const rtl = document.createElement('p');
    rtl.style.direction = 'rtl';
    document.body.append(rtl);

    expect(selectionDirection(rtl)).toBe('rtl');
    expect(selectionDirection(document.createElement('p'))).toBe('ltr');
    expect(selectionDirection(null)).toBe('ltr');
  });
});

describe('handles', () => {
  const lines = [rect(10, 100, 200, 20), rect(10, 124, 80, 20)];

  it('puts the start handle on the first line and the end handle on the last', () => {
    const { start, end } = selectionHandleGeometry(lines, 'ltr');

    expect(start).toMatchObject({ edge: 'start', x: 10, y: 100, stem: 'up' });
    expect(end).toMatchObject({ edge: 'end', x: 90, y: 144, stem: 'down' });
  });

  it('mirrors both handles for RTL text, where the start of a line is its right edge', () => {
    const { start, end } = selectionHandleGeometry(lines, 'rtl');

    expect(start).toMatchObject({ x: 210, y: 100 });
    expect(end).toMatchObject({ x: 10, y: 144 });
  });

  it('reports no handle when the selection cannot be measured', () => {
    expect(handleGeometryFor('start', [], 'ltr')).toBeNull();
    expect(selectionHandleGeometry([], 'ltr')).toEqual({ start: null, end: null });
  });

  it('places both handles on the single line of a one-line selection', () => {
    const { start, end } = selectionHandleGeometry([rect(50, 10, 30, 20)], 'ltr');

    expect(start).toMatchObject({ x: 50, y: 10 });
    expect(end).toMatchObject({ x: 80, y: 30 });
  });
});

describe('the anchor box', () => {
  const lines = [rect(10, 100, 200, 20), rect(10, 124, 80, 20)];

  it('unions the lines, because a menu hangs off the whole selection', () => {
    expect(selectionAnchorRect(lines)).toEqual(rect(10, 100, 200, 44));
    expect(selectionAnchorRect([])).toBeNull();
  });
});

/**
 * WHICH ENDPOINT A PRESS GRABS — the one decision that may not come from the DOM.
 *
 * A selection narrower than 44px puts its two accessible boxes on top of each
 * other, and a line box short enough puts one of them over the other's entire
 * outward zone, so the control a press is delivered to is not evidence of which
 * endpoint the student aimed at. These cases are therefore stated as paints and
 * coordinates — the function's only inputs — and each one names the endpoint the
 * press belongs to.
 */
describe('handle acquisition', () => {
  /** A resting one-line selection, with both handles on that line. */
  function resting(lines: SelectionRect[], direction: SelectionDirection = 'ltr') {
    const { start, end } = selectionHandleGeometry(lines, direction);
    return { ...IDLE_SELECTION, id: 'selection:1', phase: 'selected' as const, rects: lines, startHandle: start, endHandle: end };
  }

  /** A two-character word: 20px wide, and a line a real passage would have. */
  const word = resting([rect(10, 100, 20, 21)]);

  it('takes the press for the only endpoint whose outward zone accepts it', () => {
    // Above the line: the start handle's zone, and the end handle's box does not
    // reach here at all.
    expect(resolveHandleAcquisition(word, 16, 99)).toBe('start');
    // Below it: the end handle's zone, and the start handle's box does not reach.
    expect(resolveHandleAcquisition(word, 24, 122)).toBe('end');
  });

  it('acquires NEITHER endpoint from the selected text, even inside both boxes', () => {
    // The middle of a short word: inside both 44px boxes, on neither outward
    // side. This is the selection's body — inert, never resized.
    expect(canAcquireSelectionHandle(word.startHandle!, word.rects[0]!, 20, 110)).toBe(false);
    expect(canAcquireSelectionHandle(word.endHandle!, word.rects[0]!, 20, 110)).toBe(false);
    expect(resolveHandleAcquisition(word, 20, 110)).toBeNull();
  });

  it('never lets the endpoint the press landed on refuse a zone the other one accepts', () => {
    // The paint that made this rule load-bearing: a 21px line puts the end
    // handle's 44px box over the start handle's upward zone (its top edge is 1px
    // above the line's top). A press there belongs to the START, and a caller
    // that asked only the control it landed on would refuse it.
    // The end handle's box is centred on the line's bottom edge (y = 121), so it
    // reaches up to y = 99 — over the start handle's outward zone, which is the
    // line's top edge and the two pixels above it. A press at y = 101 belongs to
    // the START, whatever the end control's box covers.
    expect(word.endHandle!.y - 22).toBeLessThanOrEqual(101);
    expect(canAcquireSelectionHandle(word.endHandle!, word.rects[0]!, 20, 101)).toBe(false);
    expect(resolveHandleAcquisition(word, 20, 101)).toBe('start');
  });

  it('gives a two-zone press to the nearer optical anchor', () => {
    // A line 4px tall: the two zones overlap, and the nearer anchor is the
    // start's. Synthetic — real text is never this short — and the only way to
    // reach the branch at all.
    const flat = resting([rect(10, 100, 20, 4)]);
    expect(resolveHandleAcquisition(flat, 12, 102)).toBe('start');
    expect(resolveHandleAcquisition(flat, 28, 102)).toBe('end');
  });

  it('resolves an exact tie by the pointer\u2019s side of the span, in reading order', () => {
    const flat = resting([rect(10, 100, 20, 4)]);
    // Exactly between the two anchors: the earlier endpoint's, and the midpoint
    // itself counts as the earlier side.
    expect(resolveHandleAcquisition(flat, 20, 102)).toBe('start');

    // The same paint read right to left: the reading-order start is the RIGHT
    // edge, so that same coordinate is now the end's. One rule, no extra case.
    const rtl = resting([rect(10, 100, 20, 4)], 'rtl');
    expect(rtl.startHandle!.x).toBeGreaterThan(rtl.endHandle!.x);
    expect(resolveHandleAcquisition(rtl, 20, 102)).toBe('end');
  });

  it('answers from the paint alone, so nothing about the DOM can change it', () => {
    // The same paint and coordinate twice: identical, because the only inputs
    // are the measured geometry and the point.
    const press = { x: 16, y: 99, first: resolveHandleAcquisition(word, 16, 99) };
    expect(resolveHandleAcquisition({ ...word }, press.x, press.y)).toBe(press.first);
    // And a paint with no measurable handles acquires nothing rather than
    // guessing an endpoint.
    expect(resolveHandleAcquisition({ ...IDLE_SELECTION, phase: 'selected' }, 16, 99)).toBeNull();
  });
});

/** One glyph's box, laid out left to right from x = 10 on a single line. */
interface Glyph {
  left: number;
  top: number;
  width: number;
  height: number;
}

function line(widths: number[], top = 100, left = 10, height = 20): Glyph[] {
  const boxes: Glyph[] = [];
  let x = left;
  for (const width of widths) {
    boxes.push({ left: x, top, width, height });
    x += width;
  }
  return boxes;
}

/**
 * A text node with the glyph boxes jsdom cannot produce, and a `document` whose
 * Ranges answer with them.
 *
 * The whole contract of `caretGeometryFromTextPoint` is that it MEASURES rather
 * than estimates, so the honest stand-in for a renderer is the renderer's own
 * answers: one rect per character, at deliberately irregular widths. A caret
 * position's geometry is then a value that `fontSize * characterIndex` could not
 * reach by accident — and the two-length case below proves it: the same offset
 * in the same length of text measures differently when the glyphs are a
 * different shape.
 *
 * `caretBox` is what a platform that draws a collapsed caret reports (Safari:
 * zero width, full height); leaving it unset is what Blink and Gecko report for
 * a collapsed Range — nothing at all — which is the reading that forces the
 * adjacent-glyph fallback.
 */
function laidOut(
  text: string,
  boxes: Glyph[],
  options: { direction?: 'rtl' | undefined; caretBox?: Glyph | undefined } = {},
) {
  const container = document.createElement('p');
  if (options.direction) container.style.direction = options.direction;
  container.textContent = text;
  document.body.append(container);
  const node = container.firstChild as Text;

  const realCreateRange = document.createRange.bind(document);
  const spy = vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = realCreateRange();
    range.getClientRects = () => {
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : start;
      if (start === end) return options.caretBox ? [options.caretBox as unknown as DOMRect] : [];
      return boxes.slice(start, end) as unknown as DOMRect[];
    };
    return range;
  });

  return {
    node,
    point: (offset: number): TextPoint => ({ node, offset }),
    restore: () => {
      spy.mockRestore();
      container.remove();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('caretGeometryFromTextPoint', () => {
  it('measures the boundary from the real glyph edges, not from an index', () => {
    const laid = laidOut('abcdef', line([5, 9, 4, 12, 7, 6]));
    try {
      const geometry = caretGeometryFromTextPoint(laid.point(3));

      // The far edge of the glyph BEFORE the boundary: 10 + 5 + 9 + 4 = 28.
      // An index estimator handed the same glyph at the same offset could only
      // land here by guessing the widths correctly, which is the point.
      expect(geometry).toMatchObject({ x: 28, y: 110, height: 20, top: 100, bottom: 120 });
    } finally {
      laid.restore();
    }
  });

  it('measures the SAME offset differently when the glyphs are a different shape', () => {
    // The decisive pair: identical text, identical offset, identical font size —
    // and two answers, because only one of them came from the layout.
    const narrow = laidOut('abcdef', line([5, 5, 5, 5, 5, 5]));
    let narrowEdge: number | undefined;
    try {
      narrowEdge = caretGeometryFromTextPoint(narrow.point(3))?.x;
    } finally {
      narrow.restore();
    }

    const wide = laidOut('abcdef', line([40, 40, 40, 40, 40, 40]));
    let wideEdge: number | undefined;
    try {
      wideEdge = caretGeometryFromTextPoint(wide.point(3))?.x;
    } finally {
      wide.restore();
    }

    expect(narrowEdge).toBe(10 + 15);
    expect(wideEdge).toBe(10 + 120);
    expect(narrowEdge).not.toBe(wideEdge);
  });

  it('takes the edge RTL text actually has: the preceding glyph\'s left, not its right', () => {
    const laid = laidOut('abcdef', line([5, 9, 4, 12, 7, 6]), { direction: 'rtl' });
    try {
      // Same boundary as the LTR case (x = 28 there); in RTL the glyph before it
      // sits to its RIGHT, so the shared edge is that glyph's LEFT: 24.
      expect(caretGeometryFromTextPoint(laid.point(3))).toMatchObject({ x: 24, y: 110 });
    } finally {
      laid.restore();
    }
  });

  it('puts a wrapped position on the line the NEXT glyph is on, never between the lines', () => {
    // Glyph 3 is the first of a second line: the position at offset 3 belongs to
    // that line, and a caret parked in the whitespace between them would aim the
    // lens at a line the text does not have.
    const boxes = [...line([6, 6, 6], 100), ...line([9, 6], 130)];
    const laid = laidOut('abcdef', boxes);
    try {
      const geometry = caretGeometryFromTextPoint(laid.point(3));

      expect(geometry).toMatchObject({ x: 10, top: 130, bottom: 150, y: 140 });
      // And it is one of the rendered lines exactly — no averaging, no midpoint
      // of the gap the finger may have been travelling through.
      const renderedTops = boxes.map((box) => box.top);
      expect(renderedTops).toContain(geometry!.top);
      expect(geometry!.top).not.toBeGreaterThan(130);
    } finally {
      laid.restore();
    }
  });

  it('anchors the two ends of a node: the last boundary after it, the first before it', () => {
    const laid = laidOut('abc', line([7, 4, 9]));
    try {
      expect(caretGeometryFromTextPoint(laid.point(3))).toMatchObject({ x: 30, y: 110 });
      expect(caretGeometryFromTextPoint(laid.point(0))).toMatchObject({ x: 10, y: 110 });
    } finally {
      laid.restore();
    }
  });

  it('prefers the caret rect a platform draws, and falls back where it draws none', () => {
    // Safari answers a collapsed Range with a zero-width, full-height rect — and
    // it is the reading taken FIRST, so it wins even where it disagrees with the
    // glyph edges (999 below is deliberately impossible for a glyph to produce).
    const safari = laidOut('abc', line([7, 4, 9]), { caretBox: { left: 999, top: 100, width: 0, height: 20 } });
    try {
      expect(caretGeometryFromTextPoint(safari.point(2))).toMatchObject({ x: 999, y: 110, height: 20 });
    } finally {
      safari.restore();
    }

    // Blink and Gecko answer with nothing, which is what sends it to the glyphs.
    const blink = laidOut('abc', line([7, 4, 9]));
    try {
      expect(caretGeometryFromTextPoint(blink.point(2))).toMatchObject({ x: 21, y: 110 });
    } finally {
      blink.restore();
    }
  });

  it('measures Thai from the DOM, where an index estimate cannot follow the script', () => {
    // Irregular by construction: a cluster's rendered width has nothing to do
    // with how many code units it is made of, which is exactly what breaks
    // `fontSize * characterIndex` on this script.
    const thai = 'ก้ ้ะำ';
    const irregular = laidOut(thai, line([14, 3, 11, 6, 22]));
    try {
      const geometry = caretGeometryFromTextPoint(irregular.point(3));
      // 10 + 14 + 3 + 11 = 38 — the actual edge of the third cluster.
      expect(geometry).toMatchObject({ x: 38, y: 110 });
    } finally {
      irregular.restore();
    }
  });

  it('reports nothing at all where nothing can be measured, rather than a guess', () => {
    // jsdom measures every range as empty: the honest answer a caller falls back
    // to the finger for, and never a fabricated position over real words.
    const container = document.createElement('p');
    container.textContent = 'alpha beta';
    document.body.append(container);
    const node = container.firstChild as Text;

    expect(caretGeometryFromTextPoint({ node, offset: 4 })).toBeNull();
    expect(caretGeometryFromTextPoint(null)).toBeNull();
    expect(caretGeometryFromTextPoint(undefined)).toBeNull();
  });

  it('never parks the caret in the vertical whitespace between two lines', () => {
    // The band between rendered lines is where a finger spends most of its
    // travel and where there is no text to be at: a caret aimed into it would
    // point the lens at a gap between two rows of words. EVERY boundary of a
    // wrapped node must resolve onto one of the lines the layout produced —
    // exhaustively, because a single average would still land inside a line on
    // either side of the one offset that gets it wrong.
    const boxes = [...line([6, 6, 6], 100), ...line([9, 6, 5], 130)]; // gap: 120–130
    const laid = laidOut('abcdef', boxes);
    try {
      for (let offset = 0; offset <= 6; offset += 1) {
        const geometry = caretGeometryFromTextPoint(laid.point(offset));
        expect(geometry, `offset ${offset} measured nothing`).not.toBeNull();
        // `top` is a rendered line's own top — never an interpolation, and
        // `y` (the middle of that box) is never strictly inside the gap.
        expect(
          geometry!.top === 100 || geometry!.top === 130,
          `offset ${offset} parked at top=${geometry!.top}`,
        ).toBe(true);
        const onALine =
          (geometry!.y >= 100 && geometry!.y <= 120) || (geometry!.y >= 130 && geometry!.y <= 150);
        expect(onALine, `offset ${offset} parked at y=${geometry!.y}`).toBe(true);
      }
    } finally {
      laid.restore();
    }
  });
});
