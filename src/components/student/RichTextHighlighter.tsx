import React, { useId, useMemo } from 'react';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import {
  escapeHtml,
} from './highlightSelection';
import { HighlightableSurface } from './HighlightableSurface';
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
  const initialHtml = useMemo(
    () => (contentType === 'html' ? sanitizeHtml(content) : escapeHtml(content)),
    [content, contentType],
  );

  if (!enabled) {
    return (
      <HighlightableSurface
        as={as}
        className={className}
        html={initialHtml}
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
    <HighlightableSurface
      as={as}
      containerRef={containerRef}
      className={className}
      html={renderedHtml}
      showToolbar={canHighlightSelection}
      toolbarPosition={selectionToolbarPosition}
      canEraseSelection={canEraseSelection}
      onApplyColor={applySelectionHighlight}
      onEraseSelection={eraseSelectionHighlight}
      hint={hint}
    />
  );
}
