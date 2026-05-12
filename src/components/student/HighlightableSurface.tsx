import React from 'react';
import type { RefObject } from 'react';
import { HighlightSelectionToolbar } from './HighlightSelectionToolbar';
import type { StudentHighlightColor } from './highlightPalette';

interface HighlightableSurfaceProps {
  as: 'div' | 'p' | 'span';
  className?: string | undefined;
  html: string;
  containerRef?: RefObject<HTMLElement | null> | undefined;
  showToolbar?: boolean | undefined;
  toolbarPosition?: { left: number; top: number } | null | undefined;
  canEraseSelection?: boolean | undefined;
  onApplyColor?: ((color: StudentHighlightColor) => void) | undefined;
  onEraseSelection?: (() => void) | undefined;
  hint?: string | null | undefined;
}

export function HighlightableSurface({
  as,
  className,
  html,
  containerRef,
  showToolbar = false,
  toolbarPosition = null,
  canEraseSelection = false,
  onApplyColor,
  onEraseSelection,
  hint = null,
}: HighlightableSurfaceProps) {
  const Tag = as as any;

  return (
    <>
      <Tag
        ref={containerRef as any}
        className={className}
        data-student-highlightable="true"
        style={{ WebkitUserSelect: 'text', userSelect: 'text', touchAction: 'auto' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <HighlightSelectionToolbar
        visible={Boolean(showToolbar && toolbarPosition && onApplyColor && onEraseSelection)}
        left={toolbarPosition?.left ?? 0}
        top={toolbarPosition?.top ?? 0}
        canEraseSelection={canEraseSelection}
        onApplyColor={(color) => onApplyColor?.(color)}
        onEraseSelection={() => onEraseSelection?.()}
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
