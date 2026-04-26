import React, { useMemo, useRef } from 'react';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { applySelectionHighlight, escapeHtml } from './highlightSelection';
import { getStudentHighlightClassName, type StudentHighlightColor } from './highlightPalette';
import { usePersistedStudentHighlightHtml } from './highlightPersistence';

interface RichTextHighlighterProps {
  content: string;
  contentType?: 'html' | 'text';
  enabled: boolean;
  as?: 'div' | 'p' | 'span';
  className?: string | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
  highlightPersistenceKey?: string | undefined;
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

  const handleSelection = () => {
    if (!enabled) {
      return;
    }

    const container = containerRef.current;
    const selection = window.getSelection();
    if (!container || !selection) {
      return;
    }

    const nextHtml = applySelectionHighlight(
      container,
      selection,
      highlightClassName ??
        (highlightColor ? getStudentHighlightClassName(highlightColor) : 'rounded-sm bg-yellow-200/80 px-0.5 text-gray-900'),
    );

    if (nextHtml) {
      setHtml(nextHtml);
    }
  };

  return (
    <Tag
      ref={containerRef as any}
      className={className}
      onMouseUp={enabled ? handleSelection : undefined}
      onKeyUp={enabled ? handleSelection : undefined}
      onTouchEnd={enabled ? handleSelection : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
