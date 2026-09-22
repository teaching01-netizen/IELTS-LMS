import { describe, expect, it, vi } from 'vitest';
import {
  caretPositionAtPoint,
  clampTextPointTo,
  compareTextPoints,
  firstTextPointIn,
  lastTextPointIn,
  nearestTextPointIn,
  textPointIsWithin,
  type TextPoint,
} from '../engine/selectionPoint';
import { expandToWordAt, type WordSegmenter } from '../domain/selectionSegmenter';

function build(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function textNodeOf(element: Element): Text {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode() as Text | null;
  if (!node) throw new Error('no text node');
  return node;
}

/**
 * A rendered line, as jsdom refuses to have one.
 *
 * The geometric fallback is the one part of the selection gesture that reads
 * layout, so its tests have to supply layout: a character grid per text node,
 * with `perLine` characters to a line. Rectangles are synthesized for whatever
 * a range covers, which is what makes the offset arithmetic assertable — a
 * point at x is a character index, deterministically.
 */
interface FakeLine {
  node: Text;
  x0: number;
  y0: number;
  charWidth: number;
  charHeight: number;
  perLine?: number | undefined;
}

function installFakeLayout(lines: FakeLine[]): () => void {
  const byNode = new Map<Text, FakeLine>(lines.map((line) => [line.node, line] as const));
  const proto = Range.prototype as unknown as {
    getClientRects?: (this: Range) => unknown;
    getBoundingClientRect?: (this: Range) => unknown;
  };
  const original = {
    getClientRects: proto.getClientRects,
    getBoundingClientRect: proto.getBoundingClientRect,
  };

  const rectsFor = (range: Range) => {
    if (range.endContainer !== range.startContainer) return [];
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return [];
    const line = byNode.get(node as Text);
    if (!line || range.endOffset <= range.startOffset) return [];
    const perLine = line.perLine ?? Number.MAX_SAFE_INTEGER;
    const rects: Array<{ left: number; top: number; width: number; height: number }> = [];
    for (let index = range.startOffset; index < range.endOffset; index += 1) {
      rects.push({
        left: line.x0 + (index % perLine) * line.charWidth,
        top: line.y0 + Math.floor(index / perLine) * line.charHeight,
        width: line.charWidth,
        height: line.charHeight,
      });
    }
    return rects;
  };

  proto.getClientRects = function (this: Range) {
    return rectsFor(this);
  };
  proto.getBoundingClientRect = function (this: Range) {
    return rectsFor(this)[0] ?? { left: 0, top: 0, width: 0, height: 0 };
  };

  return () => {
    if (original.getClientRects) proto.getClientRects = original.getClientRects;
    else delete proto.getClientRects;
    if (original.getBoundingClientRect) proto.getBoundingClientRect = original.getBoundingClientRect;
    else delete proto.getBoundingClientRect;
  };
}

describe('compareTextPoints', () => {
  it('orders two offsets inside one text node', () => {
    const host = build('alpha');
    const node = textNodeOf(host);

    expect(compareTextPoints({ node, offset: 1 }, { node, offset: 3 })).toBeLessThan(0);
    expect(compareTextPoints({ node, offset: 3 }, { node, offset: 1 })).toBeGreaterThan(0);
    expect(compareTextPoints({ node, offset: 2 }, { node, offset: 2 })).toBe(0);
  });

  it('orders points across sibling blocks in document order', () => {
    const host = build('<p>first</p><p>second</p>');
    const [first, second] = Array.from(host.querySelectorAll('p')).map(textNodeOf);

    expect(compareTextPoints({ node: first!, offset: 0 }, { node: second!, offset: 0 })).toBeLessThan(0);
    expect(compareTextPoints({ node: second!, offset: 0 }, { node: first!, offset: 0 })).toBeGreaterThan(0);
  });

  it('reports a tie for text in two disconnected documents', () => {
    const detached = document.implementation.createHTMLDocument('other');
    const other = detached.createTextNode('elsewhere');
    const host = build('here');

    expect(compareTextPoints({ node: textNodeOf(host), offset: 0 }, { node: other, offset: 0 })).toBe(0);
  });
});

describe('textPointIsWithin', () => {
  it('accepts a point inside the boundary and rejects one outside it', () => {
    const host = build('<p id="in">inside</p><p id="out">outside</p>');
    const inside = host.querySelector('#in')!;
    const outside = host.querySelector('#out')!;

    expect(textPointIsWithin({ node: textNodeOf(inside), offset: 2 }, inside)).toBe(true);
    expect(textPointIsWithin({ node: textNodeOf(outside), offset: 2 }, inside)).toBe(false);
  });
});

describe('firstTextPointIn / lastTextPointIn', () => {
  it('skips empty text nodes at both edges', () => {
    const host = build('<p></p><p>real</p><p></p>');
    const real = host.querySelectorAll('p')[1]!;

    expect(firstTextPointIn(host)).toEqual({ node: textNodeOf(real), offset: 0 });
    expect(lastTextPointIn(host)).toEqual({ node: textNodeOf(real), offset: 4 });
  });

  it('returns null when the boundary holds no text at all', () => {
    const host = build('<p><img alt="" /></p>');

    expect(firstTextPointIn(host)).toBeNull();
    expect(lastTextPointIn(host)).toBeNull();
  });
});

describe('clampTextPointTo', () => {
  it('leaves a point already inside the boundary untouched', () => {
    const host = build('<p id="in">inside</p>');
    const boundary = host.querySelector('#in')!;
    const point: TextPoint = { node: textNodeOf(boundary), offset: 3 };

    expect(clampTextPointTo(point, boundary)).toEqual(point);
  });

  it('pulls a point before the boundary to its first character', () => {
    const host = build('<p id="before">before</p><p id="in">inside</p>');
    const boundary = host.querySelector('#in')!;
    const outside: TextPoint = { node: textNodeOf(host.querySelector('#before')!), offset: 2 };

    expect(clampTextPointTo(outside, boundary)).toEqual({ node: textNodeOf(boundary), offset: 0 });
  });

  it('pushes a point after the boundary to its last character', () => {
    const host = build('<p id="in">inside</p><p id="after">after</p>');
    const boundary = host.querySelector('#in')!;
    const outside: TextPoint = { node: textNodeOf(host.querySelector('#after')!), offset: 2 };

    expect(clampTextPointTo(outside, boundary)).toEqual({ node: textNodeOf(boundary), offset: 6 });
  });

  it('returns null when the boundary has no text to clamp into', () => {
    const host = build('<p id="in"><img alt="" /></p><p id="after">after</p>');
    const boundary = host.querySelector('#in')!;
    const outside: TextPoint = { node: textNodeOf(host.querySelector('#after')!), offset: 0 };

    expect(clampTextPointTo(outside, boundary)).toBeNull();
  });
});

describe('caretPositionAtPoint', () => {
  const host = build('<p>hello</p>');
  const text = textNodeOf(host.querySelector('p')!);

  function fakeDocument(overrides: Record<string, unknown>): Document {
    return overrides as unknown as Document;
  }

  it('prefers caretPositionFromPoint and clamps the offset into the node', () => {
    const doc = fakeDocument({
      caretPositionFromPoint: () => ({ offsetNode: text, offset: 99 }),
    });

    expect(caretPositionAtPoint(doc, 10, 20)).toEqual({ node: text, offset: 5 });
  });

  it('falls through to caretRangeFromPoint when caretPositionFromPoint is missing', () => {
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const doc = fakeDocument({ caretRangeFromPoint: () => range });

    expect(caretPositionAtPoint(doc, 10, 20)).toEqual({ node: text, offset: 2 });
  });

  it.each(['position', 'range'])('rejects an outside text caret from the %s API and measures the touched surface', (api) => {
    const outside = textNodeOf(build('<span>unrelated text</span>'));
    const range = document.createRange();
    range.setStart(outside, 0);
    range.collapse(true);
    const doc = fakeDocument({
      ...(api === 'position' ? { caretPositionFromPoint: () => ({ offsetNode: outside, offset: 0 }) } : { caretRangeFromPoint: () => range }),
      elementFromPoint: () => host.querySelector('p'),
    });
    const trace = vi.fn();
    const restore = installFakeLayout([{ node: text, x0: 100, y0: 50, charWidth: 10, charHeight: 20 }]);
    try {
      expect(caretPositionAtPoint(doc, 137, 60, trace, host)).toEqual({ node: text, offset: 4 });
      expect(trace).toHaveBeenCalledWith(api === 'position' ? 'caretPositionFromPoint' : 'caretRangeFromPoint', expect.objectContaining({ insideRoot: false }));
      expect(trace).toHaveBeenCalledWith('geometry', expect.objectContaining({ resolved: true, insideRoot: true }));
    } finally { restore(); }
  });

  it('tries the legacy API before geometry when the standard API returns outside text', () => {
    const outside = textNodeOf(build('<span>unrelated text</span>'));
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const doc = fakeDocument({
      caretPositionFromPoint: () => ({ offsetNode: outside, offset: 0 }),
      caretRangeFromPoint: () => range,
    });
    expect(caretPositionAtPoint(doc, 137, 60, undefined, host)).toEqual({ node: text, offset: 2 });
  });

  it('keeps geometry inside the surface when both the native hint and hit element are outside', () => {
    const outside = build('<span>unrelated text</span>');
    const doc = fakeDocument({
      caretPositionFromPoint: () => ({ offsetNode: outside, offset: 0 }),
      elementFromPoint: () => outside,
    });
    const restore = installFakeLayout([
      { node: text, x0: 100, y0: 50, charWidth: 10, charHeight: 20 },
      { node: textNodeOf(outside), x0: 100, y0: 50, charWidth: 10, charHeight: 20 },
    ]);
    try {
      expect(caretPositionAtPoint(doc, 137, 60, undefined, host)).toEqual({ node: text, offset: 4 });
    } finally { restore(); }
  });

  it('returns null if the surface cannot be measured instead of accepting outside text', () => {
    const outside = textNodeOf(build('<span>unrelated text</span>'));
    const doc = fakeDocument({ caretPositionFromPoint: () => ({ offsetNode: outside, offset: 0 }) });
    expect(caretPositionAtPoint(doc, 137, 60, undefined, host)).toBeNull();
  });

  it('falls through when caretPositionFromPoint lands on an element rather than text', () => {
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    const doc = fakeDocument({
      caretPositionFromPoint: () => ({ offsetNode: host, offset: 0 }),
      caretRangeFromPoint: () => range,
    });

    expect(caretPositionAtPoint(doc, 10, 20)).toEqual({ node: text, offset: 1 });
  });

  it('rejects an empty text node, where there is no position to hold', () => {
    const empty = document.createTextNode('');
    const doc = fakeDocument({
      caretPositionFromPoint: () => ({ offsetNode: empty, offset: 0 }),
      caretRangeFromPoint: () => {
        const range = document.createRange();
        range.setStart(empty, 0);
        range.collapse(true);
        return range;
      },
    });

    expect(caretPositionAtPoint(doc, 10, 20)).toBeNull();
  });

  it('returns null when the renderer exposes no hit test at all', () => {
    expect(caretPositionAtPoint(fakeDocument({}), 10, 20)).toBeNull();
  });

  it('resolves geometry when the hit test answers with an element instead of text', () => {
    // A finger between two glyphs, or in the whitespace at the end of a line,
    // hit-tests to the PARAGRAPH. Reporting nothing there left a press with no
    // gesture at all, and the platform selection is suppressed on these
    // surfaces — so the student had no way to select that text.
    const paragraph = host.querySelector('p')!;
    const restore = installFakeLayout([{ node: text, x0: 100, y0: 50, charWidth: 10, charHeight: 20 }]);
    const doc = fakeDocument({
      caretPositionFromPoint: () => ({ offsetNode: paragraph, offset: 0 }),
    });

    try {
      expect(caretPositionAtPoint(doc, 133, 60)).toEqual({ node: text, offset: 3 });
    } finally {
      restore();
    }
  });

  it('resolves geometry from the element under the point when no hit test answers', () => {
    const paragraph = host.querySelector('p')!;
    const restore = installFakeLayout([{ node: text, x0: 100, y0: 50, charWidth: 10, charHeight: 20 }]);
    const doc = fakeDocument({ elementFromPoint: () => paragraph });

    try {
      expect(caretPositionAtPoint(doc, 137, 60)).toEqual({ node: text, offset: 4 });
    } finally {
      restore();
    }
  });

  it('traces null and element caret answers before the geometry fallback', () => {
    const paragraph = host.querySelector('p')!;
    const restore = installFakeLayout([{ node: text, x0: 100, y0: 50, charWidth: 10, charHeight: 20 }]);
    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.collapse(true);
    const trace = vi.fn();
    try {
      const point = caretPositionAtPoint(fakeDocument({
        caretPositionFromPoint: () => null,
        caretRangeFromPoint: () => range,
      }), 137, 60, trace);
      expect(point).toEqual({ node: text, offset: 4 });
      expect(trace.mock.calls.map(([stage]) => stage)).toEqual(['caretPositionFromPoint', 'caretRangeFromPoint', 'geometry']);
      expect(trace).toHaveBeenCalledWith('caretPositionFromPoint', expect.objectContaining({ nodeType: null }));
      expect(trace).toHaveBeenCalledWith('caretRangeFromPoint', expect.objectContaining({ nodeType: 1 }));
      expect(trace).toHaveBeenCalledWith('geometry', expect.objectContaining({ resolved: true, offset: 4 }));
    } finally { restore(); }
  });

  it('still prefers the range hit test over geometry', () => {
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const doc = fakeDocument({
      caretPositionFromPoint: () => ({ offsetNode: host, offset: 0 }),
      caretRangeFromPoint: () => range,
      elementFromPoint: () => host,
    });
    const restore = installFakeLayout([{ node: text, x0: 100, y0: 50, charWidth: 10, charHeight: 20 }]);

    try {
      expect(caretPositionAtPoint(doc, 133, 60)).toEqual({ node: text, offset: 2 });
    } finally {
      restore();
    }
  });

  it('reports nothing rather than a guess when the text cannot be measured', () => {
    // No layout at all, as in a renderer that measures nothing: an offset picked
    // out of thin air would anchor an annotation over the wrong words.
    const paragraph = host.querySelector('p')!;
    const doc = fakeDocument({
      caretPositionFromPoint: () => ({ offsetNode: paragraph, offset: 0 }),
      elementFromPoint: () => paragraph,
    });

    expect(caretPositionAtPoint(doc, 133, 60)).toBeNull();
  });
});

describe('nearestTextPointIn', () => {
  it('takes the character under the point, on the near side of its midpoint', () => {
    const host = build('<p>alpha beta gamma</p>');
    const text = textNodeOf(host.querySelector('p')!);
    const restore = installFakeLayout([{ node: text, x0: 100, y0: 50, charWidth: 10, charHeight: 20 }]);

    try {
      // Index 3 spans 130–140 with its midpoint at 135.
      expect(nearestTextPointIn(host, 133, 60)).toEqual({ node: text, offset: 3 });
      expect(nearestTextPointIn(host, 137, 60)).toEqual({ node: text, offset: 4 });
    } finally {
      restore();
    }
  });

  it('follows the wrap onto a later line', () => {
    const host = build('<p>abcdefghijkl</p>');
    const text = textNodeOf(host.querySelector('p')!);
    const restore = installFakeLayout([
      { node: text, x0: 0, y0: 0, charWidth: 10, charHeight: 20, perLine: 4 },
    ]);

    try {
      // Character 9 starts the third line at x 10, y 40.
      expect(nearestTextPointIn(host, 12, 50)).toEqual({ node: text, offset: 9 });
    } finally {
      restore();
    }
  });

  it('picks the nearer of two rendered runs', () => {
    const host = build('<p id="one">first run</p><p id="two">second run</p>');
    const first = textNodeOf(host.querySelector('#one')!);
    const second = textNodeOf(host.querySelector('#two')!);
    const restore = installFakeLayout([
      { node: first, x0: 0, y0: 0, charWidth: 10, charHeight: 20 },
      { node: second, x0: 0, y0: 40, charWidth: 10, charHeight: 20 },
    ]);

    try {
      expect(nearestTextPointIn(host, 25, 45)).toEqual({ node: second, offset: 3 });
      expect(nearestTextPointIn(host, 25, 5)).toEqual({ node: first, offset: 3 });
    } finally {
      restore();
    }
  });

  it('passes over a run that renders nothing for one that can be measured', () => {
    const host = build('<p><span id="blank">unmeasured</span><span id="real">real text</span></p>');
    const real = textNodeOf(host.querySelector('#real')!);
    const restore = installFakeLayout([{ node: real, x0: 0, y0: 0, charWidth: 10, charHeight: 20 }]);

    try {
      expect(nearestTextPointIn(host, 2, 5)).toEqual({ node: real, offset: 0 });
    } finally {
      restore();
    }
  });

  it('reports nothing for an element with no text', () => {
    const host = build('<p><img alt="" /></p>');

    expect(nearestTextPointIn(host, 5, 5)).toBeNull();
  });
});

describe('expandToWordAt', () => {
  const segmenter: WordSegmenter = {
    *segment(text: string) {
      let start = 0;
      for (const part of text.split(/(\s+)/)) {
        if (part.length > 0) yield { start, end: start + part.length, isWordLike: !/^\s+$/.test(part) };
        start += part.length;
      }
    },
  };

  it('returns the word the offset sits inside', () => {
    const node = document.createTextNode('hello world');

    expect(expandToWordAt({ node, offset: 8 }, segmenter)).toEqual({ start: 6, end: 11 });
  });

  it('picks the word ending exactly at the offset, as a press just past a word does', () => {
    const node = document.createTextNode('hello world');

    expect(expandToWordAt({ node, offset: 5 }, segmenter)).toEqual({ start: 0, end: 5 });
  });

  it('picks the word starting at the offset when nothing precedes it', () => {
    const node = document.createTextNode(' hi');

    expect(expandToWordAt({ node, offset: 1 }, segmenter)).toEqual({ start: 1, end: 3 });
  });

  it('takes the word a press inside a gap follows, not the one it precedes', () => {
    // Two spaces, so the offset below falls INSIDE the gap rather than on the
    // first character of the next word — that boundary belongs to the
    // press-inside-a-word rule, which claims the following word.
    const node = document.createTextNode('A  tree');

    expect(expandToWordAt({ node, offset: 2 }, segmenter)).toEqual({ start: 0, end: 1 });
  });

  it('returns null when no word-like run is reachable', () => {
    const node = document.createTextNode('   ');

    expect(expandToWordAt({ node, offset: 1 }, segmenter)).toBeNull();
  });

  it('falls back to unicode word characters when no segmenter is available', () => {
    const node = document.createTextNode('hello world');

    expect(expandToWordAt({ node, offset: 8 }, null)).toEqual({ start: 6, end: 11 });
  });
});
