import { describe, expect, it } from 'vitest';
import {
  clampPointToRange,
  createSelectionRange,
  createSelectionRangeWithin,
  resolveWordRunAcrossNodes,
} from '../engine/selectionRange';
import { selectionRectsFrom } from '../engine/selectionGeometry';

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

describe('createSelectionRange', () => {
  it('spans exactly the two offsets in one text node', () => {
    const host = build('<p>hello world</p>');
    const node = textNodeOf(host.querySelector('p')!);

    const range = createSelectionRange({ node, offset: 0 }, { node, offset: 5 });

    expect(range?.toString()).toBe('hello');
  });

  it('orders a backwards gesture into a forward range', () => {
    const host = build('<p>hello world</p>');
    const node = textNodeOf(host.querySelector('p')!);

    const range = createSelectionRange({ node, offset: 11 }, { node, offset: 6 });

    expect(range?.toString()).toBe('world');
  });

  it('returns null for a collapsed gesture rather than an empty range', () => {
    const host = build('<p>hello</p>');
    const node = textNodeOf(host.querySelector('p')!);

    expect(createSelectionRange({ node, offset: 2 }, { node, offset: 2 })).toBeNull();
  });

  it('spans two text nodes in the same block', () => {
    const host = build('<p>alpha <em>beta</em></p>');
    const block = host.querySelector('p')!;
    const first = textNodeOf(block);
    const second = textNodeOf(block.querySelector('em')!);

    // "alpha " from offset 3 is "ha ", then "bet" of the emphasized run.
    const range = createSelectionRange({ node: first, offset: 3 }, { node: second, offset: 3 });

    expect(range?.toString()).toBe('ha bet');
  });
});

/**
 * The word run when the finger is no longer in the claimed node.
 *
 * An inline element that splits a word and the next paragraph are the same
 * gesture to a student, so both are spelled in whole words: the claim's far side
 * is fixed, and the word the finger reached supplies the moving edge. These
 * cases are stated as node + offsets because that is what decides the side — the
 * boundary the previous version fell through (`eta ga` out of `beta` + `gamma`)
 * came from reading the raw offsets instead.
 */
describe('resolveWordRunAcrossNodes', () => {
  const nodes = (html: string) => {
    const host = build(html);
    const [first, second] = Array.from(host.querySelectorAll('p')).map(textNodeOf) as [Text, Text];
    return { first: first!, second: second! };
  };

  it('fixes the claim\u2019s start and ends on the whole word the finger reached after it', () => {
    const { first, second } = nodes('<p>alpha beta</p><p>gamma delta</p>');

    // `beta` is 6\u201310 in the first node; the finger is inside `gamma` (0\u20135).
    const run = resolveWordRunAcrossNodes({ node: first, start: 6, end: 10 }, { node: second, start: 0, end: 5 });

    expect(run.side).toBe('after');
    expect(run.fixed).toEqual({ node: first, offset: 6 });
    expect(run.moving).toEqual({ node: second, offset: 5 });
    // The claim's WHOLE word and the target's whole word, with the story's text
    // between them: the same paint that used to come back as `eta` + `ga`.
    expect(createSelectionRange(run.fixed, run.moving)?.toString()).toBe('betagamma');
  });

  it('fixes the claim\u2019s end and starts on the whole word the finger reached before it', () => {
    const { first, second } = nodes('<p>alpha beta</p><p>gamma delta</p>');

    const run = resolveWordRunAcrossNodes({ node: second, start: 0, end: 5 }, { node: first, start: 6, end: 10 });

    expect(run.side).toBe('before');
    expect(run.fixed).toEqual({ node: second, offset: 5 });
    expect(run.moving).toEqual({ node: first, offset: 6 });
  });

  it('keeps the claim when the reached node holds no word at all', () => {
    const host = build('<p>alpha beta</p><span>   </span>');
    const first = textNodeOf(host.querySelector('p')!);
    const blank = textNodeOf(host.querySelector('span')!);

    const run = resolveWordRunAcrossNodes({ node: first, start: 6, end: 10 }, null);

    expect(run.side).toBe('unchanged');
    expect(run.fixed).toEqual({ node: first, offset: 6 });
    expect(run.moving).toEqual({ node: first, offset: 10 });
    // A node in another document cannot describe a span to the claim either: the
    // position is not "nearby", it is unrelated.
    expect(resolveWordRunAcrossNodes({ node: first, start: 6, end: 10 }, { node: blank, start: 0, end: 0 }).side)
      .toBe('after');
    const orphan = document.createTextNode('gamma');
    expect(resolveWordRunAcrossNodes({ node: first, start: 6, end: 10 }, { node: orphan, start: 0, end: 5 }).side)
      .toBe('unchanged');
  });
});

