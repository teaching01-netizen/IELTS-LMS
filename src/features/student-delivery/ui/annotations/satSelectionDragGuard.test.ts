import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSatGestureOrigin,
  clearSatSelectionGesture,
  isSatDragRelease,
  isSatSelectionGestureEcho,
  markSatPointerDown,
  markSatSelectionGestureEnded,
  SAT_SELECTION_GUARD_MS,
  SAT_TAP_SLOP_PX,
} from './satSelectionDragGuard';

beforeEach(() => {
  clearSatSelectionGesture();
  clearSatGestureOrigin();
});

describe('satSelectionDragGuard', () => {
  it('treats nothing as an echo before a selection gesture', () => {
    expect(isSatSelectionGestureEcho(1000)).toBe(false);
  });

  it('treats a click inside the guard window as the tail of a selection drag', () => {
    markSatSelectionGestureEnded(1000);
    expect(isSatSelectionGestureEcho(1000)).toBe(true);
    expect(isSatSelectionGestureEcho(1000 + SAT_SELECTION_GUARD_MS - 1)).toBe(true);
  });

  it('lets a deliberate click through once the window closes', () => {
    markSatSelectionGestureEnded(1000);
    expect(isSatSelectionGestureEcho(1000 + SAT_SELECTION_GUARD_MS)).toBe(false);
    expect(isSatSelectionGestureEcho(9000)).toBe(false);
  });

  it('can be cleared (attempt teardown)', () => {
    markSatSelectionGestureEnded(1000);
    clearSatSelectionGesture();
    expect(isSatSelectionGestureEcho(1000)).toBe(false);
  });
});

describe('tap versus drag on annotated text', () => {
  it('reads an unmoved release as a tap', () => {
    markSatPointerDown(40, 100);
    expect(isSatDragRelease(40, 100)).toBe(false);
    expect(isSatDragRelease(40 + SAT_TAP_SLOP_PX, 100)).toBe(false);
  });

  it('reads a release beyond the slop as a drag', () => {
    markSatPointerDown(40, 100);
    expect(isSatDragRelease(40 + SAT_TAP_SLOP_PX + 1, 100)).toBe(true);
    expect(isSatDragRelease(120, 100)).toBe(true);
    expect(isSatDragRelease(40, 160)).toBe(true);
  });

  it('reads an activation with no recorded origin as a tap, never swallowing it', () => {
    expect(isSatDragRelease(500, 500)).toBe(false);
    markSatPointerDown(0, 0);
    clearSatGestureOrigin();
    expect(isSatDragRelease(500, 500)).toBe(false);
  });
});
