/**
 * SAT floating-tool size policy (tool-window system, Phase 02).
 *
 * Pure domain module: plain numbers in, plain numbers out. No React, no DOM,
 * no storage — importable from panels, the placement brain, and unit tests
 * without jsdom. Storage adapters stay in infrastructure/.
 *
 * Smallest-useful defaults: tools open at their minimum useful size, never at
 * maximum comfortable size, and every size is bounded by the safe area derived
 * from the exam chrome (header/footer), never by the raw viewport.
 *
 * Requirement-14 note: Scientific (460x560) and Graphing (520x640) are FIRST
 * OPEN defaults only. Switching modes preserves the current geometry — the
 * window never resizes on mode switch. Phase 03 consumes
 * resolveSatToolSize exactly this way.
 *
 * D3 Reference override (R-04): Reference rows below are the overall-plan D3
 * ruling (spec wins over shipped: defaultWidth = min(920, vw-96), min
 * 480x320 — the brief screenshot math 666x458 at 768x528 only reproduces
 * with these numbers). R-06 fit-all: first-open height is
 * 32 + toolbar + ceil(560 * w/1000), shrinking w first when short.
 * Reference-scoped ONLY: Calculator rows, the shared
 * maxWidthFraction/Cap + maxHeightFraction constants, and every Calculator
 * test expectation stay byte-identical.
 */

import type { SatSafeArea, SatViewport } from './satToolPlacement';

export type SatToolKind = "calculator" | "reference";
export type SatToolMode = "scientific" | "graphing";

export interface SatToolSize {
  w: number;
  h: number;
}

export interface SatToolSizePolicy {
  /** First-open size for the tool (and mode). */
  default: SatToolSize;
  /** Minimum useful size; the window never shrinks below this. */
  min: SatToolSize;
  /** Max width is this fraction of the safe-area width ... */
  maxWidthFraction: number;
  /** ... capped at this absolute width. */
  maxWidthCap: number;
  /** Max height as a fraction of the safe-area height (1 = full safe height). */
  maxHeightFraction: number;
}

const SAT_TOOL_MAX_WIDTH_FRACTION = 0.48;
const SAT_TOOL_MAX_WIDTH_CAP = 620;
const SAT_TOOL_MAX_HEIGHT_FRACTION = 1;

/** D3 Reference default width: min(920, vw - 96). Calculator untouched. */
const SAT_REFERENCE_DEFAULT_WIDTH_CAP = 920;
const SAT_REFERENCE_DEFAULT_WIDTH_MARGIN = 96;
/**
 * R-06 B1 — Reference-only max (D1): the shared 0.48/620 row always sits
 * below the D3 default (920 vs ~599 at 1280px), so the first resize
 * snapped narrower. Reference allows the full safe width up to the 920
 * default cap; Calculator rows below stay byte-identical.
 */
const SAT_REFERENCE_MAX_WIDTH_FRACTION = 1;
const SAT_REFERENCE_MAX_WIDTH_CAP = 920;
const SAT_REFERENCE_MAX_HEIGHT_FRACTION = 1;
/**
 * R-06 B3 — fit-all chrome budget (pure constants, no DOM): 32px header +
 * 53px zoom toolbar (44px touch target + 8px py-1 + 1px border) + the
 * canonical 1000x560 document scaled by width. Minimal constant form
 * (measure-nicer accepted, constant chosen — see Step 3.1).
 */
export const SAT_REFERENCE_HEADER_HEIGHT = 32;
export const SAT_REFERENCE_TOOLBAR_HEIGHT = 53;
export const SAT_REFERENCE_DOC_W = 1000;
export const SAT_REFERENCE_DOC_H = 560;

const REFERENCE_POLICY: SatToolSizePolicy = {
  // R-04 D3 override (Reference-only): the static no-viewport fallback row is
  // illustrative — the 768px worked example min(920, 768-96) = 672 folded to
  // the safe span (~= 666 after side insets). The panel never uses this row
  // directly; it calls resolveSatReferenceDefaultGeometry below.
  default: { w: 666, h: 500 },
  min: { w: 480, h: 320 },
  maxWidthFraction: SAT_REFERENCE_MAX_WIDTH_FRACTION,
  maxWidthCap: SAT_REFERENCE_MAX_WIDTH_CAP,
  maxHeightFraction: SAT_REFERENCE_MAX_HEIGHT_FRACTION,
};

