import React, { useId, useMemo } from 'react';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import {
  escapeHtml,
} from './highlightSelection';
import { HighlightSelectionToolbar } from './HighlightSelectionToolbar';
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
}: RichTextHighlighterProps) {
  const Tag = as as any;
  const initialHtml = useMemo(
    () => (contentType === 'html' ? sanitizeHtml(content) : escapeHtml(content)),
    [content, contentType],
  );

  if (!enabled) {
    return (
      <Tag
        className={className}
        data-student-highlightable="true"
        style={{ WebkitUserSelect: 'text', userSelect: 'text', touchAction: 'auto' }}
        dangerouslySetInnerHTML={{ __html: initialHtml }}
      />
    );
  }

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
    selectionToolbarPosition,
  } = useHighlightSurfaceV2({
    enabled,
    surfaceId: highlightSurfaceId ?? defaultSurfaceId,
    baseHtml: initialHtml,
    highlightClassName,
    highlightColor,
  });
  return (
    <>
      <Tag
        ref={containerRef as any}
        className={className}
        data-student-highlightable="true"
        style={{ WebkitUserSelect: 'text', userSelect: 'text', touchAction: 'auto' }}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
      <HighlightSelectionToolbar
        visible={Boolean(canHighlightSelection && selectionToolbarPosition)}
        left={selectionToolbarPosition?.left ?? 0}
        top={selectionToolbarPosition?.top ?? 0}
        canEraseSelection={canEraseSelection}
        onApplyColor={(color) => applySelectionHighlight(color)}
        onEraseSelection={eraseSelectionHighlight}
      />
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
