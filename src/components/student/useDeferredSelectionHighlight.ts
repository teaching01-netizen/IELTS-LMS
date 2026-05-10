import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { createHighlightSelectionSnapshot, type HighlightSelectionSnapshot } from './highlightSelection';

interface UseDeferredSelectionHighlightOptions {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  applySelection: () => boolean;
  applySelectionFromSnapshot?: ((snapshot: HighlightSelectionSnapshot) => boolean) | undefined;
  touchApplyDelayMs?: number | undefined;
  touchApplyRetryIntervalMs?: number | undefined;
  touchApplyMaxRetries?: number | undefined;
}

const TOUCH_AUTO_APPLY_REMOVE_GUARD_MS = 700;
const DEFAULT_TOUCH_APPLY_DELAY_MS = 160;
const DEFAULT_TOUCH_APPLY_RETRY_INTERVAL_MS = 110;
const DEFAULT_TOUCH_APPLY_MAX_RETRIES = 5;

export function useDeferredSelectionHighlight({
  enabled,
  containerRef,
  applySelection,
  applySelectionFromSnapshot,
  touchApplyDelayMs = DEFAULT_TOUCH_APPLY_DELAY_MS,
  touchApplyRetryIntervalMs = DEFAULT_TOUCH_APPLY_RETRY_INTERVAL_MS,
  touchApplyMaxRetries = DEFAULT_TOUCH_APPLY_MAX_RETRIES,
}: UseDeferredSelectionHighlightOptions) {
  const touchSessionActiveRef = useRef(false);
  const pendingSnapshotRef = useRef<HighlightSelectionSnapshot | null>(null);
  const pendingSignatureRef = useRef<string | null>(null);
  const lastTouchAutoApplyAtRef = useRef<number | null>(null);
  const touchApplyTimerRef = useRef<number | null>(null);
  const sawSelectionChangeInSessionRef = useRef(false);

  const clearPending = useCallback(() => {
    pendingSnapshotRef.current = null;
    pendingSignatureRef.current = null;
    touchSessionActiveRef.current = false;
    sawSelectionChangeInSessionRef.current = false;
  }, []);

  const clearTouchApplyTimer = useCallback(() => {
    if (touchApplyTimerRef.current !== null) {
      window.clearTimeout(touchApplyTimerRef.current);
      touchApplyTimerRef.current = null;
    }
  }, []);

  const applyPending = useCallback(() => {
    const pendingSnapshot = pendingSnapshotRef.current;

    let applied = applySelection();
    if (
      !applied &&
      pendingSnapshot &&
      sawSelectionChangeInSessionRef.current &&
      applySelectionFromSnapshot?.(pendingSnapshot)
    ) {
      applied = true;
    }

    if (applied) {
      lastTouchAutoApplyAtRef.current = Date.now();
      clearPending();
    }
    return applied;
  }, [applySelection, applySelectionFromSnapshot, clearPending]);

  const queueSelectionHighlight = useCallback(
    (snapshot: HighlightSelectionSnapshot) => {
      if (pendingSignatureRef.current === snapshot.signature) {
        return;
      }

      pendingSnapshotRef.current = snapshot;
      pendingSignatureRef.current = snapshot.signature;
    },
    [],
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

    clearTouchApplyTimer();
    if (pendingSnapshotRef.current) {
      clearPending();
    }

    touchSessionActiveRef.current = true;
    sawSelectionChangeInSessionRef.current = false;
    queueCurrentSelection();
  }, [clearPending, clearTouchApplyTimer, enabled, queueCurrentSelection]);

  const scheduleSelectionHighlight = useCallback(() => {
    if (!enabled) {
      return;
    }

    if (!touchSessionActiveRef.current) {
      return;
    }

    queueCurrentSelection();
    clearTouchApplyTimer();

    const maxRetries = Math.max(0, Math.floor(touchApplyMaxRetries));
    const retryIntervalMs = Math.max(0, Math.floor(touchApplyRetryIntervalMs));
    const initialDelayMs = Math.max(0, Math.floor(touchApplyDelayMs));
    let attempts = 0;

    const runAttempt = () => {
      if (!touchSessionActiveRef.current) {
        clearTouchApplyTimer();
        return;
      }

      queueCurrentSelection();
      const applied = applyPending();
      if (applied) {
        clearTouchApplyTimer();
        return;
      }

      if (attempts >= maxRetries) {
        clearPending();
        clearTouchApplyTimer();
        return;
      }

      attempts += 1;
      touchApplyTimerRef.current = window.setTimeout(runAttempt, retryIntervalMs);
    };

    touchApplyTimerRef.current = window.setTimeout(runAttempt, initialDelayMs);
  }, [
    applyPending,
    clearTouchApplyTimer,
    enabled,
    queueCurrentSelection,
    touchApplyDelayMs,
    touchApplyMaxRetries,
    touchApplyRetryIntervalMs,
  ]);

  const isWithinRecentTouchAutoApplyGuard = useCallback(() => {
    const lastTouchAutoApplyAt = lastTouchAutoApplyAtRef.current;
    if (!lastTouchAutoApplyAt) {
      return false;
    }

    return Date.now() - lastTouchAutoApplyAt < TOUCH_AUTO_APPLY_REMOVE_GUARD_MS;
  }, []);

  useEffect(() => {
    return () => {
      clearTouchApplyTimer();
      clearPending();
    };
  }, [clearPending, clearTouchApplyTimer]);

  useEffect(() => {
    if (!enabled) {
      clearTouchApplyTimer();
      clearPending();
      return;
    }

    const handleSelectionChange = () => {
      if (!touchSessionActiveRef.current) {
        return;
      }

      sawSelectionChangeInSessionRef.current = true;
      queueCurrentSelection();
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [clearPending, clearTouchApplyTimer, enabled, queueCurrentSelection]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleTouchEnd = () => {
      scheduleSelectionHighlight();
    };

    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [enabled, scheduleSelectionHighlight]);

  return {
    isWithinRecentTouchAutoApplyGuard,
    startTouchSelectionSession,
    scheduleSelectionHighlight,
  };
}
