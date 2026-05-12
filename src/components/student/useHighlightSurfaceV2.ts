import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  defaultStudentHighlightColor,
  getStudentHighlightClassName,
  type StudentHighlightColor,
} from './highlightPalette';
import {
  addHighlightRange,
  eraseHighlightRange,
  renderHighlightedHtml,
  selectionIntersectsRanges,
  type HighlightSelectionV2,
} from './highlightV2Engine';
import { usePersistedHighlightRangesV2 } from './highlightV2Persistence';
import { useHighlightSelectionManager } from './highlightSelectionManager';
import { useHighlightSelectionPort } from './highlightSelectionPort';

const MAX_SURFACE_RANGES = 200;
const TRANSIENT_SELECTION_STICKY_WINDOW_MS = 250;

function extractCanonicalTextFromHtml(baseHtml: string): string {
  const container = document.createElement('div');
  container.innerHTML = baseHtml;
  return container.textContent ?? '';
}

interface UseHighlightSurfaceV2Options {
  enabled: boolean;
  surfaceId: string;
  baseHtml: string;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
}

interface UseHighlightSurfaceV2Result {
  containerRef: RefObject<HTMLElement | null>;
  renderedHtml: string;
  canHighlightSelection: boolean;
  canEraseSelection: boolean;
  applySelectionHighlight: (color?: StudentHighlightColor) => void;
  eraseSelectionHighlight: () => void;
  hint: string | null;
  selectionToolbarPosition: { left: number; top: number } | null;
}

export function useHighlightSurfaceV2({
  enabled,
  surfaceId,
  baseHtml,
  highlightColor,
  highlightClassName,
}: UseHighlightSurfaceV2Options): UseHighlightSurfaceV2Result {
  const containerRef = useRef<HTMLElement | null>(null);
  const instanceIdRef = useRef(`surface:${useId()}`);
  const lastValidSelectionAtRef = useRef<number>(0);
  const manager = useHighlightSelectionManager();
  const selectionPort = useHighlightSelectionPort();
  const activeSurfaceId = manager?.activeSurfaceId ?? null;
  const ownsGlobalSelection = !manager || activeSurfaceId === null || activeSurfaceId === instanceIdRef.current;
  const canonicalText = useMemo(() => extractCanonicalTextFromHtml(baseHtml), [baseHtml]);
  const { ranges, setRanges } = usePersistedHighlightRangesV2(surfaceId, canonicalText);
  const [selection, setSelection] = useState<HighlightSelectionV2 | null>(null);
  const [selectionToolbarPosition, setSelectionToolbarPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const resolvedHighlightColor = highlightColor ?? defaultStudentHighlightColor;
  const resolvedClassForColor = useCallback(
    (color: StudentHighlightColor) =>
      highlightClassName ?? getStudentHighlightClassName(color),
    [highlightClassName],
  );

  const renderedHtml = useMemo(
    () => renderHighlightedHtml(baseHtml, ranges, resolvedClassForColor),
    [baseHtml, ranges, resolvedClassForColor],
  );

  const refreshSelection = useCallback(() => {
    if (!enabled) {
      setSelection(null);
      setSelectionToolbarPosition(null);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      setSelection(null);
      setSelectionToolbarPosition(null);
      return;
    }

    const snapshot = selectionPort.readSelection(container, {
      enforceSingleBlock: true,
    });
    if (!snapshot.selection) {
      const now = Date.now();
      const canKeepPreviousSelection =
        Boolean(selection) &&
        snapshot.selectionText === selection!.selectedText &&
        now - lastValidSelectionAtRef.current <= TRANSIENT_SELECTION_STICKY_WINDOW_MS;

      if (canKeepPreviousSelection) {
        return;
      }

      setSelection(null);
      setSelectionToolbarPosition(null);
      manager?.releaseSurface(instanceIdRef.current);
      return;
    }

    setSelection(snapshot.selection);
    lastValidSelectionAtRef.current = Date.now();
    manager?.claimSurface(instanceIdRef.current);
    setSelectionToolbarPosition(snapshot.toolbarPosition);
  }, [enabled, manager, selection, selectionPort]);

  const resolveCurrentSelection = useCallback(() => {
    if (!enabled) {
      return null;
    }

    if (selection) {
      return selection;
    }

    const container = containerRef.current;
    if (!container) {
      return null;
    }

    return selectionPort.readSelection(container, {
      enforceSingleBlock: true,
    }).selection;
  }, [enabled, selection, selectionPort]);

  const applySelectionHighlight = useCallback((color?: StudentHighlightColor) => {
    const activeSelection = resolveCurrentSelection();
    if (!enabled || !activeSelection || !ownsGlobalSelection) {
      return;
    }

    const next = addHighlightRange(
      ranges,
      activeSelection,
      color ?? resolvedHighlightColor,
      MAX_SURFACE_RANGES,
    );
    if (next.limitReached) {
      setHint('You reached the highlight limit for this text section.');
      return;
    }

    setHint(null);
    setRanges(next.ranges);
    selectionPort.clearSelection();
    setSelection(null);
    setSelectionToolbarPosition(null);
    manager?.releaseSurface(instanceIdRef.current);
  }, [enabled, manager, ownsGlobalSelection, ranges, resolveCurrentSelection, resolvedHighlightColor, selectionPort, setRanges]);

  const eraseSelectionHighlight = useCallback(() => {
    const activeSelection = resolveCurrentSelection();
    if (!enabled || !activeSelection || !ownsGlobalSelection) {
      return;
    }

    setHint(null);
    setRanges(eraseHighlightRange(ranges, activeSelection));
    selectionPort.clearSelection();
    setSelection(null);
    setSelectionToolbarPosition(null);
    manager?.releaseSurface(instanceIdRef.current);
  }, [enabled, manager, ownsGlobalSelection, ranges, resolveCurrentSelection, selectionPort, setRanges]);

  const canEraseSelection = useMemo(() => {
    if (!selection) {
      return false;
    }

    return selectionIntersectsRanges(ranges, selection);
  }, [ranges, selection]);

  useEffect(() => {
    if (!enabled) {
      setSelection(null);
      setSelectionToolbarPosition(null);
      setHint(null);
      manager?.releaseSurface(instanceIdRef.current);
      return;
    }

    const unsubscribe = selectionPort.subscribe(() => {
      refreshSelection();
    });
    return unsubscribe;
  }, [enabled, manager, refreshSelection, selectionPort]);

  useEffect(() => () => {
    manager?.releaseSurface(instanceIdRef.current);
  }, [manager]);

  return {
    containerRef,
    renderedHtml,
    canHighlightSelection: Boolean(enabled && selection && ownsGlobalSelection),
    canEraseSelection,
    applySelectionHighlight,
    eraseSelectionHighlight,
    hint,
    selectionToolbarPosition,
  };
}
