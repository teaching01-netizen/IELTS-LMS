import React, { useMemo } from 'react';
import type { RefObject } from 'react';

interface HighlightableSurfaceProps {
  as: 'div' | 'p' | 'span';
  className?: string | undefined;
  html: string;
  containerRef?: RefObject<HTMLElement | null> | undefined;
  hint?: string | null | undefined;
  suppressTouchCallout?: boolean | undefined;
}

export function HighlightableSurface({
  as,
  className,
  html,
  containerRef,
  hint = null,
  suppressTouchCallout = false,
}: HighlightableSurfaceProps) {
  const Tag = as as any;
  // If this object identity changes on every render, React may re-apply innerHTML
  // even when the string is unchanged, which can blow away the browser's current
  // text selection (blue highlight) when the toolbar toggles visibility.
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  return (
    <>
      <Tag
        ref={containerRef as any}
        className={className}
        data-student-highlightable="true"
        data-student-question-callout-protected={suppressTouchCallout ? 'true' : undefined}
        style={{ WebkitUserSelect: 'text', userSelect: 'text', touchAction: 'auto' }}
        dangerouslySetInnerHTML={innerHtml}
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