const CALCULATOR_POLICIES: Record<SatToolMode, SatToolSizePolicy> = {
  scientific: {
    default: { w: 460, h: 560 },
    min: { w: 400, h: 480 },
    maxWidthFraction: SAT_TOOL_MAX_WIDTH_FRACTION,
    maxWidthCap: SAT_TOOL_MAX_WIDTH_CAP,
    maxHeightFraction: SAT_TOOL_MAX_HEIGHT_FRACTION,
  },
  graphing: {
    default: { w: 520, h: 640 },
    min: { w: 400, h: 480 },
    maxWidthFraction: SAT_TOOL_MAX_WIDTH_FRACTION,
    maxWidthCap: SAT_TOOL_MAX_WIDTH_CAP,
    maxHeightFraction: SAT_TOOL_MAX_HEIGHT_FRACTION,
  },
};

/** Policy table lookup. Unknown modes fall back to scientific; the reference tool ignores mode. */
export function resolveSatToolSizePolicy(kind: SatToolKind, mode?: SatToolMode): SatToolSizePolicy {
  if (kind === "calculator") {
    return CALCULATOR_POLICIES[mode === "graphing" ? "graphing" : "scientific"];
  }
  return REFERENCE_POLICY;
}

/** First-open size. Used ONLY at first open for the active mode (see header note). */
export function resolveSatToolSize(kind: SatToolKind, mode?: SatToolMode): SatToolSize {
  const found = resolveSatToolSizePolicy(kind, mode).default;
  return { w: found.w, h: found.h };
}

/** Minimum useful size for the tool. */
export function resolveSatToolMinSize(kind: SatToolKind): SatToolSize {
  const found = resolveSatToolSizePolicy(kind).min;
  return { w: found.w, h: found.h };
}

/**
 * D3 default geometry for first-open Reference (pure numbers in/out — no
 * React, no DOM, no storage; unit-testable without jsdom).
 *
 * R-06 B3 fit-all (Reference-only):
 * need(w) = 32 (header) + toolbar + ceil(560 * w/1000) (scaled document).
 * w0 = min(920, viewport.w - 96), folded to clamp(w0, min.w, max(min.w, safeW))
 * where safeW = viewport.w - safeArea.left - safeArea.right.
 * h = clamp(need(w), min.h, max(min.h, safeH))
 * where safeH = viewport.h - safeArea.top - safeArea.bottom.
 * When safeH < need(w) (short viewport): shrink w first until need fits or
 * w hits min.w (fit-all beats max-wide), then accept scroll.
 * Floored to integers; never below min, never above the safe span (a 0-size
 * safe area yields the min size; the clamp layer keeps it reachable).
 *
 * Worked checks (pinned in satToolSizePolicy.test.ts): 1280x800 standard
 * chrome -> { 920, 601 } (cap binds; 32 + 53 + ceil(560*920/1000) = 601);
 * 768x528 exam viewport -> { 666, 458 } (need(666) = 458 fits safeH 458);
 * 300x300 degenerate -> { 480, 320 } (min floor wins over the safe span).
 */
export function resolveSatReferenceDefaultGeometry(
  viewport: SatViewport,
  safeArea: SatSafeArea,
): SatToolSize {
  const min = resolveSatToolMinSize('reference');
  const safeW = viewport.w - safeArea.left - safeArea.right;
  const safeH = viewport.h - safeArea.top - safeArea.bottom;
  const need = (w: number): number =>
    SAT_REFERENCE_HEADER_HEIGHT +
    SAT_REFERENCE_TOOLBAR_HEIGHT +
    Math.ceil((SAT_REFERENCE_DOC_H * w) / SAT_REFERENCE_DOC_W);
  const maxSafeW = Math.max(min.w, safeW);
  let w = Math.floor(Math.min(Math.max(Math.min(SAT_REFERENCE_DEFAULT_WIDTH_CAP, viewport.w - SAT_REFERENCE_DEFAULT_WIDTH_MARGIN), min.w), maxSafeW));
  const maxSafeH = Math.max(min.h, safeH);
  // Short viewport: shrink width first until the need fits (fit-all
  // priority), stopping at min.w; scroll is accepted only then.
  while (w > min.w && need(w) > maxSafeH) {
    w -= 1;
  }
  const h = Math.floor(Math.min(Math.max(need(w), min.h), maxSafeH));
  return { w, h };
}

/**
 * Viewport-relative maximum for the tool inside the given safe area:
 * width = min(cap, floor(safeW * fraction)), height = floor(safeH * fraction),
 * each floored at the tool minimum so a tiny safe area still yields the
 * minimum useful size (the clamp layer keeps that window reachable).
 */
export function resolveSatToolMaxSize(kind: SatToolKind, safeArea: SatToolSize): SatToolSize {
  const policy = resolveSatToolSizePolicy(kind);
  const w = Math.min(policy.maxWidthCap, Math.floor(safeArea.w * policy.maxWidthFraction));
  const h = Math.floor(safeArea.h * policy.maxHeightFraction);
  return { w: Math.max(policy.min.w, w), h: Math.max(policy.min.h, h) };
}
