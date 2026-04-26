import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const STORAGE_PREFIX = 'ielts_student_highlight_html_v1';
const CLEAR_EVENT_NAME = 'ielts-student-highlight-clear-v1';

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

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function buildStorageKey(namespace: string, contentKey: string): string {
  return `${STORAGE_PREFIX}:${namespace}:${contentKey}`;
}

function readStoredHtml(namespace: string, contentKey: string): string | null {
  const storage = getStorage();
  return storage?.getItem(buildStorageKey(namespace, contentKey)) ?? null;
}

function writeStoredHtml(namespace: string, contentKey: string, html: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(buildStorageKey(namespace, contentKey), html);
  } catch {
    // Ignore storage errors. Highlighting should keep working in memory.
  }
}

function clearNamespace(namespace: string): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const prefix = `${STORAGE_PREFIX}:${namespace}:`;

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) {
      storage.removeItem(key);
    }
  }
}

export function clearStudentHighlights(namespace: string): void {
  clearNamespace(namespace);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(CLEAR_EVENT_NAME, {
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

export function usePersistedStudentHighlightHtml(
  initialHtml: string,
  contentKey?: string | undefined,
) {
  const context = useContext(HighlightPersistenceContext);
  const namespace = context?.namespace ?? null;
  const resolvedContentKey = contentKey ?? hashString(initialHtml);
  const storageKey = namespace ? buildStorageKey(namespace, resolvedContentKey) : null;

  const [html, setHtml] = useState(() => {
    if (!storageKey) {
      return initialHtml;
    }

    return readStoredHtml(namespace!, resolvedContentKey) ?? initialHtml;
  });

  useEffect(() => {
    if (!storageKey) {
      setHtml(initialHtml);
      return;
    }

    setHtml(readStoredHtml(namespace!, resolvedContentKey) ?? initialHtml);
  }, [initialHtml, namespace, resolvedContentKey, storageKey]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    if (html === initialHtml) {
      const storage = getStorage();
      try {
        storage?.removeItem(storageKey);
      } catch {
        // ignore
      }
      return;
    }

    writeStoredHtml(namespace!, resolvedContentKey, html);
  }, [html, initialHtml, namespace, resolvedContentKey, storageKey]);

  useEffect(() => {
    if (!namespace || typeof window === 'undefined') {
      return;
    }

    const handleClear = (event: Event) => {
      const customEvent = event as CustomEvent<{ namespace?: string }>;
      if (customEvent.detail?.namespace && customEvent.detail.namespace !== namespace) {
        return;
      }

      setHtml(initialHtml);
    };

    window.addEventListener(CLEAR_EVENT_NAME, handleClear as EventListener);
    return () => {
      window.removeEventListener(CLEAR_EVENT_NAME, handleClear as EventListener);
    };
  }, [initialHtml, namespace]);

  return {
    html,
    setHtml,
    hasPersistedHtml: html !== initialHtml,
    clearHighlights: context?.clearHighlights ?? (() => {}),
  };
}
