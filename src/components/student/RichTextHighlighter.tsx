import React, { useId, useMemo } from 'react';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { escapeHtml } from './highlight/htmlEscape';
import { HighlightableSurface } from './HighlightableSurface';
import { type StudentHighlightColor } from './highlightPalette';
import { useHighlightSurfaceV2 } from './useHighlightSurfaceV2';
import { useOptionalStudentUI, type StudentHighlightToolMode } from './providers/StudentUIProvider';

interface RichTextHighlighterProps {
  content: string;
  contentType?: 'html' | 'text';
  enabled: boolean;
  as?: 'div' | 'p' | 'span';
  className?: string | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightToolMode?: StudentHighlightToolMode | undefined;
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
  highlightToolMode,
  highlightClassName,
  highlightSurfaceId,
}: RichTextHighlighterProps) {
  const studentUI = useOptionalStudentUI();
  const resolvedHighlightToolMode =
    highlightToolMode ?? studentUI?.state.accessibilitySettings.highlightToolMode ?? 'off';
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
    hint,
  } = useHighlightSurfaceV2({
    enabled,
    surfaceId: highlightSurfaceId ?? defaultSurfaceId,
    baseHtml: initialHtml,
    highlightClassName,
    highlightColor,
    toolMode: resolvedHighlightToolMode,
  });
  return (
    <HighlightableSurface
      as={as}
      containerRef={containerRef}
      className={className}
      html={renderedHtml}
      hint={hint}
    />
  );
}
