import React, { useMemo, useRef } from 'react';
import { parseBoldMarkdown } from '../../utils/boldMarkdown';
import { applySelectionHighlight, escapeHtml } from './highlightSelection';
import { getStudentHighlightClassName, type StudentHighlightColor } from './highlightPalette';
import { usePersistedStudentHighlightHtml } from './highlightPersistence';

type FormattedTextProps = {
  text: string;
  className?: string | undefined;
  as?: 'span' | 'div' | 'p';
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
  highlightPersistenceKey?: string | undefined;
};

export function FormattedText({
  text,
  className,
  as = 'span',
  highlightEnabled = false,
  highlightColor,
  highlightClassName,
  highlightPersistenceKey,
}: FormattedTextProps) {
  const Tag = as as any;
  const segments = useMemo(() => parseBoldMarkdown(text), [text]);
  const classes = ['whitespace-pre-wrap', 'break-words', className].filter(Boolean).join(' ');
  const containerRef = useRef<HTMLElement | null>(null);
  const initialHtml = useMemo(
    () =>
      segments
        .map((segment) => (segment.bold ? `<strong>${escapeHtml(segment.text)}</strong>` : escapeHtml(segment.text)))
        .join(''),
    [segments],
  );
  const { html, setHtml, hasPersistedHtml } = usePersistedStudentHighlightHtml(
    initialHtml,
    highlightPersistenceKey,
  );

  const handleSelection = () => {
    if (!highlightEnabled) {
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

  if (highlightEnabled || hasPersistedHtml) {
    return (
      <Tag
        ref={containerRef as any}
        className={classes}
        onMouseUp={highlightEnabled ? handleSelection : undefined}
        onKeyUp={highlightEnabled ? handleSelection : undefined}
        onTouchEnd={highlightEnabled ? handleSelection : undefined}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <Tag className={classes}>
      {segments.map((segment, index) =>
        segment.bold ? (
          <strong key={index} className="font-bold">
            {segment.text}
          </strong>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </Tag>
  );
}
