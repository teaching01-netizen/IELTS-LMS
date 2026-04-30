import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

interface UseDeferredSelectionHighlightOptions {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  applySelection: () => void;
}

const TOUCH_SELECTION_SETTLE_MS = 2000;

export function useDeferredSelectionHighlight({
  enabled,
  containerRef,
  applySelection,
}: UseDeferredSelectionHighlightOptions) {
  const selectionTimerRef = useRef<number | null>(null);

  const scheduleSelectionHighlight = useCallback(() => {
    if (!enabled) {
      return;
    }

    if (selectionTimerRef.current) {
      window.clearTimeout(selectionTimerRef.current);
    }

    selectionTimerRef.current = window.setTimeout(() => {
      applySelection();
      selectionTimerRef.current = null;
    }, TOUCH_SELECTION_SETTLE_MS);
  }, [applySelection, enabled]);

  useEffect(() => {
    return () => {
      if (selectionTimerRef.current) {
        window.clearTimeout(selectionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleSelectionChange = () => {
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.rangeCount === 0 || !selection.toString().trim()) {
        return;
      }

      const range = selection.getRangeAt(0);
      if (container.contains(range.commonAncestorContainer)) {
        scheduleSelectionHighlight();
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [containerRef, enabled, scheduleSelectionHighlight]);

  return scheduleSelectionHighlight;
}
