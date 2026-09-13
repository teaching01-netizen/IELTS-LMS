import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * R-01 Step 9 (Addendum A, binding): measured content-box width signal for
 * the Reference sheet frame.
 *
 * Contract (frozen for Wave 2 — R-04 applies, R-02 consumes, nobody edits;
 * R-06 B4 refines the measure only):
 * - Signature: useSatReferenceViewportWidth(ref: RefObject<HTMLElement | null>): number
 * - clientWidth (content-box, scrollbar-excluded) preferred, rect fallback.
 * - ResizeObserver content-box updates when the element exists; updates run
 *   in the observer phase so transformed content follows before paint.
 * - Layout-effect measure on mount so the first paint carries a real size.
 * - A caller-provided proportional seed may cover the pre-ref render.
 * - Fallback 1000 (the canonical document width) when the element is
 *   missing, unmounted, or SSR (no window). Never returns 0 or NaN —
 *   non-finite / non-positive measurements fall back to 1000 (or the last
 *   good width when one exists).
 * - No panel edit here, no document measurement in R-02: R-04 applies this
 *   hook to the panel scroll node and passes `viewportWidth` to the
 *   document; R-02 consumes the prop with its own 1000 default.
 *
 * R-07 (reference fit-box, additive only): the stage's content-box HEIGHT
 * joins the contract via useSatReferenceStageSize(ref): { w, h, measured } —
 * same ResizeObserver discipline, clientWidth/clientHeight preferred with a
 * per-axis rect fallback, then the per-axis { 1000, 560 } fallback; never
 * 0/NaN (update ticks keep the last good value per axis, so a collapsed or
 * detached node never poisons the size). useSatReferenceViewportWidth stays
 * as a thin wrapper returning .w, so existing call sites and tests pass
 * unchanged.
 */

/** Canonical Reference document width: the safe fallback everywhere. */
export const SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH = 1000;

/** R-07: canonical Reference document height: the per-axis fallback for h. */
export const SAT_REFERENCE_VIEWPORT_FALLBACK_HEIGHT = 560;

/** R-07: measured Reference stage size (content-box CSS px, never 0/NaN). */
export interface SatReferenceStageSize {
  w: number;
  h: number;
  /** True only after at least one positive DOM measurement. */
  measured: boolean;
}

/**
 * R-06 B4 (extended to both axes in R-07): prefer content-box clientWidth /
 * clientHeight (scrollbar-excluded) over the border-box rect
 * (scrollbar-included): rect-width over-scales the fit ratio whenever the
 * vertical scrollbar is present and crops the doc edge. Falls back per axis
 * to the rect dimension, then null (the caller falls back per axis to
 * { 1000, 560 } on mount or keeps the last good value on updates).
 */
function readContentBoxSize(node: HTMLElement | null): {
  w: number | null;
  h: number | null;
} {
  if (!node) return { w: null, h: null };
  let w: number | null = null;
  let h: number | null = null;
  try {
    const clientWidth = node.clientWidth;
    if (typeof clientWidth === "number" && Number.isFinite(clientWidth) && clientWidth > 0) {
      w = clientWidth;
    }
  } catch {
    /* A hostile DOM must never break the exam; fall through to rect. */
  }
  try {
    const clientHeight = node.clientHeight;
    if (typeof clientHeight === "number" && Number.isFinite(clientHeight) && clientHeight > 0) {
      h = clientHeight;
    }
  } catch {
    /* A hostile DOM must never break the exam; fall through to rect. */
  }
  if (w === null || h === null) {
    try {
      const rect = node.getBoundingClientRect();
      if (w === null && typeof rect.width === "number" && Number.isFinite(rect.width) && rect.width > 0) {
        w = rect.width;
      }
      if (h === null && typeof rect.height === "number" && Number.isFinite(rect.height) && rect.height > 0) {
        h = rect.height;
      }
    } catch {
      /* A hostile DOM must never break the exam; fall through to null. */
    }
  }
  return { w, h };
}

function fallbackStageSize(seed?: Partial<Pick<SatReferenceStageSize, "w" | "h">>): SatReferenceStageSize {
  return {
    w:
      typeof seed?.w === "number" && Number.isFinite(seed.w) && seed.w > 0
        ? seed.w
        : SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH,
    h:
      typeof seed?.h === "number" && Number.isFinite(seed.h) && seed.h > 0
        ? seed.h
        : SAT_REFERENCE_VIEWPORT_FALLBACK_HEIGHT,
    measured: false,
  };
}

function sanitizeStageSize(size: SatReferenceStageSize): SatReferenceStageSize {
  const w =
    typeof size.w === "number" && Number.isFinite(size.w) && size.w > 0
      ? size.w
      : SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH;
  const h =
    typeof size.h === "number" && Number.isFinite(size.h) && size.h > 0
      ? size.h
      : SAT_REFERENCE_VIEWPORT_FALLBACK_HEIGHT;
  return { w, h, measured: size.measured === true };
}

export function useSatReferenceStageSize(
  ref: RefObject<HTMLElement | null>,
  seed?: Partial<Pick<SatReferenceStageSize, "w" | "h">>,
): SatReferenceStageSize {
  const [size, setSize] = useState<SatReferenceStageSize>(() => {
    const fallback = fallbackStageSize(seed);
    if (typeof window === "undefined") return fallback;
    const measured = readContentBoxSize(ref.current ?? null);
    return {
      w: measured.w ?? fallback.w,
      h: measured.h ?? fallback.h,
      measured: measured.w !== null || measured.h !== null,
    };
  });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof window === "undefined") return;
    // Sync-measure on mount: the first commit after mount already reflects
    // the live content-box size instead of waiting for an observer tick.
    // Per-axis merge: a partially readable node still commits its good axis.
    const initial = readContentBoxSize(node);
    if (initial.w !== null || initial.h !== null) {
      setSize((prev) => {
        const w = initial.w ?? prev.w;
        const h = initial.h ?? prev.h;
        return w === prev.w && h === prev.h && prev.measured
          ? prev
          : { w, h, measured: true };
      });
    }
    if (typeof ResizeObserver === "undefined") return;
    let disposed = false;
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      // ResizeObserver already runs after layout and before paint. Updating
      // directly here lets the fixed canvas follow a window resize without
      // adding an avoidable requestAnimationFrame of visual lag. This node's
      // dimensions are owned by the window, not by the transformed canvas, so
      // the update cannot create a resize-observer feedback loop.
      const next = readContentBoxSize(ref.current ?? node);
      if (next.w === null && next.h === null) return;
      setSize((prev) => {
        const w = next.w ?? prev.w;
        const h = next.h ?? prev.h;
        return w === prev.w && h === prev.h && prev.measured
          ? prev
          : { w, h, measured: true };
      });
    });
    try {
      observer.observe(node);
    } catch {
      observer.disconnect();
      return;
    }
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [ref]);

  return sanitizeStageSize(size);
}

/**
 * R-07: legacy width-only export kept as a thin wrapper (returns .w) so
 * existing call sites and the R-01 hook suite keep passing unchanged.
 */
export function useSatReferenceViewportWidth(
  ref: RefObject<HTMLElement | null>,
): number {
  return useSatReferenceStageSize(ref).w;
}
