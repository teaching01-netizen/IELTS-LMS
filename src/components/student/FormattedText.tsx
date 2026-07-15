import React, { useId, useMemo } from 'react';
import { parseBoldMarkdown, parseRichMarkdown } from '../../utils/boldMarkdown';
import { escapeHtml } from './highlight/htmlEscape';
import { type StudentHighlightColor } from './highlightPalette';
import { HighlightableSurface } from './HighlightableSurface';
import { useHighlightSurfaceV2 } from './useHighlightSurfaceV2';
import { useOptionalStudentUI, type StudentHighlightToolMode } from './providers/StudentUIProvider';

type FormattedTextProps = {
  text: string;
  className?: string | undefined;
  as?: 'span' | 'div' | 'p';
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightToolMode?: StudentHighlightToolMode | undefined;
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
  highlightToolMode,
  highlightClassName,
  highlightSurfaceId,
  preserveInlineEmphasis = false,
}: FormattedTextProps) {
  const studentUI = useOptionalStudentUI();
  const resolvedHighlightToolMode =
    highlightToolMode ?? studentUI?.state.accessibilitySettings.highlightToolMode ?? 'off';
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
    hint,
  } = useHighlightSurfaceV2({
    enabled: highlightEnabled,
    surfaceId: highlightSurfaceId ?? defaultSurfaceId,
    baseHtml: initialHtml,
    highlightColor,
    highlightClassName,
    toolMode: resolvedHighlightToolMode,
  });
  if (highlightEnabled || renderedHtml !== initialHtml) {
    return (
      <HighlightableSurface
        as={as}
        containerRef={containerRef}
        className={classes}
        html={renderedHtml}
        hint={hint}
      />
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
