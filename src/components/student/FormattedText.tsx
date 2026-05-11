import React, { useMemo, useRef } from 'react';
import { parseBoldMarkdown, parseRichMarkdown } from '../../utils/boldMarkdown';
import { escapeHtml } from './highlightSelection';
import { type StudentHighlightColor } from './highlightPalette';
import { usePersistedStudentHighlightHtml } from './highlightPersistence';
import { useStudentHighlightInteractions } from './useStudentHighlightInteractions';

type FormattedTextProps = {
  text: string;
  className?: string | undefined;
  as?: 'span' | 'div' | 'p';
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
  highlightPersistenceKey?: string | undefined;
  preserveInlineEmphasis?: boolean | undefined;
  showHighlightButton?: boolean | undefined;
  highlightButtonLabel?: string | undefined;
};
export function FormattedText({
  text,
  className,
  as = 'span',
  highlightEnabled = false,
  highlightColor,
  highlightClassName,
  highlightPersistenceKey,
  preserveInlineEmphasis = false,
  showHighlightButton = false,
  highlightButtonLabel = 'Highlight selected text',
}: FormattedTextProps) {
  const Tag = as as any;
  const shouldSplitParagraphs = as === 'div' && /\n\n/.test(text);
  const paragraphTexts = useMemo(() => {
    if (!shouldSplitParagraphs) return [text];
    return text.split(/\n\n+/).filter(Boolean);
  }, [shouldSplitParagraphs, text]);
  const paragraphSegments = useMemo(
    () =>
      paragraphTexts.map((pText) =>
        preserveInlineEmphasis ? parseRichMarkdown(pText) : parseBoldMarkdown(pText),
      ),
    [preserveInlineEmphasis, paragraphTexts],
  );
  const classes = shouldSplitParagraphs
    ? ['break-words', className].filter(Boolean).join(' ')
    : ['whitespace-pre-wrap', 'break-words', className].filter(Boolean).join(' ');
  const containerRef = useRef<HTMLElement | null>(null);
  const initialHtml = useMemo(
    () =>
      paragraphSegments
        .map((segments) => {
          const content = segments
            .map((segment) => {
              const escapedText = escapeHtml(segment.text);
              const isBold = Boolean(segment.bold);
              const isItalic = preserveInlineEmphasis ? Boolean((segment as { italic?: boolean }).italic) : false;

              if (isBold && isItalic) {
                return `<strong><em>${escapedText}</em></strong>`;
              }
              if (isBold) {
                return `<strong>${escapedText}</strong>`;
              }
              if (isItalic) {
                return `<em>${escapedText}</em>`;
              }
              return escapedText;
            })
            .join('');
          return shouldSplitParagraphs ? `<p class="whitespace-pre-wrap break-words">${content}</p>` : content;
        })
        .join(''),
    [paragraphSegments, preserveInlineEmphasis, shouldSplitParagraphs],
  );
  const { html, setHtml, hasPersistedHtml } = usePersistedStudentHighlightHtml(
    initialHtml,
    highlightPersistenceKey,
  );
  const {
    handleSelection,
    handleMouseUp,
    removeTappedHighlight,
    startTouchSelectionSession,
    scheduleSelectionHighlight,
    highlightPolicyHint,
  } = useStudentHighlightInteractions({
    enabled: highlightEnabled,
    containerRef,
    highlightClassName,
    highlightColor,
    onHtmlChange: setHtml,
  });

  if (highlightEnabled || hasPersistedHtml) {
    return (
      <>
        <Tag
          ref={containerRef as any}
          className={classes}
          data-student-highlightable="true"
          style={{ WebkitUserSelect: 'text', userSelect: 'text', touchAction: 'auto' }}
          onClick={removeTappedHighlight}
          onMouseUp={highlightEnabled && !showHighlightButton ? handleMouseUp : undefined}
          onTouchStart={highlightEnabled && !showHighlightButton ? startTouchSelectionSession : undefined}
          onTouchEnd={highlightEnabled && !showHighlightButton ? scheduleSelectionHighlight : undefined}
          onKeyUp={highlightEnabled ? handleSelection : undefined}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {highlightEnabled && showHighlightButton ? (
          <button
            type="button"
            onClick={handleSelection}
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

  const renderSegment = (
    segment: { text: string; bold: boolean; italic?: boolean },
    index: number,
  ) =>
    segment.bold ? (
      preserveInlineEmphasis && segment.italic ? (
        <strong key={index} className="font-bold">
          <em>{segment.text}</em>
        </strong>
      ) : (
        <strong key={index} className="font-bold">
          {segment.text}
        </strong>
      )
    ) : preserveInlineEmphasis && segment.italic ? (
      <em key={index}>{segment.text}</em>
    ) : (
      <React.Fragment key={index}>{segment.text}</React.Fragment>
    );

  if (shouldSplitParagraphs) {
    return (
      <Tag className={classes}>
        {paragraphSegments.map((segments, pIdx) => (
          <p key={pIdx} className="whitespace-pre-wrap break-words">
            {segments.map((segment, index) => renderSegment(segment, index))}
          </p>
        ))}
      </Tag>
    );
  }

  return (
    <Tag className={classes}>
      {paragraphSegments[0]?.map((segment, index) => renderSegment(segment, index))}
    </Tag>
  );
}
