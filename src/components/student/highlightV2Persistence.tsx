import { useEffect, useMemo, useState } from 'react';
import { useStudentHighlightPersistenceContext } from './highlightPersistence';
import { hashString, type HighlightRangeV2 } from './highlightV2Engine';
import { HIGHLIGHT_RANGE_STORAGE_PREFIX } from './highlightStorageKeys';

interface PersistedSurfaceRangesV2 {
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

function buildStorageKey(namespace: string, surfaceId: string): string {
  return `${HIGHLIGHT_RANGE_STORAGE_PREFIX}:${namespace}:${surfaceId}`;
}

function safeParseRanges(payload: string | null): PersistedSurfaceRangesV2 | null {
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as PersistedSurfaceRangesV2;
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

function readSurfaceRanges(namespace: string, surfaceId: string): PersistedSurfaceRangesV2 | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  return safeParseRanges(storage.getItem(buildStorageKey(namespace, surfaceId)));
}

function writeSurfaceRanges(namespace: string, surfaceId: string, payload: PersistedSurfaceRangesV2): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(buildStorageKey(namespace, surfaceId), JSON.stringify(payload));
  } catch {
    // Ignore storage errors; in-memory highlighting still works.
  }
}

function removeSurfaceRanges(namespace: string, surfaceId: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(buildStorageKey(namespace, surfaceId));
  } catch {
    // Ignore storage errors.
  }
}

export function usePersistedHighlightRangesV2(surfaceId: string, canonicalText: string) {
  const context = useStudentHighlightPersistenceContext();
  const namespace = context?.namespace ?? null;
  const sourceHash = useMemo(() => hashString(canonicalText), [canonicalText]);

  const [ranges, setRanges] = useState<HighlightRangeV2[]>(() => {
    if (!namespace) {
      return [];
    }

    const persisted = readSurfaceRanges(namespace, surfaceId);
    if (!persisted || persisted.sourceHash !== sourceHash) {
      return [];
    }

    return persisted.ranges;
  });

  useEffect(() => {
    if (!namespace) {
      setRanges([]);
      return;
    }

    const persisted = readSurfaceRanges(namespace, surfaceId);
    if (!persisted || persisted.sourceHash !== sourceHash) {
      setRanges([]);
      return;
    }

    setRanges(persisted.ranges);
  }, [namespace, sourceHash, surfaceId]);

  useEffect(() => {
    if (!namespace) {
      return;
    }

    if (ranges.length === 0) {
      removeSurfaceRanges(namespace, surfaceId);
      return;
    }

    writeSurfaceRanges(namespace, surfaceId, {
      sourceHash,
      ranges,
    });
  }, [namespace, ranges, sourceHash, surfaceId]);

  return {
    ranges,
    setRanges,
    sourceHash,
  };
}
