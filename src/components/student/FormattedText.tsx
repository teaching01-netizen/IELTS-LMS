import React, { useId, useMemo } from 'react';
import { parseBoldMarkdown, parseRichMarkdown } from '../../utils/boldMarkdown';
import { escapeHtml } from './highlightSelection';
import { type StudentHighlightColor } from './highlightPalette';
import { HighlightSelectionToolbar } from './HighlightSelectionToolbar';
import { useHighlightSurfaceV2 } from './useHighlightSurfaceV2';

type FormattedTextProps = {
  text: string;
  className?: string | undefined;
  as?: 'span' | 'div' | 'p';
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
  highlightSurfaceId?: string | undefined;
  preserveInlineEmphasis?: boolean | undefined;
};
export function FormattedText({
  text,
  className,
  as = 'span',
  highlightEnabled = false,
  highlightColor,
  highlightClassName,
  highlightSurfaceId,
  preserveInlineEmphasis = false,
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
  const instanceId = useId();
  const defaultSurfaceId = useMemo(
    () => `formatted:${instanceId}`,
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
    enabled: highlightEnabled,
    surfaceId: highlightSurfaceId ?? defaultSurfaceId,
    baseHtml: initialHtml,
    highlightColor,
    highlightClassName,
  });
  if (highlightEnabled || renderedHtml !== initialHtml) {
    return (
      <>
        <Tag
          ref={containerRef as any}
          className={classes}
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
