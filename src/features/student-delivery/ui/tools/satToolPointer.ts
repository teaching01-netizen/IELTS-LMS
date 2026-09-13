/**
 * Phase 07 pointer geometry helpers (pure, no React or DOM).
 * Threshold, resize math, and release assist live here so unit tests
 * can prove 1:1 tracking without mounting a window.
 *
 * All distances are plain numbers in CSS pixels. Durations live in CSS
 * tokens consumed through classes, never here.
 */
import type { SatToolGeometry } from "../../infrastructure/satToolGeometryStore";

export type SatResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Pointer must travel at least this far before a drag goes live. */
export const SAT_DRAG_THRESHOLD_PX = 4;

/** Release assist radius and max correction, applied to left and top only. */
export const SAT_TOOL_ALIGN_PX = 8;

export interface SatToolMinSize {
  w: number;
  h: number;
}

/** True once the pointer has travelled far enough to start a drag. */
export function dragExceeded(sx: number, sy: number, x: number, y: number): boolean {
  return Math.hypot(x - sx, y - sy) >= SAT_DRAG_THRESHOLD_PX;
}

/**
 * Pure rect math for one resize step. Moves the correct corner or corners
 * for the given edge and enforces the content minimum (and the optional
 * maximum) by pinning the free edge. The caller still runs the result
 * through the shared viewport clamp, so this module never decides the
 * final on-screen position alone.
 */
export function resizeGeometry(
  start: SatToolGeometry,
  edge: SatResizeEdge,
  dx: number,
  dy: number,
  min: SatToolMinSize,
  max?: SatToolMinSize,
): SatToolGeometry {
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;

  if (edge.includes("e")) w = start.w + dx;
  if (edge.includes("w")) {
    x = start.x + dx;
    w = start.w - dx;
  }
  if (edge.includes("s")) h = start.h + dy;
  if (edge.includes("n")) {
    y = start.y + dy;
    h = start.h - dy;
  }

  if (w < min.w) {
    if (edge.includes("w")) x = start.x + start.w - min.w;
    w = min.w;
  }
  if (h < min.h) {
    if (edge.includes("n")) y = start.y + start.h - min.h;
    h = min.h;
  }
  if (max) {
    if (w > max.w) {
      if (edge.includes("w")) x = start.x + start.w - max.w;
      w = max.w;
    }
    if (h > max.h) {
      if (edge.includes("n")) y = start.y + start.h - max.h;
      h = max.h;
    }
  }
  return { x, y, w, h };
}

export interface SatToolSafeArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Safe area from a viewport size and a uniform inset. Phase 02 owns the
 * chrome-aware safe area; until it lands this helper assumes a uniform
 * inset on all four edges so drag release still has a snap target.
 */
export function satToolSafeArea(viewport: { w: number; h: number }, inset = 16): SatToolSafeArea {
  return { x: inset, y: inset, w: Math.max(0, viewport.w - inset * 2), h: Math.max(0, viewport.h - inset * 2) };
}

/**
 * Snap the rect to the safe area when an edge sits within the assist
 * radius. Only left and top move; width and height are untouched. When no
 * edge is close enough the rect is returned unchanged.
 */
export function alignToSafeArea(rect: SatToolGeometry, safe: SatToolSafeArea): SatToolGeometry {
  let nx = rect.x;
  let ny = rect.y;
  if (Math.abs(rect.x - safe.x) <= SAT_TOOL_ALIGN_PX) {
    nx = safe.x;
  } else if (Math.abs(rect.x + rect.w - (safe.x + safe.w)) <= SAT_TOOL_ALIGN_PX) {
    nx = safe.x + safe.w - rect.w;
  }
  if (Math.abs(rect.y - safe.y) <= SAT_TOOL_ALIGN_PX) {
    ny = safe.y;
  } else if (Math.abs(rect.y + rect.h - (safe.y + safe.h)) <= SAT_TOOL_ALIGN_PX) {
    ny = safe.y + safe.h - rect.h;
  }
  if (nx === rect.x && ny === rect.y) return rect;
  return { x: nx, y: ny, w: rect.w, h: rect.h };
}
