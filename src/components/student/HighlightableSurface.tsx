import React, { useMemo } from 'react';
import type { RefObject } from 'react';

interface HighlightableSurfaceProps {
  as: 'div' | 'p' | 'span';
  className?: string | undefined;
  html: string;
  containerRef?: RefObject<HTMLElement | null> | undefined;
  hint?: string | null | undefined;
  suppressTouchCallout?: boolean | undefined;
  highlightSelectionColor?: string | undefined;
  announce?: string | null | undefined;
}

export function HighlightableSurface({
  as,
  className,
  html,
  containerRef,
  hint = null,
  suppressTouchCallout = false,
  highlightSelectionColor,
  announce = null,
}: HighlightableSurfaceProps) {
  const Tag = as as any;
  // If this object identity changes on every render, React may re-apply innerHTML
  // even when the string is unchanged, which can blow away the browser's current
  // text selection (blue highlight) when the toolbar toggles visibility.
  const innerHtml = useMemo(() => ({ __html: html }), [html]);
  const surfaceStyle: React.CSSProperties = {
    WebkitUserSelect: 'text',
    userSelect: 'text',
    touchAction: 'auto',
    ...(highlightSelectionColor
      ? ({ ['--student-highlight-selection-color' as string]: highlightSelectionColor } as React.CSSProperties)
      : {}),
  };

  return (
    <>
      <Tag
        ref={containerRef as any}
        className={className}
        data-student-highlightable="true"
        data-student-highlight-selection={highlightSelectionColor ? 'true' : undefined}
        data-student-question-callout-protected={suppressTouchCallout ? 'true' : undefined}
        style={surfaceStyle}
        // S1-C9: highlightable copy is keyboard-focusable so the Alt+H
        // shortcut (see useHighlightSurfaceV2) and SR users can reach it.
        tabIndex={0}
        aria-label="Highlightable text. Select text to highlight, or press Alt+H to highlight the current selection."
        dangerouslySetInnerHTML={innerHtml}
      />
      {/* S1-C10: polite mode announcer, mirroring the StudentHeader highlight
        mode status node — aria-live alone with role=status announces tool
        results (highlight/erase/limit) without a second status role. */}
      <span className="sr-only" role="status" aria-live="polite">
        {announce ?? ''}
      </span>
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
