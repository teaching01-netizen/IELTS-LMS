import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampSatToolGeometry,
  loadSatToolGeometry,
  normalizeSatToolGeometry,
  saveSatToolGeometry,
  satToolGeometryKey,
  satToolGeometryKeyV1,
} from './satToolGeometryStore';

const SAFE = { top: 112, right: 16, bottom: 86, left: 16 };

describe('satToolGeometryStore', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips geometry through a versioned key', () => {
    const key = satToolGeometryKey('s', 'a', 'm', 'calculator');
    // Phase-02 contract change (documented): the key now carries v2. The
    // v marker is a storage concern only - loads still return {x,y,w,h}.
    expect(key).toContain('v2');
    expect(saveSatToolGeometry(key, { x: 100, y: 110, w: 420, h: 520 })).toBe(true);
    expect(loadSatToolGeometry(key)).toEqual({ x: 100, y: 110, w: 420, h: 520 });
  });

  it('stamps saved records v:2', () => {
    const key = satToolGeometryKey('s', 'a', 'm', 'calculator');
    saveSatToolGeometry(key, { x: 100, y: 110, w: 420, h: 520 });
    expect(JSON.parse(localStorage.getItem(key) as string).v).toBe(2);
  });

  it('migrates v1 entries: the v1 key fallback loads and normalize accepts v1 records', () => {
    const v1Key = satToolGeometryKeyV1('s', 'a', 'm', 'calculator');
    const v2Key = satToolGeometryKey('s', 'a', 'm', 'calculator');
    expect(v1Key).toContain('v1');
    // A v1 session record carries no v field.
    localStorage.setItem(v1Key, JSON.stringify({ x: 100, y: 110, w: 420, h: 520 }));
    expect(normalizeSatToolGeometry(JSON.parse(localStorage.getItem(v1Key) as string))).toEqual({
      x: 100,
      y: 110,
      w: 420,
      h: 520,
    });
    // The v2 key misses; the v1 fallback keeps the window position.
    expect(loadSatToolGeometry(v2Key)).toEqual({ x: 100, y: 110, w: 420, h: 520 });
  });

  it('rejects corrupt entries and removes them', () => {
    const key = satToolGeometryKey('s', 'a', 'm', 'reference');
    localStorage.setItem(key, '{not json');
    expect(loadSatToolGeometry(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps the legacy 2-arg clamp byte-compatible (frozen Phase-01 primitive call sites)', () => {
    const clamped = clampSatToolGeometry({ x: 5000, y: 3000, w: 9000, h: 9000 }, { w: 1280, h: 800 });
    expect(clamped.w).toBeLessThanOrEqual(1280 - 32);
    expect(clamped.h).toBeLessThanOrEqual(800 - 32);
    expect(clamped.x).toBeLessThanOrEqual(1280 - 48);
    expect(clamped.y).toBeLessThanOrEqual(800 - 48);
  });

  it('clamps the v2 safe-area form into the exam safe area, not the raw viewport', () => {
    // Phase-02 contract change (documented): the 3-arg clamp folds into the
    // safe area (top = 96 header + 16 inset, sides/bottom = chrome + 16), so
    // the numbers below replace the legacy viewport-margin expectations.
    const clamped = clampSatToolGeometry({ x: 5000, y: 3000, w: 9000, h: 9000 }, { w: 1280, h: 800 }, SAFE);
    // Safe span: x in [16, 1264-1248=16] -> 16; w = min(9000, max(320, 1248)) = 1248.
    expect(clamped.w).toBe(1248);
    // Safe span: y in [112, 714-602=112] -> 112; h = min(9000, max(360, 602)) = 602.
    expect(clamped.h).toBe(602);
    expect(clamped.x).toBe(16);
    expect(clamped.y).toBe(112);
  });

  it('floors shrunken viewports at the tool minimum instead of resetting', () => {
    const clamped = clampSatToolGeometry({ x: 16, y: 112, w: 460, h: 560 }, { w: 300, h: 300 }, SAFE);
    expect(clamped.w).toBe(320);
    expect(clamped.h).toBe(360);
    expect(clamped.x).toBe(16);
    expect(clamped.y).toBe(112);
  });

  it('enforces minimum sizes', () => {
    expect(normalizeSatToolGeometry({ x: 0, y: 0, w: 10, h: 10 })).toMatchObject({ w: 320, h: 360 });
  });
});
