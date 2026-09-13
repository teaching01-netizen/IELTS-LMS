/*
 * SAT floating-tool view state store (tool-window system, Phase 02).
 * Persists per-tool view state the geometry rect does not carry: reference
 * zoom/scroll, the last-focused tool (drives the active/inactive elevation
 * the Phase-01 primitive renders), and the Phase-07 first-open discovery
 * hint flag. Versioned key per schedule:attempt:moduleAttempt, mirroring
 * the satToolGeometryKey shape.
 *
 * Phase-07 coordination: this module lands first and already includes
 * toolHintSeen with the exact name/shape Phase 07 expects, so Phase 07
 * extends the stored value without renaming anything. If Phase 07 landed
 * first, it would add this same field; either way the persisted key and
 * the load-defaults discipline stay identical.
 *
 * localStorage (session-persistent within the module) matches the geometry
 * store. NOTE: satCalculatorWorkspace.ts uses sessionStorage instead; that
 * inconsistency is out of scope here and is deliberately not unified.
 *
 * R-04 ReferenceSheetState (Reference-only readers; Calculator ignores):
 * collapsed / scaleMode / hasBeenMoved / hasBeenResized ride on this same
 * key family (no new storage mechanism, no new key family, no version bump -
 * the loader already defaults missing fields, same discipline as the
 * Phase-07 toolHintSeen addition). zoom stays as the legacy fallback for
 * Reference restore: Reference readers prefer scaleMode and fall back to
 * clamped zoom only when scaleMode is absent.
 */

import type { SatToolKind } from '../domain/satToolSizePolicy';

export const SAT_TOOL_VIEW_STATE_VERSION = 1;
export const SAT_TOOL_VIEW_ZOOM_DEFAULT = 1;
export const SAT_TOOL_VIEW_SCROLL_DEFAULT = 0;
export type SatReferenceScaleMode = 'fit-width';
export const SAT_TOOL_VIEW_COLLAPSED_DEFAULT = false;
export const SAT_TOOL_VIEW_SCALE_MODE_DEFAULT: SatReferenceScaleMode = 'fit-width';
export const SAT_TOOL_VIEW_MOVED_DEFAULT = false;
export const SAT_TOOL_VIEW_RESIZED_DEFAULT = false;

export interface SatToolViewState {
  /** Reference sheet zoom: 1 = fit width (legacy fallback for Reference; Calculator unchanged). */
  zoom: number;
  /** Reference sheet scrollTop in px (canonical scroll anchor). */
  scrollTop: number;
  /** R-04: true while the Reference sheet is collapsed (height collapses to header only; geometry retained underneath). */
  collapsed: boolean;
  /** R-04: canonical Reference scale (only mode shipped: fit-width). */
  scaleMode: SatReferenceScaleMode;
  /** R-04 manual-wins position gate: any user drag sets this; automatic placement never re-runs positions once set. */
  hasBeenMoved: boolean;
  /** R-04 manual-wins size gate: any user resize sets this; automatic placement never re-runs sizes once set. */
  hasBeenResized: boolean;
  lastFocusedTool: SatToolKind | null;
  /** Phase-07 discovery hint (default {}): true once the tool showed its hint. */
  toolHintSeen: Partial<Record<SatToolKind, boolean>>;
}

export function createDefaultSatToolViewState(): SatToolViewState {
  return {
    zoom: SAT_TOOL_VIEW_ZOOM_DEFAULT,
    scrollTop: SAT_TOOL_VIEW_SCROLL_DEFAULT,
    collapsed: SAT_TOOL_VIEW_COLLAPSED_DEFAULT,
    scaleMode: SAT_TOOL_VIEW_SCALE_MODE_DEFAULT,
    hasBeenMoved: SAT_TOOL_VIEW_MOVED_DEFAULT,
    hasBeenResized: SAT_TOOL_VIEW_RESIZED_DEFAULT,
    lastFocusedTool: null,
    toolHintSeen: {},
  };
}

export function satToolViewKey(
  scheduleId: string,
  attemptId: string,
  moduleAttemptId: string,
): string {
  return 'sat-tool-view:v' + String(SAT_TOOL_VIEW_STATE_VERSION) + ':' + scheduleId + ':' + attemptId + ':' + moduleAttemptId;
}

function isToolKind(value: unknown): value is SatToolKind {
  return value === 'calculator' || value === 'reference';
}

function normalizeZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SAT_TOOL_VIEW_ZOOM_DEFAULT;
  return value;
}

function normalizeScrollTop(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SAT_TOOL_VIEW_SCROLL_DEFAULT;
  return Math.max(0, value);
}

function normalizeCollapsed(value: unknown): boolean {
  return value === true;
}

function normalizeScaleMode(value: unknown): SatReferenceScaleMode {
  return value === 'fit-width' ? 'fit-width' : SAT_TOOL_VIEW_SCALE_MODE_DEFAULT;
}

function normalizeMovedFlag(value: unknown): boolean {
  return value === true;
}

function normalizeHintSeen(value: unknown): Partial<Record<SatToolKind, boolean>> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const next: Partial<Record<SatToolKind, boolean>> = {};
  const keys: readonly SatToolKind[] = ['calculator', 'reference'];
  for (const key of keys) {
    if (record[key] === true) next[key] = true;
  }
  return next;
}

export function normalizeSatToolViewState(value: unknown): SatToolViewState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const lastFocused = record['lastFocusedTool'];
  if (lastFocused !== null && lastFocused !== undefined && !isToolKind(lastFocused)) return null;
  return {
    zoom: normalizeZoom(record['zoom']),
    scrollTop: normalizeScrollTop(record['scrollTop']),
    collapsed: normalizeCollapsed(record['collapsed']),
    scaleMode: normalizeScaleMode(record['scaleMode']),
    hasBeenMoved: normalizeMovedFlag(record['hasBeenMoved']),
    hasBeenResized: normalizeMovedFlag(record['hasBeenResized']),
    lastFocusedTool: isToolKind(lastFocused) ? lastFocused : null,
    toolHintSeen: normalizeHintSeen(record['toolHintSeen']),
  };
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Missing/corrupt entries yield defaults; corrupt entries are removed (geometry-store discipline). */
export function loadSatToolViewState(key: string): SatToolViewState {
  const fallback = createDefaultSatToolViewState();
  const storage = browserStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const normalized = normalizeSatToolViewState(JSON.parse(raw) as unknown);
    if (!normalized) {
      try { storage.removeItem(key); } catch { /* never block the exam */ }
      return fallback;
    }
    return normalized;
  } catch {
    try { storage.removeItem(key); } catch { /* never block the exam */ }
    return fallback;
  }
}

export function saveSatToolViewState(key: string, state: SatToolViewState): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({
      zoom: state.zoom,
      scrollTop: state.scrollTop,
      collapsed: state.collapsed,
      scaleMode: state.scaleMode,
      hasBeenMoved: state.hasBeenMoved,
      hasBeenResized: state.hasBeenResized,
      lastFocusedTool: state.lastFocusedTool,
      toolHintSeen: state.toolHintSeen,
    }));
    return true;
  } catch {
    return false;
  }
}
