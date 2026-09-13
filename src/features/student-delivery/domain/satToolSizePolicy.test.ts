import { describe, expect, it } from 'vitest';
import {
  resolveSatReferenceDefaultGeometry,
  resolveSatToolMaxSize,
  resolveSatToolMinSize,
  resolveSatToolSize,
  resolveSatToolSizePolicy,
} from './satToolSizePolicy';

describe('satToolSizePolicy', () => {
  it('resolves the smallest-useful first-open defaults per tool and mode', () => {
    // R-04 D3 override (Reference-only): the static fallback row documents the
    // 768px worked example min(920, 768-96) = 672 folded to the safe span.
    expect(resolveSatToolSize('reference')).toEqual({ w: 666, h: 500 });
    expect(resolveSatToolSize('calculator', 'scientific')).toEqual({ w: 460, h: 560 });
    expect(resolveSatToolSize('calculator', 'graphing')).toEqual({ w: 520, h: 640 });
  });

  it('resolves minimum useful sizes (Reference = D3 480x320)', () => {
    expect(resolveSatToolMinSize('reference')).toEqual({ w: 480, h: 320 });
    expect(resolveSatToolMinSize('calculator')).toEqual({ w: 400, h: 480 });
  });

  it('caps the max width at min(620, floor(safeW * 0.48))', () => {
    // 1280 - 16 - 16 = 1248 safe px: 0.48 * 1248 = 599.04 -> 599 < 620 cap.
    expect(resolveSatToolMaxSize('calculator', { w: 1248, h: 634 })).toEqual({ w: 599, h: 634 });
  });

  it('gives Reference its own max (R-06 B1): full safe width up to the 920 default cap', () => {
    // Reference allows the full safe width (fraction 1) up to 920 so the
    // default-first-open width never exceeds the enforced maximum.
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
    expect(resolveSatToolMaxSize('reference', { w: 100, h: 100 })).toEqual({ w: 480, h: 320 });
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
    // R-06 B3: w = min(920, 1280-96) = 920; need(920) = 32 + 53 +
    // ceil(560*920/1000) = 601; safeH = 800-112-86 = 602 fits -> 601.
    expect(
      resolveSatReferenceDefaultGeometry({ w: 1280, h: 800 }, { top: 112, right: 16, bottom: 86, left: 16 }),
    ).toEqual({ w: 920, h: 601 });
  });

  it('resolves the fit-all Reference default at a 768px exam viewport (brief screenshot math)', () => {
    // Brief derivation: min(920, 768-96) = 672, folded to the safe span
    // 768-51-51 = 666 -> 666; need(666) = 32 + 53 + ceil(560*666/1000) =
    // 32 + 53 + 373 = 458 = safeH (528-40-30) -> 458, no scroll.
    // Reproduces the brief screenshot rect 666x458 at 768x528.
    expect(
      resolveSatReferenceDefaultGeometry({ w: 768, h: 528 }, { top: 40, right: 51, bottom: 30, left: 51 }),
    ).toEqual({ w: 666, h: 458 });
  });

  it('shrinks width first on a short landscape viewport (R-06 B3 fit-all priority)', () => {
    // 844x390 short landscape, 16px side insets + 96/70 chrome:
    // safeW = 812, safeH = 208 < min.h 320 -> h folds to 320; w0 = 748
    // needs 32+53+ceil(560*748/1000) = 504 > 320, so w shrinks to min 480
    // (need(480) = 354 still > 320) and scroll is accepted at the floor.
    expect(
      resolveSatReferenceDefaultGeometry({ w: 844, h: 390 }, { top: 112, right: 16, bottom: 70, left: 16 }),
    ).toEqual({ w: 480, h: 320 });
  });

  it('shrinks (not scrolls) when a modest shortfall fits by narrowing (R-06 B3)', () => {
    // 1000x560 viewport, 16px side insets + 112/70 chrome: safeW = 968,
    // safeH = 378. w0 = min(920, 904) = 904 needs 592 > 378; shrinking to
    // w = 524 gives need = 32+53+ceil(560*524/1000) = 379 > 378, w = 523
    // gives 378 <= 378 -> fits with zero scroll (width traded for height).
    expect(
      resolveSatReferenceDefaultGeometry({ w: 1000, h: 560 }, { top: 112, right: 16, bottom: 70, left: 16 }),
    ).toEqual({ w: 523, h: 378 });
  });

  it('floors degenerate viewports at the D3 Reference minimum', () => {
    // 300x300: raw w = min(920, 204) = 204 < min 480 -> 480; raw h = 500 but
    // safeH = 300-112-86 = 102 < min 320 -> 320. Min floor wins over the safe span.
    expect(
      resolveSatReferenceDefaultGeometry({ w: 300, h: 300 }, { top: 112, right: 16, bottom: 86, left: 16 }),
    ).toEqual({ w: 480, h: 320 });
  });
});
