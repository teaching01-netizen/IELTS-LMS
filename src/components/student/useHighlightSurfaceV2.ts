import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  defaultStudentHighlightColor,
  getStudentHighlightClassName,
  type StudentHighlightColor,
} from './highlightPalette';
import { MAX_HIGHLIGHT_RANGES } from './highlightV2Engine';
import { usePersistedHighlightRangesV2 } from './highlightV2Persistence';
import { useHighlightSelectionManager } from './highlightSelectionManager';
import { useHighlightSelectionPort } from './highlightSelectionPort';
import { createHighlight, eraseHighlight } from './highlight/highlightCommandService';
import { renderSurfaceHighlights } from './highlight/renderAdapter';
import type { StudentHighlightToolMode } from './providers/StudentUIProvider';


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
  announce: string;
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
  const surfaceInstanceId = useId();
  const instanceIdRef = useRef(`surface:${surfaceInstanceId}`);
  const manager = useHighlightSelectionManager();
  const selectionPort = useHighlightSelectionPort();
  const activeSurfaceId = manager?.activeSurfaceId ?? null;
  const ownsGlobalSelection = !manager || activeSurfaceId === null || activeSurfaceId === instanceIdRef.current;
  const canonicalText = useMemo(() => extractCanonicalTextFromHtml(baseHtml), [baseHtml]);
  const { ranges, setRanges } = usePersistedHighlightRangesV2(surfaceId, canonicalText);
  const [hint, setHint] = useState<string | null>(null);
  // S1-C10: SR announcements for highlight/erase/limit outcomes; rendered by
  // HighlightableSurface in an sr-only role=status node (header pattern).
  const [announce, setAnnounce] = useState('');
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
      setAnnounce('Highlight erased.');
    } else {
      const next = createHighlight(ranges, snapshot.selection, resolvedHighlightColor, MAX_HIGHLIGHT_RANGES);
      if (next.limitReached) {
        setHint('You reached the highlight limit for this text section.');
        setAnnounce('Highlight limit reached for this text section.');
        manager?.releaseSurface(instanceIdRef.current);
        return true;
      }
      setRanges(next.ranges);
      setAnnounce(`Highlighted with ${resolvedHighlightColor}.`);
    }
    selectionPort.clearSelection();
    manager?.releaseSurface(instanceIdRef.current);
    return true;
  }, [enabled, manager, ownsGlobalSelection, ranges, resolvedHighlightColor, selectionPort, setRanges, toolMode]);

  // S1-C9: Alt+H applies the highlight tool to the OS text selection inside
  // this surface (keyboard path for users who cannot drag-select). The
  // container itself is tabIndex=0 (see HighlightableSurface) so the keydown
  // is reachable; window.getSelection() supplies the completed selection.
  // Document-level binding (filtered by activeElement containment) so the
  // shortcut works even if the ref was not yet attached when the effect ran.
  useEffect(() => {
    if (!enabled || toolMode === 'off') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      if (typeof event.key !== 'string' || event.key.toLowerCase() !== 'h') return;
      const container = containerRef.current;
      if (!container) return;
      const active = document.activeElement;
      if (!active || (active !== container && !container.contains(active))) return;
      const selection = typeof window === 'undefined' ? null : window.getSelection();
      if (!selection || selection.isCollapsed) return;
      // Only handle selections anchored in this surface.
      const anchor = selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode?.parentElement ?? null;
      const focus = selection.focusNode instanceof Element
        ? selection.focusNode
        : selection.focusNode?.parentElement ?? null;
      if ((anchor && !container.contains(anchor)) || (focus && !container.contains(focus))) return;
      event.preventDefault();
      processCompletedSelection();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, processCompletedSelection, toolMode]);

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
    announce,
  };
}
