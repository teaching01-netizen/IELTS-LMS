import React, { useMemo, useRef } from 'react';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import {
  escapeHtml,
} from './highlightSelection';
import { type StudentHighlightColor } from './highlightPalette';
import { usePersistedStudentHighlightHtml } from './highlightPersistence';
import { useStudentHighlightInteractions } from './useStudentHighlightInteractions';

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
  const {
    handleSelection,
    handleMouseDown,
    handleManualSelection,
    handleMouseUp,
    removeTappedHighlight,
    startTouchSelectionSession,
    scheduleSelectionHighlight,
    highlightPolicyHint,
  } = useStudentHighlightInteractions({
    enabled,
    containerRef,
    highlightClassName,
    highlightColor,
    onHtmlChange: setHtml,
  });

  return (
    <>
      <Tag
        ref={containerRef as any}
        className={className}
        data-student-highlightable="true"
        style={{ WebkitUserSelect: 'text', userSelect: 'text', touchAction: 'auto' }}
        onClick={removeTappedHighlight}
        onMouseDown={enabled && !showHighlightButton ? handleMouseDown : undefined}
        onMouseUp={enabled && !showHighlightButton ? handleMouseUp : undefined}
        onTouchStart={enabled && !showHighlightButton ? startTouchSelectionSession : undefined}
        onTouchEnd={enabled && !showHighlightButton ? scheduleSelectionHighlight : undefined}
        onKeyUp={enabled ? handleSelection : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {enabled && showHighlightButton ? (
        <button
          type="button"
          onClick={handleManualSelection}
          className="mt-2 inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 shadow-sm"
        >
          {highlightButtonLabel}
        </button>
      ) : null}
      {highlightPolicyHint ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-[85] flex justify-center px-4"
        >
          <div className="rounded-sm border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 shadow-md">
            {highlightPolicyHint}
          </div>
        </div>
      ) : null}
    </>
  );
}
