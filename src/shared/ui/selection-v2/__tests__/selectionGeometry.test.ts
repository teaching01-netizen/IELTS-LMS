import { describe, expect, it } from 'vitest';
import {
  handleGeometryFor,
  mergeSelectionLines,
  selectionAnchorRect,
  selectionDirection,
  selectionHandleGeometry,
  selectionRectsFrom,
} from '../engine/selectionGeometry';
import type { SelectionRect } from '../domain/selectionTypes';

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
