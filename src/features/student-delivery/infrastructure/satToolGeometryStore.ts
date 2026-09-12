/**
 * Floating-tool geometry store (Phase 9). Session-persistent per
 * schedule:attempt:moduleAttempt:tool. Bounded JSON (<2KB), versioned key,
 * corrupt entries removed on read. Geometry is viewport-relative pixels;
 * callers clamp on load so restored panels can never hide offscreen.
 */

export interface SatToolGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SAT_TOOL_GEOMETRY_VERSION = 1;
export const SAT_TOOL_GEOMETRY_MIN_W = 320;
export const SAT_TOOL_GEOMETRY_MIN_H = 360;
export const SAT_FLOATING_TOOL_CHROME = 48;

export function satToolGeometryKey(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
  tool: string,
): string {
  return `sat-tool-geometry:v${SAT_TOOL_GEOMETRY_VERSION}:${scheduleId}:${attemptId}:${moduleAttemptId}:${tool}`;
}

export function normalizeSatToolGeometry(value: unknown): SatToolGeometry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const numbers = [record["x"], record["y"], record["w"], record["h"]];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const w = Math.max(SAT_TOOL_GEOMETRY_MIN_W, Math.round(record["w"] as number));
  const h = Math.max(SAT_TOOL_GEOMETRY_MIN_H, Math.round(record["h"] as number));
  return { x: Math.round(record["x"] as number), y: Math.round(record["y"] as number), w, h };
}

/** Clamp so at least CHROME px of the panel stay inside the viewport. */
export function clampSatToolGeometry(
  geometry: SatToolGeometry,
  viewport: { w: number; h: number },
): SatToolGeometry {
  const maxW = Math.max(SAT_TOOL_GEOMETRY_MIN_W, viewport.w - 32);
  const maxH = Math.max(SAT_TOOL_GEOMETRY_MIN_H, viewport.h - 32);
  const w = Math.min(geometry.w, maxW);
  const h = Math.min(geometry.h, maxH);
  const x = Math.min(Math.max(geometry.x, 32 + w - viewport.w), viewport.w - SAT_FLOATING_TOOL_CHROME);
  const y = Math.min(Math.max(geometry.y, 0), Math.max(0, viewport.h - SAT_FLOATING_TOOL_CHROME));
  return { x, y, w, h };
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadSatToolGeometry(key: string): SatToolGeometry | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const normalized = normalizeSatToolGeometry(parsed);
    if (!normalized) storage.removeItem(key);
    return normalized;
  } catch {
    try { storage.removeItem(key); } catch { /* never block the exam */ }
    return null;
  }
}

export function saveSatToolGeometry(key: string, geometry: SatToolGeometry): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(geometry));
    return true;
  } catch {
    return false;
  }
}
