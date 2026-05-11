import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import {
  applyHighlightFromSnapshotWithPolicy,
  createHighlightSelectionSnapshot,
  removeHighlightAtIndex,
  type HighlightPolicyReason,
  type HighlightSelectionSnapshot,
} from './highlightSelection';
import { getStudentHighlightClassName, type StudentHighlightColor } from './highlightPalette';
import { useDeferredSelectionHighlight } from './useDeferredSelectionHighlight';

const DEFAULT_HIGHLIGHT_CLASS_NAME = 'rounded-sm bg-yellow-200/80 text-gray-900';
const MOUSE_SELECTION_REMOVE_GUARD_MS = 450;
const HIGHLIGHT_POLICY_HINT_MS = 1800;
const HIGHLIGHT_POLICY_HINT_THROTTLE_MS = 1200;

interface UseStudentHighlightInteractionsOptions {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  highlightClassName?: string | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  onHtmlChange: (html: string) => void;
}

interface UseStudentHighlightInteractionsResult {
  handleSelection: () => boolean;
  handleMouseDown: (event: ReactMouseEvent<HTMLElement>) => void;
  handleManualSelection: () => boolean;
  handleMouseUp: () => void;
  removeTappedHighlight: (event: ReactMouseEvent<HTMLElement>) => void;
  startTouchSelectionSession: () => void;
  scheduleSelectionHighlight: () => void;
  highlightPolicyHint: string | null;
}

function resolveHighlightClassName(
  highlightClassName?: string | undefined,
  highlightColor?: StudentHighlightColor | undefined,
): string {
  return highlightClassName ?? (highlightColor ? getStudentHighlightClassName(highlightColor) : DEFAULT_HIGHLIGHT_CLASS_NAME);
}

function isPreciseSelectionSnapshot(snapshot: HighlightSelectionSnapshot): boolean {
  return snapshot.startNodePath.length > 0 && snapshot.endNodePath.length > 0;
}

