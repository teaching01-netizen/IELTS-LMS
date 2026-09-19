import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  defaultStudentHighlightColor,
  getStudentHighlightClassName,
  type StudentHighlightColor,
} from './highlightPalette';
import { MAX_HIGHLIGHT_RANGES, captureSurfaceRange, type HighlightSelectionV2 } from './highlightV2Engine';
import { useStudentExamInteractionScope } from '@shared/ui/touch-selection/StudentExamInteractionScope';
import { browserCaretResolver, useStudentTouchTextSelection } from '@shared/ui/touch-selection/useStudentTouchTextSelection';
import type { TouchSelectionRect } from '@shared/ui/touch-selection/touchSelectionRange';
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
  /** Lines of an owned touch selection, painted by the surface itself. */
  selectionRects: readonly TouchSelectionRect[];
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
  // WHO owns the selection gesture, which is not the same question as what to do
  // with it (that is `toolMode`, below). Reading it from the session's declared
  // scope rather than inferring it keeps authoring and preview on the platform's
  // own selection without this hook having to recognize them.
  const examScope = useStudentExamInteractionScope();
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

  /**
   * Apply a captured span, whoever captured it.
   *
   * The span is a span, so the browser's selection and the exam's owned touch
   * range run the same command path — including the limit, the hint, and the
   * screen-reader announcement, which a second implementation would drift from.
   */
  const applySelection = useCallback((selection: HighlightSelectionV2 | null) => {
    if (!enabled || toolMode === 'off' || !ownsGlobalSelection) return false;
    const container = containerRef.current;
    if (!container || !selection) return false;

    manager?.claimSurface(instanceIdRef.current);
    setHint(null);
    if (toolMode === 'erase') {
      setRanges(eraseHighlight(ranges, selection));
      setAnnounce('Highlight erased.');
    } else {
      const next = createHighlight(ranges, selection, resolvedHighlightColor, MAX_HIGHLIGHT_RANGES);
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

  const processCompletedSelection = useCallback(() => {
    if (!enabled || toolMode === 'off' || !ownsGlobalSelection) return false;
    const container = containerRef.current;
    if (!container) return false;

    return applySelection(selectionPort.readSelection(container).selection);
  }, [applySelection, enabled, ownsGlobalSelection, selectionPort, toolMode]);

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

  // Built once: a capability probe over `document`, not per-render state.
  const resolveCaretAtPoint = useMemo(() => browserCaretResolver(), []);

  /**
   * The owned gesture, for the sessions that declare one.
   *
   * Armed on the session's scope rather than on `toolMode`, and that separation
   * is the point: a tool says what to do with a selection, this says who makes
   * it. It runs with the tool off too, which is deliberate — the prose is
   * unselectable on a coarse pointer either way, so owning the gesture when the
   * tool is off is what keeps a student from being handed the platform's Copy /
   * Look Up bar instead; `applySelection` simply does nothing with the span.
   *
   * The whole surface is the boundary: unlike a SAT anchor, a highlight may span
   * blocks, so the only edge is the container the student is reading in.
   */
  const touchSelection = useStudentTouchTextSelection({
    enabled: enabled && examScope.ownedTouchSelection,
    rootRef: containerRef,
    resolveCaretAtPoint,
    onSelect: (range) => {
      const container = containerRef.current;
      if (!container) return;
      applySelection(captureSurfaceRange(container, range));
    },
    boundaryFor: () => containerRef.current,
  });

  return {
    containerRef,
    renderedHtml,
    hint,
    announce,
    selectionRects: touchSelection.rects,
  };
}
