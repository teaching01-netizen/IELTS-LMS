import React, { createContext, useContext, type ReactNode } from 'react';
import {
  captureSurfaceSelection,
  type CaptureSelectionOptions,
  type HighlightSelectionV2,
} from './highlightV2Engine';
import { subscribeSelectionObserver } from './highlight/selectionObserver';

export interface SurfaceSelectionSnapshot {
  selection: HighlightSelectionV2 | null;
  selectionText: string;
  toolbarPosition: { left: number; top: number } | null;
}

export interface HighlightSelectionPort {
  subscribe: (onSelectionChange: () => void) => () => void;
  readSelection: (
    container: HTMLElement,
    options?: CaptureSelectionOptions,
  ) => SurfaceSelectionSnapshot;
  clearSelection: () => void;
}

function normalizeSelectionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeToolbarPosition(selection: Selection): { left: number; top: number } | null {
  if (selection.rangeCount === 0) {
    return null;
  }

  try {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const left = rect.left + rect.width / 2;
    // Anchor to the bottom of the selected text so the toolbar renders below it.
    const top = rect.bottom + window.scrollY;
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }
    return { left, top };
  } catch {
    return { left: 0, top: window.scrollY };
  }
}

export function createBrowserHighlightSelectionPort(): HighlightSelectionPort {
  return {
    subscribe(onSelectionChange) {
      return subscribeSelectionObserver(onSelectionChange);
    },

    readSelection(container, options) {
      const browserSelection = window.getSelection();
      if (!browserSelection) {
        return {
          selection: null,
          selectionText: '',
          toolbarPosition: null,
        };
      }

      const selection = captureSurfaceSelection(container, browserSelection, options);
      return {
        selection,
        selectionText: normalizeSelectionText(browserSelection.toString()),
        toolbarPosition: selection ? safeToolbarPosition(browserSelection) : null,
      };
    },

    clearSelection() {
      window.getSelection()?.removeAllRanges();
    },
  };
}

export function createInMemoryHighlightSelectionPort(initial?: SurfaceSelectionSnapshot): HighlightSelectionPort & {
  setSnapshot: (snapshot: SurfaceSelectionSnapshot) => void;
  emit: () => void;
} {
  let snapshot: SurfaceSelectionSnapshot = initial ?? {
    selection: null,
    selectionText: '',
    toolbarPosition: null,
  };
  const listeners = new Set<() => void>();

  return {
    subscribe(onSelectionChange) {
      listeners.add(onSelectionChange);
      return () => {
        listeners.delete(onSelectionChange);
      };
    },
    readSelection() {
      return snapshot;
    },
    clearSelection() {
      snapshot = {
        selection: null,
        selectionText: '',
        toolbarPosition: null,
      };
    },
    setSnapshot(nextSnapshot) {
      snapshot = nextSnapshot;
    },
    emit() {
      listeners.forEach((listener) => listener());
    },
  };
}

const defaultHighlightSelectionPort = createBrowserHighlightSelectionPort();
const HighlightSelectionPortContext = createContext<HighlightSelectionPort | null>(null);

export function StudentHighlightSelectionPortProvider({
  port,
  children,
}: {
  port: HighlightSelectionPort;
  children: ReactNode;
}) {
  return (
    <HighlightSelectionPortContext.Provider value={port}>
      {children}
    </HighlightSelectionPortContext.Provider>
  );
}

export function useHighlightSelectionPort(): HighlightSelectionPort {
  return useContext(HighlightSelectionPortContext) ?? defaultHighlightSelectionPort;
}
