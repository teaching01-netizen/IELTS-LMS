import { describe, expect, it, vi } from 'vitest';
import {
  addHighlightRange,
  captureSurfaceRange,
  captureSurfaceSelection,
  eraseHighlightRange,
  HIGHLIGHT_ENGINE,
  MAX_HIGHLIGHT_RANGES,
  validateHighlightRanges,
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

  it('captures a span from a range the app made, with no browser selection involved', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta gamma</p>';
    const textNode = container.querySelector('p')?.firstChild;
    if (!(textNode instanceof Text)) throw new Error('Expected paragraph text node');
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 10);

    // The owned touch path: exam prose is unselectable on a coarse pointer, so
    // the range is what the app built, and the captured highlight is identical
    // to the one the platform's own selection would have produced.
    expect(captureSurfaceRange(container, range)).toEqual({
      start: 6,
      end: 10,
      selectedText: 'beta',
    });
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it('captures a span that crosses blocks, and refuses one over a control', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha</p><p>beta</p>';
    const [first, second] = Array.from(container.querySelectorAll('p')).map(
      (element) => element.firstChild as Text,
    );
    const acrossBlocks = document.createRange();
    acrossBlocks.setStart(first!, 2);
    acrossBlocks.setEnd(second!, 2);

    // A highlight may span blocks within one surface, and the captured offsets
    // are measured over the surface's text: "pha" then "be".
    expect(captureSurfaceRange(container, acrossBlocks)).toEqual({
      start: 2,
      end: 7,
      selectedText: 'phabe',
    });

    const withField = document.createElement('div');
    withField.innerHTML = '<textarea>Alpha</textarea>';
    const fieldRange = document.createRange();
    fieldRange.setStart(withField.querySelector('textarea')!.firstChild!, 0);
    fieldRange.setEnd(withField.querySelector('textarea')!.firstChild!, 5);

    expect(captureSurfaceRange(withField, fieldRange)).toBeNull();
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

  it('rebuilds ambiguous container-wide ranges from anchor/focus points', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta gamma</p><p>Delta epsilon</p>';
    const textNode = container.querySelector('p')?.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error('Expected first paragraph text node');
    }

    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(container, container.childNodes.length);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
      anchorNode: textNode,
      anchorOffset: 6,
      focusNode: textNode,
      focusOffset: 10,
    } as unknown as Selection;

    const captured = captureSurfaceSelection(container, selection, {
      enforceSingleBlock: true,
    });

    expect(captured).toEqual({
      start: 6,
      end: 10,
      selectedText: 'beta',
    });
  });

  it('normalizes backward anchor/focus direction when rebuilding container-wide ranges', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Alpha beta gamma</p><p>Delta epsilon</p>';
    const textNode = container.querySelector('p')?.firstChild;
    if (!(textNode instanceof Text)) {
      throw new Error('Expected first paragraph text node');
    }

    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(container, container.childNodes.length);

    const selection = {
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => range.toString(),
      anchorNode: textNode,
      anchorOffset: 10,
      focusNode: textNode,
      focusOffset: 6,
    } as unknown as Selection;

    const captured = captureSurfaceSelection(container, selection, {
      enforceSingleBlock: true,
    });

    expect(captured).toEqual({
      start: 6,
      end: 10,
      selectedText: 'beta',
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

  it('exposes the v2 engine flag (S1-C15: no dead V1 remains)', () => {
    expect(HIGHLIGHT_ENGINE).toBe('v2');
    expect(MAX_HIGHLIGHT_RANGES).toBe(200);
  });

  it('validates persisted ranges on load (S1-C11)', () => {
    const text = 'Alpha beta gamma';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const validated = validateHighlightRanges(
      [
        { start: 0, end: 5, color: 'yellow' },
        { start: 6, end: 10, color: 'amber' },
        { start: Number.NaN, end: 4, color: 'yellow' },
        { start: 4, end: 4, color: 'yellow' },
        { start: -1, end: 3, color: 'yellow' },
        { start: 0, end: 999, color: 'yellow' },
        { start: 0, end: 3, color: 'pink' },
        { start: 0, end: 3 },
        null,
        'nope',
      ],
      text,
    );
    expect(validated).toEqual([
      { start: 0, end: 5, color: 'yellow' },
      { start: 6, end: 10, color: 'amber' },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('Dropped 8 invalid');
    warn.mockRestore();
  });

  it('truncates validated ranges to the most recent MAX entries (S1-C11)', () => {
    const text = 'x'.repeat(10);
    const ranges = Array.from({ length: 205 }, (_, index) => ({
      start: 0,
      end: 1,
      color: 'yellow' as const,
      seq: index,
    }));
    const validated = validateHighlightRanges(ranges, text, 200);
    expect(validated).toHaveLength(200);
    expect(validated[0]).toEqual({ start: 0, end: 1, color: 'yellow' });
    expect(validated[199]).toEqual({ start: 0, end: 1, color: 'yellow' });
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
