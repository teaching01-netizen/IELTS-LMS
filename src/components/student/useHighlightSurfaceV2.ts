import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  defaultStudentHighlightColor,
  getStudentHighlightClassName,
  type StudentHighlightColor,
} from './highlightPalette';
import { usePersistedHighlightRangesV2 } from './highlightV2Persistence';
import { useHighlightSelectionManager } from './highlightSelectionManager';
import { useHighlightSelectionPort } from './highlightSelectionPort';
import { createHighlight, eraseHighlight } from './highlight/highlightCommandService';
import { renderSurfaceHighlights } from './highlight/renderAdapter';
import type { StudentHighlightToolMode } from './providers/StudentUIProvider';

const MAX_SURFACE_RANGES = 200;

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
  toolMode?: StudentHighlightToolMode | undefined;
}

interface UseHighlightSurfaceV2Result {
  containerRef: RefObject<HTMLElement | null>;
  renderedHtml: string;
  hint: string | null;
}

export function useHighlightSurfaceV2({
  enabled,
  surfaceId,
  baseHtml,
  highlightColor,
  highlightClassName,
  toolMode = 'off',
}: UseHighlightSurfaceV2Options): UseHighlightSurfaceV2Result {
  const containerRef = useRef<HTMLElement | null>(null);
  const instanceIdRef = useRef(`surface:${useId()}`);
  const manager = useHighlightSelectionManager();
  const selectionPort = useHighlightSelectionPort();
  const activeSurfaceId = manager?.activeSurfaceId ?? null;
  const ownsGlobalSelection = !manager || activeSurfaceId === null || activeSurfaceId === instanceIdRef.current;
  const canonicalText = useMemo(() => extractCanonicalTextFromHtml(baseHtml), [baseHtml]);
  const { ranges, setRanges } = usePersistedHighlightRangesV2(surfaceId, canonicalText);
  const [hint, setHint] = useState<string | null>(null);
  const resolvedHighlightColor = highlightColor ?? defaultStudentHighlightColor;
  const resolvedClassForColor = useCallback(
    (color: StudentHighlightColor) =>
      highlightClassName ?? getStudentHighlightClassName(color),
    [highlightClassName],
  );

  const renderedHtml = useMemo(
    () => renderSurfaceHighlights(baseHtml, ranges, resolvedClassForColor),
    [baseHtml, ranges, resolvedClassForColor],
  );

  const processCompletedSelection = useCallback(() => {
    if (!enabled || toolMode === 'off' || !ownsGlobalSelection) return false;
    const container = containerRef.current;
    if (!container) return false;

    const snapshot = selectionPort.readSelection(container);
    if (!snapshot.selection) return false;
    manager?.claimSurface(instanceIdRef.current);
    setHint(null);
    if (toolMode === 'erase') {
      setRanges(eraseHighlight(ranges, snapshot.selection));
    } else {
      const next = createHighlight(ranges, snapshot.selection, resolvedHighlightColor, MAX_SURFACE_RANGES);
      if (next.limitReached) {
        setHint('You reached the highlight limit for this text section.');
        manager?.releaseSurface(instanceIdRef.current);
        return true;
      }
      setRanges(next.ranges);
    }
    selectionPort.clearSelection();
    manager?.releaseSurface(instanceIdRef.current);
    return true;
  }, [enabled, manager, ownsGlobalSelection, ranges, resolvedHighlightColor, selectionPort, setRanges, toolMode]);

  useEffect(() => {
    if (!enabled) {
      setHint(null);
      manager?.releaseSurface(instanceIdRef.current);
      return;
    }

    const unsubscribe = selectionPort.subscribe(() => {
      return processCompletedSelection();
    });
    return unsubscribe;
  }, [enabled, manager, processCompletedSelection, selectionPort]);

  useEffect(() => () => {
    manager?.releaseSurface(instanceIdRef.current);
  }, [manager]);

  return {
    containerRef,
    renderedHtml,
    hint,
  };
}
