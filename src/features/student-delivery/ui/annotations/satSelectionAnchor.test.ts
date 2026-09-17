import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  satAnnotationAnchorGeometryFor,
  satAnnotationBlockFor,
  satAnnotationLineRects,
  satAnnotationRangeFor,
} from './satSelectionAnchor';

const anchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };

function mountPassage(text: string, region = 'stimulus', nodeId = 'p1'): HTMLElement {
  document.body.innerHTML = `<div data-sat-annotation-region="${region}"><div data-content-text-node="${nodeId}"><span><span>${text}</span></span></div></div>`;
  return document.body.firstElementChild as HTMLElement;
}

/**
 * jsdom has no Range measurement at all, so the test supplies one. Defining it
 * (rather than spying) keeps the production guard `typeof
 * range.getBoundingClientRect === 'function'` meaningful: without this stub the
 * geometry helper correctly reports "cannot measure".
 */
function stubRangeRect(rect: Partial<DOMRect>): void {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: () => ({
      top: 100, bottom: 120, left: 200, right: 320, width: 120, height: 20, x: 200, y: 100,
      toJSON: () => ({}),
      ...rect,
    }),
  });
}

function stubRangeRects(rects: Array<Partial<DOMRect>>): void {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    writable: true,
    value: () => rects as unknown as DOMRectList,
  });
}

function lineRect(top: number, bottom: number, left: number, right: number) {
  return { top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) };
}

afterEach(() => {
  vi.restoreAllMocks();
  // Remove the injected measurement so the "cannot measure" case stays testable.
  delete (Range.prototype as unknown as Record<string, unknown>)['getBoundingClientRect'];
  delete (Range.prototype as unknown as Record<string, unknown>)['getClientRects'];
  document.body.innerHTML = '';
});

describe('satSelectionAnchor: the DOM an anchor names', () => {
  it('resolves the anchored block and rejects anchors the DOM no longer satisfies', () => {
    mountPassage('A tree grows.');
    expect(satAnnotationBlockFor(anchor)).not.toBeNull();
    // Wrong region, wrong node, or a dangling offset all resolve to nothing:
    // the toolbar must never point at a neighbouring passage.
    expect(satAnnotationBlockFor({ ...anchor, nodeId: 'prompt:p1' })).toBeNull();
    expect(satAnnotationBlockFor({ ...anchor, nodeId: 'stimulus:other' })).toBeNull();
    expect(satAnnotationBlockFor({ ...anchor, startOffset: 90, endOffset: 94 })).toBeNull();
  });

  it('builds a range covering exactly the anchored span', () => {
    mountPassage('A tree grows.');
    const range = satAnnotationRangeFor(anchor);
    expect(range?.toString()).toBe('tree');
    // Offsets past the end of the block cannot produce a usable range.
    expect(satAnnotationRangeFor({ ...anchor, startOffset: 0, endOffset: 999 })).toBeNull();
  });

  it('returns null geometry when the engine cannot measure ranges (never a wrong position)', () => {
    mountPassage('A tree grows.');
    delete (Range.prototype as unknown as Record<string, unknown>)['getBoundingClientRect'];
    // jsdom omits Range measurement entirely; the caller falls back to a safe
    // placement rather than guessing.
    expect(satAnnotationAnchorGeometryFor(anchor)).toBeNull();
  });

  it('reads one line per rendered line, merging fragments of the same one', () => {
    const lines = satAnnotationLineRects({
      getClientRects: () =>
        [
          lineRect(100, 120, 10, 200),
          // Same line, a second fragment (an inline mark, a bidi run).
          lineRect(100, 120, 210, 300),
          lineRect(125, 145, 10, 150),
        ] as unknown as DOMRectList,
    } as unknown as Range);
    expect(lines).toEqual([
      { top: 100, bottom: 120, left: 10, right: 300 },
      { top: 125, bottom: 145, left: 10, right: 150 },
    ]);
  });

  it('anchors a wrapped selection to its real first and last lines', () => {
    mountPassage('A tree grows in the yard.');
    stubRangeRect({ top: 100, bottom: 145, left: 10, right: 300, width: 290, height: 45 });
    stubRangeRects([lineRect(100, 120, 10, 300), lineRect(125, 145, 10, 150)]);
    const measured = satAnnotationAnchorGeometryFor(anchor);
    expect(measured?.firstLine).toEqual({ top: 100, bottom: 120, left: 10, right: 300 });
    expect(measured?.lastLine).toEqual({ top: 125, bottom: 145, left: 10, right: 150 });
  });
});