export function useStudentHighlightInteractions({
  enabled,
  containerRef,
  highlightClassName,
  highlightColor,
  onHtmlChange,
}: UseStudentHighlightInteractionsOptions): UseStudentHighlightInteractionsResult {
  const resolvedHighlightClassName = useMemo(
    () => resolveHighlightClassName(highlightClassName, highlightColor),
    [highlightClassName, highlightColor],
  );
  const lastMouseSelectionIntentAtRef = useRef<number | null>(null);
  const mouseSelectionSessionActiveRef = useRef(false);
  const latestSelectionSnapshotRef = useRef<HighlightSelectionSnapshot | null>(null);
  const highlightPolicyHintTimerRef = useRef<number | null>(null);
  const lastPolicyHintAtRef = useRef<number>(0);
  const [highlightPolicyHint, setHighlightPolicyHint] = useState<string | null>(null);

  const clearHighlightPolicyHintTimer = useCallback(() => {
    if (highlightPolicyHintTimerRef.current !== null) {
      window.clearTimeout(highlightPolicyHintTimerRef.current);
      highlightPolicyHintTimerRef.current = null;
    }
  }, []);

  const maybeShowPolicyHint = useCallback(
    (reason: HighlightPolicyReason | null) => {
      if (reason !== 'cross_block_selection') {
        return;
      }
      const now = Date.now();
      if (now - lastPolicyHintAtRef.current < HIGHLIGHT_POLICY_HINT_THROTTLE_MS) {
        return;
      }
      lastPolicyHintAtRef.current = now;
      setHighlightPolicyHint('Highlight works within one paragraph at a time.');
      clearHighlightPolicyHintTimer();
      highlightPolicyHintTimerRef.current = window.setTimeout(() => {
        setHighlightPolicyHint(null);
        highlightPolicyHintTimerRef.current = null;
      }, HIGHLIGHT_POLICY_HINT_MS);
    },
    [clearHighlightPolicyHintTimer],
  );

  const captureCurrentSelectionSnapshot = useCallback(() => {
    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection) {
      return null;
    }

    const snapshot = createHighlightSelectionSnapshot(container, selection);
    if (!snapshot || !isPreciseSelectionSnapshot(snapshot)) {
      return null;
    }

    latestSelectionSnapshotRef.current = snapshot;
    return snapshot;
  }, [containerRef]);

  const applySelectionFromSnapshot = useCallback(
    (snapshot: HighlightSelectionSnapshot) => {
      if (!enabled) {
        return false;
      }

      const container = containerRef.current;
      if (!container) {
        return false;
      }

      const result = applyHighlightFromSnapshotWithPolicy(
        container,
        snapshot,
        resolvedHighlightClassName,
      );
      if (!result.html) {
        maybeShowPolicyHint(result.reason);
        return false;
      }

      latestSelectionSnapshotRef.current = null;
      onHtmlChange(result.html);
      window.getSelection()?.removeAllRanges();
      return true;
    },
    [containerRef, enabled, maybeShowPolicyHint, onHtmlChange, resolvedHighlightClassName],
  );

  const applyLatestSelectionSnapshot = useCallback(() => {
    const latestSelectionSnapshot = latestSelectionSnapshotRef.current;
    if (!latestSelectionSnapshot) {
      return false;
    }

    return applySelectionFromSnapshot(latestSelectionSnapshot);
  }, [applySelectionFromSnapshot]);

  const handleSelection = useCallback(() => {
    if (!enabled) {
      return false;
    }

    const snapshot = captureCurrentSelectionSnapshot();
    if (!snapshot) {
      return false;
    }

    return applySelectionFromSnapshot(snapshot);
  }, [applySelectionFromSnapshot, captureCurrentSelectionSnapshot, enabled]);

  const handleMouseUp = useCallback(() => {
    if (!enabled) {
      return;
    }
    const applied = handleSelection() || applyLatestSelectionSnapshot();
    mouseSelectionSessionActiveRef.current = false;
    if (applied) {
      lastMouseSelectionIntentAtRef.current = Date.now();
    }
  }, [applyLatestSelectionSnapshot, enabled, handleSelection]);

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) {
        return;
      }

      mouseSelectionSessionActiveRef.current = true;
      latestSelectionSnapshotRef.current = null;
    },
    [enabled],
  );

  const handleManualSelection = useCallback(() => {
    if (!enabled) {
      return false;
    }

    if (handleSelection()) {
      return true;
    }

    return applyLatestSelectionSnapshot();
  }, [applyLatestSelectionSnapshot, enabled, handleSelection]);

  const { isWithinRecentTouchAutoApplyGuard, startTouchSelectionSession, scheduleSelectionHighlight } =
    useDeferredSelectionHighlight({
      enabled,
      containerRef,
      applySelection: handleSelection,
      applySelectionFromSnapshot,
    });

  const removeTappedHighlight = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }
      if (isWithinRecentTouchAutoApplyGuard()) {
        return;
      }
      const lastMouseSelectionIntentAt = lastMouseSelectionIntentAtRef.current;
      if (lastMouseSelectionIntentAt && Date.now() - lastMouseSelectionIntentAt < MOUSE_SELECTION_REMOVE_GUARD_MS) {
        return;
      }

      const container = containerRef.current;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const highlightedNode = target?.closest('mark[data-highlighted="true"]');
      if (!container || !highlightedNode || !container.contains(highlightedNode)) {
        return;
      }

      const highlightIndex = Array.from(container.querySelectorAll('mark[data-highlighted="true"]')).indexOf(highlightedNode);
      const nextHtml = removeHighlightAtIndex(container, highlightIndex);
      if (nextHtml) {
        event.preventDefault();
        event.stopPropagation();
        onHtmlChange(nextHtml);
      }
    },
    [containerRef, enabled, isWithinRecentTouchAutoApplyGuard, onHtmlChange],
  );

  useEffect(() => {
    if (!enabled) {
      clearHighlightPolicyHintTimer();
      setHighlightPolicyHint(null);
      latestSelectionSnapshotRef.current = null;
      mouseSelectionSessionActiveRef.current = false;
    }
  }, [clearHighlightPolicyHintTimer, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const captureLatestSelectionSnapshot = () => {
      captureCurrentSelectionSnapshot();
    };

    document.addEventListener('selectionchange', captureLatestSelectionSnapshot);

    return () => {
      document.removeEventListener('selectionchange', captureLatestSelectionSnapshot);
    };
  }, [captureCurrentSelectionSnapshot, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const finishMouseSelectionSession = () => {
      if (!mouseSelectionSessionActiveRef.current) {
        return;
      }

      const applied = handleSelection() || applyLatestSelectionSnapshot();
      mouseSelectionSessionActiveRef.current = false;
      if (applied) {
        lastMouseSelectionIntentAtRef.current = Date.now();
      }
    };

    document.addEventListener('mouseup', finishMouseSelectionSession);

    return () => {
      document.removeEventListener('mouseup', finishMouseSelectionSession);
    };
  }, [applyLatestSelectionSnapshot, enabled, handleSelection]);

  useEffect(() => {
    return () => {
      clearHighlightPolicyHintTimer();
    };
  }, [clearHighlightPolicyHintTimer]);

  return {
    handleSelection,
    handleMouseDown,
    handleManualSelection,
    handleMouseUp,
    removeTappedHighlight,
    startTouchSelectionSession,
    scheduleSelectionHighlight,
    highlightPolicyHint,
  };
}
