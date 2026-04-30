import React, { useCallback, useMemo, useRef } from 'react';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import {
  applyHighlightFromSnapshot,
  applySelectionHighlight,
  escapeHtml,
  removeHighlightAtIndex,
  type HighlightSelectionSnapshot,
} from './highlightSelection';
import { getStudentHighlightClassName, type StudentHighlightColor } from './highlightPalette';
import { usePersistedStudentHighlightHtml } from './highlightPersistence';
import { useDeferredSelectionHighlight } from './useDeferredSelectionHighlight';

interface RichTextHighlighterProps {
  content: string;
  contentType?: 'html' | 'text';
  enabled: boolean;
  as?: 'div' | 'p' | 'span';
  className?: string | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
  highlightPersistenceKey?: string | undefined;
  showHighlightButton?: boolean | undefined;
  highlightButtonLabel?: string | undefined;
}

export function RichTextHighlighter({
  content,
  contentType = 'text',
  enabled,
  as = 'div',
  className,
  highlightColor,
  highlightClassName,
  highlightPersistenceKey,
  showHighlightButton = false,
  highlightButtonLabel = 'Highlight selected text',
}: RichTextHighlighterProps) {
  const Tag = as as any;
  const containerRef = useRef<HTMLElement | null>(null);
  const initialHtml = useMemo(
    () => (contentType === 'html' ? sanitizeHtml(content) : escapeHtml(content)),
    [content, contentType],
  );
  const { html, setHtml } = usePersistedStudentHighlightHtml(
    initialHtml,
    highlightPersistenceKey,
  );

  const handleSelection = useCallback(() => {
    if (!enabled) {
      return false;
    }

    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection) {
      return false;
    }

    const nextHtml = applySelectionHighlight(
      container,
      selection,
      highlightClassName ??
        (highlightColor ? getStudentHighlightClassName(highlightColor) : 'rounded-sm bg-yellow-200/80 text-gray-900'),
    );

    if (nextHtml) {
      setHtml(nextHtml);
      return true;
    }

    return false;
  }, [enabled, highlightClassName, highlightColor, setHtml]);
  const applySelectionFromSnapshot = useCallback(
    (snapshot: HighlightSelectionSnapshot) => {
      if (!enabled) {
        return false;
      }

      const container = containerRef.current;
      if (!container) {
        return false;
      }

      const nextHtml = applyHighlightFromSnapshot(
        container,
        snapshot,
        highlightClassName ??
          (highlightColor ? getStudentHighlightClassName(highlightColor) : 'rounded-sm bg-yellow-200/80 text-gray-900'),
      );

      if (!nextHtml) {
        return false;
      }

      setHtml(nextHtml);
      window.getSelection()?.removeAllRanges();
      return true;
    },
    [enabled, highlightClassName, highlightColor, setHtml],
  );
  const { isWithinRecentTouchAutoApplyGuard, startTouchSelectionSession, scheduleSelectionHighlight } =
    useDeferredSelectionHighlight({
    enabled,
    containerRef,
    applySelection: handleSelection,
    applySelectionFromSnapshot,
    });

  const removeTappedHighlight = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }
      if (isWithinRecentTouchAutoApplyGuard()) {
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
        setHtml(nextHtml);
      }
    },
    [enabled, isWithinRecentTouchAutoApplyGuard, setHtml],
  );

  return (
    <>
      <Tag
        ref={containerRef as any}
        className={className}
        data-student-highlightable="true"
        style={enabled ? { WebkitUserSelect: 'text', userSelect: 'text', touchAction: 'auto' } : undefined}
        onClick={removeTappedHighlight}
        onMouseUp={enabled && !showHighlightButton ? handleSelection : undefined}
        onTouchStart={enabled && !showHighlightButton ? startTouchSelectionSession : undefined}
        onTouchEnd={enabled && !showHighlightButton ? scheduleSelectionHighlight : undefined}
        onKeyUp={enabled ? handleSelection : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {enabled && showHighlightButton ? (
        <button
          type="button"
          onClick={handleSelection}
          className="mt-2 inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 shadow-sm"
        >
          {highlightButtonLabel}
        </button>
      ) : null}
    </>
  );
}
