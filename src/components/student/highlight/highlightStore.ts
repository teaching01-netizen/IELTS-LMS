import { HIGHLIGHT_RANGE_STORAGE_PREFIX } from '../highlightStorageKeys';
import type { HighlightRangeV2 } from '../highlightV2Engine';

export interface PersistedSurfaceRanges {
  sourceHash: string;
  ranges: HighlightRangeV2[];
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function buildHighlightStorageKey(namespace: string, surfaceId: string): string {
  return `${HIGHLIGHT_RANGE_STORAGE_PREFIX}:${namespace}:${surfaceId}`;
}

export function safeParsePersistedSurfaceRanges(
  payload: string | null,
): PersistedSurfaceRanges | null {
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as PersistedSurfaceRanges;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    if (typeof parsed.sourceHash !== 'string' || !Array.isArray(parsed.ranges)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function readPersistedSurfaceRanges(
  namespace: string,
  surfaceId: string,
): PersistedSurfaceRanges | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  return safeParsePersistedSurfaceRanges(storage.getItem(buildHighlightStorageKey(namespace, surfaceId)));
}

export function writePersistedSurfaceRanges(
  namespace: string,
  surfaceId: string,
  payload: PersistedSurfaceRanges,
): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(buildHighlightStorageKey(namespace, surfaceId), JSON.stringify(payload));
  } catch {
    // Ignore storage errors; in-memory highlights still function.
  }
}

export function removePersistedSurfaceRanges(namespace: string, surfaceId: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(buildHighlightStorageKey(namespace, surfaceId));
  } catch {
    // Ignore storage errors.
  }
}
