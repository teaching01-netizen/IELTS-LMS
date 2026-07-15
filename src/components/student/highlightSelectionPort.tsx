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
}

export interface HighlightSelectionPort {
  subscribe: (onSelectionChange: () => boolean) => () => void;
  readSelection: (
    container: HTMLElement,
    options?: CaptureSelectionOptions,
  ) => SurfaceSelectionSnapshot;
  clearSelection: () => void;
}

function normalizeSelectionText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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
        };
      }

      const selection = captureSurfaceSelection(container, browserSelection, options);
      return {
        selection,
        selectionText: normalizeSelectionText(browserSelection.toString()),
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
  };
  const listeners = new Set<() => boolean>();

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
