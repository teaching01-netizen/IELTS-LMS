import React, { useId, useMemo } from 'react';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { escapeHtml } from './highlight/htmlEscape';
import { HighlightableSurface } from './HighlightableSurface';
import { defaultStudentHighlightColor, getStudentHighlightColorValue, type StudentHighlightColor } from './highlightPalette';
import { useHighlightSurfaceV2 } from './useHighlightSurfaceV2';
import { useOptionalStudentUI, type StudentHighlightToolMode } from './providers/StudentUIProvider';

interface RichTextHighlighterProps {
  content: string;
  contentType?: 'html' | 'text';
  /** Runtime-only image URLs created from authenticated ACT media downloads. */
  imageSourceOverrides?: ReadonlyMap<string, string> | undefined;
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
  imageSourceOverrides,
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
  const selectionTintColor =
    enabled && resolvedHighlightToolMode === 'highlight'
      ? getStudentHighlightColorValue(highlightColor ?? defaultStudentHighlightColor)
      : undefined;
  const initialHtml = useMemo(() => {
    if (contentType !== 'html') return escapeHtml(content);

    const sanitized = sanitizeHtml(content);
    if (!imageSourceOverrides?.size || typeof document === 'undefined') return sanitized;

    const template = document.createElement('template');
    template.innerHTML = sanitized;
    template.content.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
      const source = image.getAttribute('src') ?? '';
      const override = imageSourceOverrides.get(source);
      // Overrides are generated with URL.createObjectURL from media fetched
      // using the active ACT attempt credential; never accept arbitrary URLs.
      if (override?.startsWith('blob:')) image.setAttribute('src', override);
    });
    return template.innerHTML;
  }, [content, contentType, imageSourceOverrides]);

  const instanceId = useId();
  const defaultSurfaceId = useMemo(
    () => `rich:${instanceId}`,
    [instanceId],
  );
  const {
    containerRef,
    renderedHtml,
    hint,
    announce,
    selection,
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
      announce={announce}
      highlightSelectionColor={selectionTintColor}
      selection={selection}
    />
  );
}
