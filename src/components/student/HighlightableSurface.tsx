import React, { useMemo } from 'react';
import type { RefObject } from 'react';
import { SelectionOverlay, type SelectionOverlaySelection } from '@shared/ui/selection-v2/react/SelectionOverlay';
import type { StudentHighlightToolMode } from './providers/StudentUIProvider';

interface HighlightableSurfaceProps {
  as: 'div' | 'p' | 'span';
  className?: string | undefined;
  html: string;
  containerRef?: RefObject<HTMLElement | null> | undefined;
  hint?: string | null | undefined;
  suppressTouchCallout?: boolean | undefined;
  highlightSelectionColor?: string | undefined;
  highlightToolMode?: StudentHighlightToolMode | undefined;
  announce?: string | null | undefined;
  /**
   * The selection this surface owns, if the session declared one.
   *
   * Geometry and state only — this component never resolves a caret, measures a
   * range, or decides what a selection means. It paints what the engine measured
   * and reports the intents the engine asked for.
   */
  selection?: SelectionOverlaySelection | null | undefined;
}

export function HighlightableSurface({
  as,
  className,
  html,
  containerRef,
  hint = null,
  suppressTouchCallout = false,
  highlightSelectionColor,
  highlightToolMode = 'off',
  announce = null,
  selection = null,
}: HighlightableSurfaceProps) {
  const Tag = as as any;
  // If this object identity changes on every render, React may re-apply innerHTML
  // even when the string is unchanged, which can blow away the browser's current
  // text selection (blue highlight) when the toolbar toggles visibility.
  const innerHtml = useMemo(() => ({ __html: html }), [html]);
  // Gesture policy is NOT declared here — neither `user-select` nor
  // `touch-action`. Both are owned by the stylesheet (index.css), which is the
  // only place that can also see whether a locked exam is active. A touch pointer
  // on an enabled student exam surface sets the app-owner marker, which suppresses
  // native selection; an armed highlight tool also declares `touch-action: pan-y`
  // before the gesture. Pointer media queries do not decide ownership. An inline
  // `auto` here would outrank the stylesheet and let the browser take the gesture
  // back with its own panning.
  const surfaceStyle: React.CSSProperties = {
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
        data-student-highlight-armed={highlightToolMode !== 'off' ? 'true' : undefined}
        data-student-question-callout-protected={suppressTouchCallout ? 'true' : undefined}
        style={surfaceStyle}
        // S1-C9: highlightable copy is keyboard-focusable so the Alt+H
        // shortcut (see useHighlightSurfaceV2) and SR users can reach it.
        tabIndex={0}
        aria-label={highlightToolMode === 'erase'
          ? 'Highlightable text. Select text to erase its highlights, or press Alt+H to erase highlights in the current selection.'
          : highlightToolMode === 'highlight'
            ? 'Highlightable text. Select text to highlight, or press Alt+H to highlight the current selection.'
            : 'Highlightable text. Turn on Highlight or Erase to mark or clear selected text.'}
        dangerouslySetInnerHTML={innerHtml}
      />
      {/* S1-C10: polite mode announcer, mirroring the StudentHeader highlight
        mode status node — aria-live alone with role=status announces tool
        results (highlight/erase/limit) without a second status role. */}
      <span className="sr-only" role="status" aria-live="polite">
        {announce ?? ''}
      </span>
      {/* An owned selection has no browser selection behind it, so the surface
          paints the lines itself — otherwise a student dragging across text would
          see nothing at all until the mark appeared. Handles and the magnifier
          come with it; IELTS applies the armed tool on release. */}
      {selection ? (
        <SelectionOverlay
          selection={selection}
          selectionColor={highlightToolMode === 'erase'
            ? 'rgba(100, 116, 139, 0.25)'
            : highlightSelectionColor ? `color-mix(in srgb, ${highlightSelectionColor} 45%, transparent)` : undefined}
          loupe={containerRef ? { sourceRef: containerRef } : undefined}
        />
      ) : null}
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
