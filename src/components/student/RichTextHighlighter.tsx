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
        (highlightColor ? getStudentHighlightClassName(highlightColor) : 'rounded-sm bg-yellow-200/80 text-gray-900'),
    );

    if (nextHtml) {
      setHtml(nextHtml);
    }
  };

  return (
    <>
      <Tag
        ref={containerRef as any}
        className={className}
        style={enabled ? { WebkitUserSelect: 'text', userSelect: 'text', touchAction: 'auto' } : undefined}
        onMouseUp={enabled && !showHighlightButton ? handleSelection : undefined}
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
