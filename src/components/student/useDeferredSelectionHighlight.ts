import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createHighlightSelectionSnapshot, type HighlightSelectionSnapshot } from './highlightSelection';

interface UseDeferredSelectionHighlightOptions {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  applySelection: () => boolean;
  applySelectionFromSnapshot?: ((snapshot: HighlightSelectionSnapshot) => boolean) | undefined;
}

const FAST_TOUCH_APPLY_MS = 420;
const TOUCH_MAX_WAIT_MS = 1200;
const TOUCH_AUTO_APPLY_REMOVE_GUARD_MS = 700;

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
  const lastTouchAutoApplyAtRef = useRef<number | null>(null);

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

    let applied = false;
    if (pendingSnapshot && applySelectionFromSnapshot?.(pendingSnapshot)) {
      applied = true;
    } else {
      applied = applySelection();
    }

    if (applied) {
      lastTouchAutoApplyAtRef.current = Date.now();
    }
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

  const queueCurrentSelection = useCallback(() => {
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
  }, [containerRef, queueSelectionHighlight]);

  const startTouchSelectionSession = useCallback(() => {
    if (!enabled) {
      return;
    }

    if (touchWindowStartedAtRef.current !== null && pendingSnapshotRef.current) {
      clearPending();
    }

    touchSessionActiveRef.current = true;
    queueCurrentSelection();
  }, [clearPending, enabled, queueCurrentSelection]);

  const scheduleSelectionHighlight = useCallback(() => {
    if (!enabled) {
      return;
    }

    touchSessionActiveRef.current = true;
    queueCurrentSelection();
  }, [enabled, queueCurrentSelection]);

  const isWithinRecentTouchAutoApplyGuard = useCallback(() => {
    const lastTouchAutoApplyAt = lastTouchAutoApplyAtRef.current;
    if (!lastTouchAutoApplyAt) {
      return false;
    }

    return Date.now() - lastTouchAutoApplyAt < TOUCH_AUTO_APPLY_REMOVE_GUARD_MS;
  }, []);

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

      queueCurrentSelection();
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [clearPending, enabled, queueCurrentSelection]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleTouchEnd = () => {
      if (!touchSessionActiveRef.current) {
        return;
      }

      queueCurrentSelection();
    };

    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [enabled, queueCurrentSelection]);

  return {
    isWithinRecentTouchAutoApplyGuard,
    startTouchSelectionSession,
    scheduleSelectionHighlight,
  };
}
