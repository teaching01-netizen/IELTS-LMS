import { describe, expect, it } from 'vitest';
import { createSelectionRange, createSelectionRangeWithin } from '../engine/selectionRange';
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