describe('createSelectionRangeWithin', () => {
  it('clamps a gesture that runs past the boundary back into it', () => {
    const host = build('<p id="block">inside</p><p id="other">outside</p>');
    const block = host.querySelector('#block')!;
    const outside = textNodeOf(host.querySelector('#other')!);
    const inside = textNodeOf(block);

    const range = createSelectionRangeWithin(block, { node: inside, offset: 0 }, {
      node: outside,
      offset: 3,
    });

    expect(range?.toString()).toBe('inside');
  });

  it('clamps a gesture that started before the boundary', () => {
    const host = build('<p id="other">outside</p><p id="block">inside</p>');
    const block = host.querySelector('#block')!;
    const outside = textNodeOf(host.querySelector('#other')!);
    const inside = textNodeOf(block);

    const range = createSelectionRangeWithin(block, { node: outside, offset: 2 }, {
      node: inside,
      offset: 4,
    });

    expect(range?.toString()).toBe('insi');
  });

  it('returns null when the boundary cannot hold a selection at all', () => {
    const host = build('<p id="block"><img alt="" /></p><p id="other">outside</p>');
    const block = host.querySelector('#block')!;
    const outside = textNodeOf(host.querySelector('#other')!);

    expect(
      createSelectionRangeWithin(block, { node: outside, offset: 0 }, { node: outside, offset: 3 }),
    ).toBeNull();
  });
});

/**
 * The caret the lens magnifies and the range the student sees are two views of
 * one selection, so a caret outside the range would describe a span that does
 * not exist.
 */
describe('clampPointToRange', () => {
  function span(start: number, end: number): { node: Text; range: Range } {
    const node = textNodeOf(build('<p>alpha beta gamma</p>'));
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return { node, range };
  }

  it('pulls a position past either end into the span', () => {
    const { node, range } = span(6, 10);

    expect(clampPointToRange({ node, offset: 14 }, range)).toEqual({ node, offset: 10 });
    expect(clampPointToRange({ node, offset: 1 }, range)).toEqual({ node, offset: 6 });
  });

  it('leaves a position already in the span exactly as it was', () => {
    const { node, range } = span(6, 10);
    const inside = { node, offset: 8 };

    expect(clampPointToRange(inside, range)).toBe(inside);
    // The span's own boundaries count as inside: a caret at the run's start is
    // the run's start, not a position to be moved.
    expect(clampPointToRange({ node, offset: 6 }, range)).toEqual({ node, offset: 6 });
    expect(clampPointToRange({ node, offset: 10 }, range)).toEqual({ node, offset: 10 });
  });

  it('leaves a position in another node alone, because there is no span between them', () => {
    const host = build('<p>alpha beta</p><p>gamma delta</p>');
    const [first, second] = Array.from(host.querySelectorAll('p')).map(textNodeOf);
    const range = document.createRange();
    range.setStart(first!, 0);
    range.setEnd(first!, 5);
    const elsewhere = { node: second!, offset: 3 };

    expect(clampPointToRange(elsewhere, range)).toBe(elsewhere);
  });

  it('pulls a position in a span\u2019s own end node back onto its end', () => {
    const host = build('<p>alpha beta</p><p>gamma delta</p>');
    const [first, second] = Array.from(host.querySelectorAll('p')).map(textNodeOf);
    // The run of a body drag that left the claimed node: `beta` from its start
    // (the claim's far side is fixed) through the whole of `gamma`.
    const range = createSelectionRange({ node: first!, offset: 6 }, { node: second!, offset: 5 })!;

    // Inside the run: handed back as the very same point, so the loupe magnifies
    // the character the finger is on while the highlight covers whole words.
    const inside = { node: second!, offset: 2 };
    expect(clampPointToRange(inside, range)).toBe(inside);
    // Past its end: pulled to the end, which is the last character the student
    // can see selected.
    expect(clampPointToRange({ node: second!, offset: 9 }, range)).toEqual({ node: second!, offset: 5 });
    // And the other end by symmetry: a finger in the claim's node cannot point
    // at a character before the run's start.
    expect(clampPointToRange({ node: first!, offset: 1 }, range)).toEqual({ node: first!, offset: 6 });
    expect(clampPointToRange({ node: first!, offset: 8 }, range)).toEqual({ node: first!, offset: 8 });
  });
});

describe('selectionRectsFrom', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height }) as DOMRect;

  function rangeWith(rects: DOMRect[]): Range {
    return { getClientRects: () => rects } as unknown as Range;
  }

  it('merges fragments that share a rendered line', () => {
    const rects = selectionRectsFrom(
      rangeWith([rect(10, 100, 20, 18), rect(30, 100, 25, 18), rect(10, 120, 40, 18)]),
    );

    expect(rects).toEqual([
      { left: 10, top: 100, width: 45, height: 18 },
      { left: 10, top: 120, width: 40, height: 18 },
    ]);
  });

  it('drops zero-sized fragments, which paint nothing', () => {
    expect(selectionRectsFrom(rangeWith([rect(10, 100, 0, 0), rect(10, 100, 12, 18)]))).toEqual([
      { left: 10, top: 100, width: 12, height: 18 },
    ]);
  });

  it('returns an empty list for a missing range or a renderer with no measurement', () => {
    expect(selectionRectsFrom(null)).toEqual([]);
    expect(selectionRectsFrom({} as unknown as Range)).toEqual([]);
  });
});
