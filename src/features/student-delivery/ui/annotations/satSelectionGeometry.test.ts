import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  placeSatAnnotationDock,
  placeSatAnnotationToolbar,
  satAnnotationBlockFor,
  satAnnotationRangeFor,
  satAnnotationRectFor,
} from './satSelectionGeometry';

const bounds = { left: 0, top: 0, width: 800, height: 600 };

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

const anchor = { nodeId: 'stimulus:p1', startOffset: 2, endOffset: 6, exact: 'tree' };

afterEach(() => {
  vi.restoreAllMocks();
  // Remove the injected measurement so the "cannot measure" case stays testable.
  delete (Range.prototype as unknown as Record<string, unknown>)['getBoundingClientRect'];
  document.body.innerHTML = '';
});

describe('satSelectionGeometry', () => {
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
    // jsdom omits Range measurement entirely; the caller falls back to a safe
    // placement rather than guessing.
    expect(satAnnotationRectFor(anchor)).toBeNull();
  });

  it('prefers placing the toolbar above the selection and flips below when there is no room', () => {
    mountPassage('A tree grows.');
    stubRangeRect({ top: 300, bottom: 320, left: 200, right: 320, width: 120, height: 20 });
    const above = placeSatAnnotationToolbar(anchor, bounds, { width: 288, height: 108 });
    expect(above?.flipped).toBe(false);
    expect(above?.top).toBeLessThan(300);

    stubRangeRect({ top: 10, bottom: 30, left: 200, right: 320, width: 120, height: 20 });
    const below = placeSatAnnotationToolbar(anchor, bounds, { width: 288, height: 108 });
    expect(below?.flipped).toBe(true);
    expect(below?.top).toBeGreaterThan(30);
  });

  it('clamps the toolbar inside the exam body at both edges', () => {
    mountPassage('A tree grows.');
    stubRangeRect({ top: 300, bottom: 320, left: 0, right: 40, width: 40, height: 20 });
    const left = placeSatAnnotationToolbar(anchor, bounds, { width: 288, height: 108 });
    expect(left!.left).toBeGreaterThanOrEqual(8);

    stubRangeRect({ top: 300, bottom: 320, left: 780, right: 800, width: 20, height: 20 });
    const right = placeSatAnnotationToolbar(anchor, bounds, { width: 288, height: 108 });
    expect(right!.left + 288).toBeLessThanOrEqual(bounds.width - 8 + 0.001);
  });

  it('docks the touch sheet to the bottom of the exam body', () => {
    const placement = placeSatAnnotationDock(bounds, { width: 784, height: 168 });
    expect(placement.left).toBe(8);
    expect(placement.top).toBe(bounds.height - 168 - 8);
    expect(placement.flipped).toBe(false);
  });
});
