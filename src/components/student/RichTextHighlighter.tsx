import React, { useId, useMemo } from 'react';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import {
  escapeHtml,
} from './highlightSelection';
import { type StudentHighlightColor } from './highlightPalette';
import { useHighlightSurfaceV2 } from './useHighlightSurfaceV2';

interface RichTextHighlighterProps {
  content: string;
  contentType?: 'html' | 'text';
  enabled: boolean;
  as?: 'div' | 'p' | 'span';
  className?: string | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
  highlightSurfaceId?: string | undefined;
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
  highlightSurfaceId,
  showHighlightButton = false,
  highlightButtonLabel = 'Highlight selected text',
}: RichTextHighlighterProps) {
  const Tag = as as any;
  const initialHtml = useMemo(
    () => (contentType === 'html' ? sanitizeHtml(content) : escapeHtml(content)),
    [content, contentType],
  );
  const instanceId = useId();
  const defaultSurfaceId = useMemo(
    () => `rich:${instanceId}`,
    [instanceId],
  );
  const {
    containerRef,
    renderedHtml,
    canHighlightSelection,
    canEraseSelection,
    applySelectionHighlight,
    eraseSelectionHighlight,
    hint,
  } = useHighlightSurfaceV2({
    enabled,
    surfaceId: highlightSurfaceId ?? defaultSurfaceId,
    baseHtml: initialHtml,
    highlightClassName,
    highlightColor,
  });
  const shouldShowControls =
    enabled && (showHighlightButton || canHighlightSelection || canEraseSelection);

  return (
    <>
      <Tag
        ref={containerRef as any}
        className={className}
        data-student-highlightable="true"
        style={{ WebkitUserSelect: 'text', userSelect: 'text', touchAction: 'auto' }}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
      {shouldShowControls ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={applySelectionHighlight}
            disabled={!canHighlightSelection}
            className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {highlightButtonLabel}
          </button>
          <button
            type="button"
            onClick={eraseSelectionHighlight}
            disabled={!canEraseSelection}
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            Erase selected text
          </button>
        </div>
      ) : null}
      {hint ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-[85] flex justify-center px-4"
        >
          <div className="rounded-sm border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 shadow-md">
            {hint}
          </div>
        </div>
      ) : null}
    </>
  );
}
