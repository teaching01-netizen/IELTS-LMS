import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  defaultStudentHighlightColor,
  getStudentHighlightClassName,
  type StudentHighlightColor,
} from './highlightPalette';
import {
  addHighlightRange,
  captureSurfaceSelection,
  eraseHighlightRange,
  renderHighlightedHtml,
  selectionIntersectsRanges,
  type HighlightSelectionV2,
} from './highlightV2Engine';
import { usePersistedHighlightRangesV2 } from './highlightV2Persistence';

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
}

interface UseHighlightSurfaceV2Result {
  containerRef: RefObject<HTMLElement | null>;
  renderedHtml: string;
  canHighlightSelection: boolean;
  canEraseSelection: boolean;
  applySelectionHighlight: () => void;
  eraseSelectionHighlight: () => void;
  hint: string | null;
}

export function useHighlightSurfaceV2({
  enabled,
  surfaceId,
  baseHtml,
  highlightColor,
  highlightClassName,
}: UseHighlightSurfaceV2Options): UseHighlightSurfaceV2Result {
  const containerRef = useRef<HTMLElement | null>(null);
  const canonicalText = useMemo(() => extractCanonicalTextFromHtml(baseHtml), [baseHtml]);
  const { ranges, setRanges } = usePersistedHighlightRangesV2(surfaceId, canonicalText);
  const [selection, setSelection] = useState<HighlightSelectionV2 | null>(null);
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
      return;
    }

    const container = containerRef.current;
    const browserSelection = window.getSelection();
    if (!container || !browserSelection) {
      setSelection(null);
      return;
    }

    const captured = captureSurfaceSelection(container, browserSelection, {
      enforceSingleBlock: true,
    });
    setSelection(captured);
  }, [enabled]);

  const resolveCurrentSelection = useCallback(() => {
    if (!enabled) {
      return null;
    }

    if (selection) {
      return selection;
    }

    const container = containerRef.current;
    const browserSelection = window.getSelection();
    if (!container || !browserSelection) {
      return null;
    }

    return captureSurfaceSelection(container, browserSelection, {
      enforceSingleBlock: true,
    });
  }, [enabled, selection]);

  const applySelectionHighlight = useCallback(() => {
    const activeSelection = resolveCurrentSelection();
    if (!enabled || !activeSelection) {
      return;
    }

    const next = addHighlightRange(ranges, activeSelection, resolvedHighlightColor, MAX_SURFACE_RANGES);
    if (next.limitReached) {
      setHint('You reached the highlight limit for this text section.');
      return;
    }

    setHint(null);
    setRanges(next.ranges);
  }, [enabled, ranges, resolveCurrentSelection, resolvedHighlightColor, setRanges]);

  const eraseSelectionHighlight = useCallback(() => {
    const activeSelection = resolveCurrentSelection();
    if (!enabled || !activeSelection) {
      return;
    }

    setHint(null);
    setRanges(eraseHighlightRange(ranges, activeSelection));
  }, [enabled, ranges, resolveCurrentSelection, setRanges]);

  const canEraseSelection = useMemo(() => {
    if (!selection) {
      return false;
    }

    return selectionIntersectsRanges(ranges, selection);
  }, [ranges, selection]);

  useEffect(() => {
    if (!enabled) {
      setSelection(null);
      setHint(null);
      return;
    }

    const handleSelectionChange = () => {
      refreshSelection();
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [enabled, refreshSelection]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handlePointerUp = () => {
      refreshSelection();
    };

    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchend', handlePointerUp);

    return () => {
      document.removeEventListener('mouseup', handlePointerUp);
      document.removeEventListener('touchend', handlePointerUp);
    };
  }, [enabled, refreshSelection]);

  return {
    containerRef,
    renderedHtml,
    canHighlightSelection: Boolean(enabled && selection),
    canEraseSelection,
    applySelectionHighlight,
    eraseSelectionHighlight,
    hint,
  };
}
