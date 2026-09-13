/*
 * Floating-tool geometry store (Phase 9 + tool-window system Phase 02).
 * Session-persistent per schedule:attempt:moduleAttempt:tool. Bounded JSON
 * (<2KB), versioned key, corrupt entries removed on read. Geometry is
 * viewport-relative pixels; callers clamp on load so restored panels can
 * never hide offscreen.
 *
 * Phase 02 (v2): the key carries v2 and saves stamp records with v:2, but
 * every v1 reader keeps working - normalizeSatToolGeometry accepts v1
 * records (no v field) and loadSatToolGeometry falls back to the v1 key so
 * an in-flight session never loses its window position. Loads return the
 * plain {x,y,w,h} shape the Phase-01 primitive consumes; the v marker is a
 * storage concern only.
 *
 * clampSatToolGeometry has two overloads: the 2-arg legacy form is kept
 * byte-compatible so the frozen Phase-01 primitive (which this phase must
 * not touch) keeps compiling and behaving; the 3-arg safe-area form is the
 * v2 clamp the placement runtime and panels adopt.
 */

import type { SatSafeArea, SatViewport } from '../domain/satToolPlacement';

export interface SatToolGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SatToolGeometryV2 extends SatToolGeometry {
  v: 2;
  mode?: 'scientific' | 'graphing';
}

export const SAT_TOOL_GEOMETRY_VERSION = 2;
export const SAT_TOOL_GEOMETRY_VERSION_V1 = 1;
export const SAT_TOOL_GEOMETRY_MIN_W = 320;
export const SAT_TOOL_GEOMETRY_MIN_H = 360;
export const SAT_FLOATING_TOOL_CHROME = 48;

export function satToolGeometryKey(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
  tool: string,
): string {
  return 'sat-tool-geometry:v' + String(SAT_TOOL_GEOMETRY_VERSION) + ':' + scheduleId + ':' + attemptId + ':' + moduleAttemptId + ':' + tool;
}

/** v1 key for the read fallback - an in-flight v1 session keeps its window position. */
export function satToolGeometryKeyV1(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
  tool: string,
): string {
  return 'sat-tool-geometry:v' + String(SAT_TOOL_GEOMETRY_VERSION_V1) + ':' + scheduleId + ':' + attemptId + ':' + moduleAttemptId + ':' + tool;
}

export function normalizeSatToolGeometry(value: unknown): SatToolGeometry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const numbers = [record['x'], record['y'], record['w'], record['h']];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const w = Math.max(SAT_TOOL_GEOMETRY_MIN_W, Math.round(record['w'] as number));
  const h = Math.max(SAT_TOOL_GEOMETRY_MIN_H, Math.round(record['h'] as number));
  return { x: Math.round(record['x'] as number), y: Math.round(record['y'] as number), w, h };
}

/**
 * Legacy 2-arg clamp (v1 math, byte-compatible): at least CHROME px of the
 * panel stay inside the raw viewport. Kept so the frozen Phase-01 primitive
 * call sites keep compiling and behaving unchanged.
 */
export function clampSatToolGeometry(
  geometry: SatToolGeometry,
  viewport: SatViewport,
): SatToolGeometry;
/**
 * v2 safe-area clamp: the window is folded into the safe area derived from
 * the exam chrome (header/footer) plus the tool safe inset - never the raw
 * viewport. Size is clamped against the safe-area span, floored at the tool
 * minimum so a shrunken viewport keeps the window reachable instead of
 * resetting it; a 0-height safe area falls back to the minimum size at
 * minY = safeArea.top.
 */
export function clampSatToolGeometry(
  geometry: SatToolGeometry,
  viewport: SatViewport,
  safeArea: SatSafeArea,
): SatToolGeometry;
export function clampSatToolGeometry(
  geometry: SatToolGeometry,
  viewport: SatViewport,
  safeArea?: SatSafeArea,
): SatToolGeometry {
  if (!safeArea) {
    const maxW = Math.max(SAT_TOOL_GEOMETRY_MIN_W, viewport.w - 32);
    const maxH = Math.max(SAT_TOOL_GEOMETRY_MIN_H, viewport.h - 32);
    const w = Math.min(geometry.w, maxW);
    const h = Math.min(geometry.h, maxH);
    const x = Math.min(Math.max(geometry.x, 32 + w - viewport.w), viewport.w - SAT_FLOATING_TOOL_CHROME);
    const y = Math.min(Math.max(geometry.y, 0), Math.max(0, viewport.h - SAT_FLOATING_TOOL_CHROME));
    return { x, y, w, h };
  }
  const safeW = viewport.w - safeArea.left - safeArea.right;
  const safeH = viewport.h - safeArea.top - safeArea.bottom;
  const w = Math.min(Math.max(geometry.w, SAT_TOOL_GEOMETRY_MIN_W), Math.max(SAT_TOOL_GEOMETRY_MIN_W, safeW));
  const h = Math.min(Math.max(geometry.h, SAT_TOOL_GEOMETRY_MIN_H), Math.max(SAT_TOOL_GEOMETRY_MIN_H, safeH));
  const minX = safeArea.left;
  const maxX = viewport.w - safeArea.right - w;
  const minY = safeArea.top;
  const maxY = viewport.h - safeArea.bottom - h;
  const x = Math.min(Math.max(geometry.x, minX), Math.max(minX, maxX));
  const y = Math.min(Math.max(geometry.y, minY), Math.max(minY, maxY));
  return { x, y, w, h };
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readGeometryEntry(storage: Storage, key: string): SatToolGeometry | 'corrupt' | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const normalized = normalizeSatToolGeometry(JSON.parse(raw) as unknown);
    if (!normalized) {
      try { storage.removeItem(key); } catch { /* never block the exam */ }
      return 'corrupt';
    }
    return normalized;
  } catch {
    try { storage.removeItem(key); } catch { /* never block the exam */ }
    return 'corrupt';
  }
}

/**
 * Load geometry for a v2 key, falling back to the v1 key (v1 records carry
 * no v field; normalize accepts them and they re-clamp on use). Corrupt
 * entries are removed on read, matching the v1 discipline.
 */
export function loadSatToolGeometry(key: string): SatToolGeometry | null {
  const storage = browserStorage();
  if (!storage) return null;
  const primary = readGeometryEntry(storage, key);
  if (primary && primary !== 'corrupt') return primary;
  const v2Prefix = 'sat-tool-geometry:v' + String(SAT_TOOL_GEOMETRY_VERSION) + ':';
  const v1Prefix = 'sat-tool-geometry:v' + String(SAT_TOOL_GEOMETRY_VERSION_V1) + ':';
  const v1Key = key.indexOf(v2Prefix) === 0 ? v1Prefix + key.slice(v2Prefix.length) : null;
  if (v1Key) {
    const fallback = readGeometryEntry(storage, v1Key);
    if (fallback && fallback !== 'corrupt') return fallback;
  }
  return null;
}

/** Save stamps the record v:2; loads normalize back to the plain {x,y,w,h} shape. */
export function saveSatToolGeometry(key: string, geometry: SatToolGeometry): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    const record: SatToolGeometryV2 = {
      x: Math.round(geometry.x),
      y: Math.round(geometry.y),
      w: Math.round(geometry.w),
      h: Math.round(geometry.h),
      v: 2,
    };
    storage.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
