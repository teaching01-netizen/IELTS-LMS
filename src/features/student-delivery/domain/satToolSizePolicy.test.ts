import { describe, expect, it } from 'vitest';
import {
  resolveSatReferenceDefaultGeometry,
  resolveSatToolMaxSize,
  resolveSatToolMinSize,
  resolveSatToolSize,
  resolveSatToolSizePolicy,
} from './satToolSizePolicy';

describe('satToolSizePolicy', () => {
  it.each([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])('keeps Reference window limits physical at Display %s', (scale) => {
    const min = resolveSatToolMinSize('reference', scale);
    const max = resolveSatToolMaxSize('reference', { w: 2500 / scale, h: 1800 / scale }, scale);
    expect(min.w * scale).toBeCloseTo(700);
    expect(min.h * scale).toBeCloseTo(477);
    expect(max.w * scale).toBeCloseTo(920);
    const def = resolveSatReferenceDefaultGeometry({ w: 1800 / scale, h: 1400 / scale }, { top: 112, bottom: 86, left: 16, right: 16 }, 44 / scale, scale);
    expect(def.w * scale).toBeLessThanOrEqual(920);
    expect(def.w * scale).toBeGreaterThan(920 - scale);
    if (scale === 0.5) expect(def.w).toBeGreaterThan(920);
  });
  it('resolves the smallest-useful first-open defaults per tool and mode', () => {
    expect(resolveSatToolSize('reference')).toEqual({ w: 700, h: 477 });
    expect(resolveSatToolSize('calculator', 'scientific')).toEqual({ w: 460, h: 560 });
    expect(resolveSatToolSize('calculator', 'graphing')).toEqual({ w: 520, h: 640 });
  });

  it('resolves minimum useful sizes (readable Reference minimum)', () => {
    expect(resolveSatToolMinSize('reference')).toEqual({ w: 700, h: 477 });
    expect(resolveSatToolMinSize('calculator')).toEqual({ w: 400, h: 480 });
  });

  it('caps the max width at min(620, floor(safeW * 0.48))', () => {
    expect(resolveSatToolMaxSize('calculator', { w: 1248, h: 634 })).toEqual({ w: 599, h: 634 });
  });

  it('gives Reference its own max (R-06 B1): full safe width up to the 920 default cap', () => {
    expect(resolveSatToolMaxSize('reference', { w: 1248, h: 602 })).toEqual({ w: 920, h: 602 });
    expect(resolveSatToolMaxSize('reference', { w: 2000, h: 900 })).toEqual({ w: 920, h: 900 });
  });

  it('holds min <= default <= max for Reference at every viewport 640..1920 (R-06 B1 invariant)', () => {
    const chrome = { top: 112, right: 16, bottom: 86, left: 16 };
    for (let vw = 640; vw <= 1920; vw += 32) {
      const vh = 800;
      const viewport = { w: vw, h: vh };
      const def = resolveSatReferenceDefaultGeometry(viewport, chrome);
      const min = resolveSatToolMinSize('reference');
      const max = resolveSatToolMaxSize('reference', {
        w: vw - chrome.left - chrome.right,
        h: vh - chrome.top - chrome.bottom,
      });
      expect(def.w).toBeGreaterThanOrEqual(min.w);
      expect(def.w).toBeLessThanOrEqual(max.w);
      expect(def.h).toBeGreaterThanOrEqual(min.h);
      expect(def.h).toBeLessThanOrEqual(max.h);
    }
  });

  it('floors the max at the tool minimum on tiny safe areas (D3 Reference minimum)', () => {
    expect(resolveSatToolMaxSize('reference', { w: 100, h: 100 })).toEqual({ w: 700, h: 477 });
  });

  it('uses the full safe height for the max (fraction 1)', () => {
    expect(resolveSatToolSizePolicy('calculator').maxHeightFraction).toBe(1);
    expect(resolveSatToolMaxSize('calculator', { w: 1248, h: 500 }).h).toBe(500);
  });

  it('pins Calculator rows byte-identical under the D3 Reference override', () => {
    expect(resolveSatToolSizePolicy('calculator', 'scientific')).toEqual({
      default: { w: 460, h: 560 },
      min: { w: 400, h: 480 },
      maxWidthFraction: 0.48,
      maxWidthCap: 620,
      maxHeightFraction: 1,
    });
    expect(resolveSatToolSizePolicy('calculator', 'graphing')).toEqual({
      default: { w: 520, h: 640 },
      min: { w: 400, h: 480 },
      maxWidthFraction: 0.48,
      maxWidthCap: 620,
      maxHeightFraction: 1,
    });
  });

  it('resolves the fit-all Reference default at 1280x800 standard chrome (cap binds)', () => {
    expect(
      resolveSatReferenceDefaultGeometry({ w: 1280, h: 800 }, { top: 112, right: 16, bottom: 86, left: 16 }),
    ).toEqual({ w: 920, h: 601 });
  });

  it('resolves the keeps the readable minimum on a narrow viewport', () => {
    expect(
      resolveSatReferenceDefaultGeometry({ w: 768, h: 528 }, { top: 40, right: 51, bottom: 30, left: 51 }),
    ).toEqual({ w: 700, h: 477 });
  });

  it('shrinks width first on a short landscape viewport (R-06 B3 fit-all priority)', () => {
    expect(
      resolveSatReferenceDefaultGeometry({ w: 844, h: 390 }, { top: 112, right: 16, bottom: 70, left: 16 }),
    ).toEqual({ w: 700, h: 477 });
  });

  it('accepts scrolling when narrowing would violate the readable minimum', () => {
    expect(
      resolveSatReferenceDefaultGeometry({ w: 1000, h: 560 }, { top: 112, right: 16, bottom: 70, left: 16 }),
    ).toEqual({ w: 700, h: 477 });
  });

  it('floors degenerate viewports at the D3 Reference minimum', () => {
    expect(
      resolveSatReferenceDefaultGeometry({ w: 300, h: 300 }, { top: 112, right: 16, bottom: 86, left: 16 }),
    ).toEqual({ w: 700, h: 477 });
  });
});
