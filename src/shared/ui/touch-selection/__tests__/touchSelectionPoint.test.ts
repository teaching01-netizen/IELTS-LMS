import { describe, expect, it } from 'vitest';
import {
  caretPositionAtPoint,
  clampTextPointTo,
  compareTextPoints,
  expandToWordAt,
  firstTextPointIn,
  lastTextPointIn,
  textPointIsWithin,
  type TextPoint,
  type WordSegmenter,
} from '../touchSelectionPoint';

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
