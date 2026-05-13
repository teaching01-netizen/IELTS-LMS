import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { hashString, type HighlightRangeV2 } from './highlightV2Engine';
import {
  HIGHLIGHT_CLEAR_EVENT_NAME,
  HIGHLIGHT_HTML_STORAGE_PREFIX,
  HIGHLIGHT_RANGE_STORAGE_PREFIX,
} from './highlightStorageKeys';
import {
  readPersistedSurfaceRanges,
  removePersistedSurfaceRanges,
  writePersistedSurfaceRanges,
} from './highlight/highlightStore';

interface HighlightPersistenceContextValue {
  namespace: string;
  clearHighlights: () => void;
}

const HighlightPersistenceContext = createContext<HighlightPersistenceContextValue | null>(null);

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function clearNamespace(namespace: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const prefixes = [
    `${HIGHLIGHT_HTML_STORAGE_PREFIX}:${namespace}:`,
    `${HIGHLIGHT_RANGE_STORAGE_PREFIX}:${namespace}:`,
  ];

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
      storage.removeItem(key);
    }
  }
}

export function clearStudentHighlights(namespace: string): void {
  clearNamespace(namespace);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(HIGHLIGHT_CLEAR_EVENT_NAME, {
        detail: { namespace },
      }),
    );
  }
}

export function StudentHighlightPersistenceProvider({
  namespace,
  children,
}: {
  namespace: string;
  children: ReactNode;
}) {
  const clearHighlights = () => {
    clearStudentHighlights(namespace);
  };

  const value = useMemo(
    () => ({
      namespace,
      clearHighlights,
    }),
    [namespace],
  );

  return <HighlightPersistenceContext.Provider value={value}>{children}</HighlightPersistenceContext.Provider>;
}

export function useStudentHighlightPersistenceContext() {
  return useContext(HighlightPersistenceContext);
}

export function usePersistedHighlightRangesV2(surfaceId: string, canonicalText: string) {
  const context = useStudentHighlightPersistenceContext();
  const namespace = context?.namespace ?? null;
  const sourceHash = useMemo(() => hashString(canonicalText), [canonicalText]);

  const [ranges, setRanges] = useState<HighlightRangeV2[]>(() => {
    if (!namespace) {
      return [];
    }

    const persisted = readPersistedSurfaceRanges(namespace, surfaceId);
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

    const persisted = readPersistedSurfaceRanges(namespace, surfaceId);
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
      removePersistedSurfaceRanges(namespace, surfaceId);
      return;
    }

    writePersistedSurfaceRanges(namespace, surfaceId, {
      sourceHash,
      ranges,
    });
  }, [namespace, ranges, sourceHash, surfaceId]);

  useEffect(() => {
    if (!namespace || typeof window === 'undefined') {
      return;
    }

    const handleClear = (event: Event) => {
      const customEvent = event as CustomEvent<{ namespace?: string }>;
      if (customEvent.detail?.namespace && customEvent.detail.namespace !== namespace) {
        return;
      }

      setRanges([]);
    };

    window.addEventListener(HIGHLIGHT_CLEAR_EVENT_NAME, handleClear as EventListener);
    return () => {
      window.removeEventListener(HIGHLIGHT_CLEAR_EVENT_NAME, handleClear as EventListener);
    };
  }, [namespace]);

  return {
    ranges,
    setRanges,
    sourceHash,
  };
}
