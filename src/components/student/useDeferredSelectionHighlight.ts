import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createHighlightSelectionSnapshot, type HighlightSelectionSnapshot } from './highlightSelection';

interface UseDeferredSelectionHighlightOptions {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  applySelection: () => void;
  applySelectionFromSnapshot?: ((snapshot: HighlightSelectionSnapshot) => boolean) | undefined;
}

const FAST_TOUCH_APPLY_MS = 180;
const TOUCH_MAX_WAIT_MS = 700;

export function useDeferredSelectionHighlight({
  enabled,
  containerRef,
  applySelection,
  applySelectionFromSnapshot,
}: UseDeferredSelectionHighlightOptions) {
  const fastApplyTimerRef = useRef<number | null>(null);
  const maxWaitTimerRef = useRef<number | null>(null);
  const touchWindowStartedAtRef = useRef<number | null>(null);
  const touchSessionActiveRef = useRef(false);
  const pendingSnapshotRef = useRef<HighlightSelectionSnapshot | null>(null);
  const pendingSignatureRef = useRef<string | null>(null);

  const clearPending = useCallback(() => {
    if (fastApplyTimerRef.current) {
      window.clearTimeout(fastApplyTimerRef.current);
      fastApplyTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      window.clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
    touchWindowStartedAtRef.current = null;
    pendingSnapshotRef.current = null;
    pendingSignatureRef.current = null;
    touchSessionActiveRef.current = false;
  }, []);

  const applyPending = useCallback(() => {
    const pendingSnapshot = pendingSnapshotRef.current;
    clearPending();

    if (pendingSnapshot && applySelectionFromSnapshot?.(pendingSnapshot)) {
      return;
    }

    applySelection();
  }, [applySelection, applySelectionFromSnapshot, clearPending]);

  const queueSelectionHighlight = useCallback(
    (snapshot: HighlightSelectionSnapshot) => {
      const hasPendingWindow = touchWindowStartedAtRef.current !== null;
      if (hasPendingWindow && pendingSignatureRef.current === snapshot.signature) {
        return;
      }

      const now = Date.now();
      const windowStartedAt = touchWindowStartedAtRef.current ?? now;

      if (touchWindowStartedAtRef.current === null) {
        touchWindowStartedAtRef.current = now;
        maxWaitTimerRef.current = window.setTimeout(() => {
          applyPending();
        }, TOUCH_MAX_WAIT_MS);
      }

      pendingSnapshotRef.current = snapshot;
      pendingSignatureRef.current = snapshot.signature;

      if (fastApplyTimerRef.current) {
        window.clearTimeout(fastApplyTimerRef.current);
      }

      const elapsed = now - windowStartedAt;
      const remainingBeforeCap = Math.max(0, TOUCH_MAX_WAIT_MS - elapsed);
      const nextDelay = Math.min(FAST_TOUCH_APPLY_MS, remainingBeforeCap);
      if (nextDelay <= 0) {
        applyPending();
        return;
      }

      fastApplyTimerRef.current = window.setTimeout(() => {
        applyPending();
      }, nextDelay);
    },
    [applyPending],
  );

  const scheduleSelectionHighlight = useCallback(() => {
    if (!enabled) {
      return;
    }
    touchSessionActiveRef.current = true;

    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection) {
      return;
    }

    const snapshot = createHighlightSelectionSnapshot(container, selection);
    if (!snapshot) {
      return;
    }

    queueSelectionHighlight(snapshot);
  }, [containerRef, enabled, queueSelectionHighlight]);

  useEffect(() => {
    return () => {
      clearPending();
    };
  }, [clearPending]);

  useEffect(() => {
    if (!enabled) {
      clearPending();
      return;
    }

    const handleSelectionChange = () => {
      if (!touchSessionActiveRef.current) {
        return;
      }

      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection) {
        return;
      }

      const snapshot = createHighlightSelectionSnapshot(container, selection);
      if (!snapshot) {
        return;
      }

      queueSelectionHighlight(snapshot);
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [clearPending, containerRef, enabled, queueSelectionHighlight]);

  return scheduleSelectionHighlight;
}
