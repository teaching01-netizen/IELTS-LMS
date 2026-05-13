import { describe, expect, it } from 'vitest';
import {
  addHighlightRange,
  captureSurfaceSelection,
  eraseHighlightRange,
  type HighlightSelectionV2,
} from '../highlightV2Engine';
import type { StudentHighlightColor } from '../highlightPalette';

const YELLOW = 'yellow' as StudentHighlightColor;
const BLUE = 'blue' as StudentHighlightColor;

function selection(start: number, end: number): HighlightSelectionV2 {
  return {
    start,
    end,
    selectedText: 'x',
  };
}

describe('highlight v2 engine', () => {
  it('replaces overlap using latest color and preserves untouched segments', () => {
    const base = [
      { start: 0, end: 10, color: YELLOW },
    ];

    const next = addHighlightRange(base, selection(4, 8), BLUE, 200);

    expect(next.limitReached).toBe(false);
    expect(next.ranges).toEqual([
      { start: 0, end: 4, color: YELLOW },
      { start: 4, end: 8, color: BLUE },
      { start: 8, end: 10, color: YELLOW },
    ]);
  });

  it('merges contiguous ranges of the same color', () => {
    const first = addHighlightRange([], selection(0, 4), YELLOW, 200);
    const second = addHighlightRange(first.ranges, selection(4, 8), YELLOW, 200);

    expect(second.limitReached).toBe(false);
    expect(second.ranges).toEqual([{ start: 0, end: 8, color: YELLOW }]);
  });

  it('erases only the intersecting area and keeps leftovers', () => {
    const base = [
      { start: 0, end: 4, color: YELLOW },
      { start: 6, end: 10, color: BLUE },
    ];

    const erased = eraseHighlightRange(base, selection(3, 7));

    expect(erased).toEqual([
      { start: 0, end: 3, color: YELLOW },
      { start: 7, end: 10, color: BLUE },
    ]);
  });

  it('enforces per-surface range cap', () => {
    const dense = Array.from({ length: 200 }, (_, idx) => ({
      start: idx * 2,
      end: idx * 2 + 1,
      color: YELLOW,
    }));

    const next = addHighlightRange(dense, selection(401, 402), BLUE, 200);

    expect(next.limitReached).toBe(true);
    expect(next.ranges).toEqual(dense);
  });

  it('captures single-block selections when browsers report element-node range boundaries', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta gamma</p>';
    const paragraph = container.querySelector('p');
    if (!paragraph) {
      throw new Error('Expected paragraph element');
    }

    const range = document.createRange();
    range.setStart(paragraph, 0);
    range.setEnd(paragraph, paragraph.childNodes.length);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
    } as unknown as Selection;

    const captured = captureSurfaceSelection(container, selection, {
      enforceSingleBlock: true,
    });

    expect(captured).toEqual({
      start: 0,
      end: 'Alpha beta gamma'.length,
      selectedText: 'Alpha beta gamma',
    });
  });

  it('captures cross-block selections when endpoints stay in the same surface', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta.</p><p>Gamma delta.</p>';
    const firstText = container.querySelector('p')?.firstChild;
    const secondText = container.querySelectorAll('p')?.[1]?.firstChild;
    if (!(firstText instanceof Text) || !(secondText instanceof Text)) {
      throw new Error('Expected paragraph text nodes');
    }

    const range = document.createRange();
    range.setStart(firstText, 6);
    range.setEnd(secondText, 5);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
    } as unknown as Selection;

    const captured = captureSurfaceSelection(container, selection, {
      enforceSingleBlock: true,
    });

    expect(captured).toEqual({
      start: 6,
      end: 16,
      selectedText: 'beta.Gamma',
    });
  });

  it('rejects selections that touch excluded answer controls', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta</p><input value="forbidden" />';

    const paragraphText = container.querySelector('p')?.firstChild;
    const input = container.querySelector('input');
    if (!(paragraphText instanceof Text) || !(input instanceof HTMLInputElement)) {
      throw new Error('Expected paragraph text and input');
    }

    const range = document.createRange();
    range.setStart(paragraphText, 6);
    range.setEnd(input, 0);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => 'beta',
    } as unknown as Selection;

    expect(captureSurfaceSelection(container, selection)).toBeNull();
  });
});
