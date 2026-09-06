import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { STUDENT_TABLET_SPLIT_HIT_TARGET_WIDTH_PX } from './splitPaneDimensions';

interface StudentSplitPaneResizerProps {
  isTabletMode: boolean;
  leftWidth: number;
  /** Real pixel-clamp range in % (from useSplitPaneResize splitBounds). Falls back to 0/100. */
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
  onDividerPointerDown: (event: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) => void;
  onDividerKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  ariaLabel: string;
  testId: string;
}

export function StudentSplitPaneResizer({
  isTabletMode,
  leftWidth,
  minWidth = 0,
  maxWidth = 100,
  onDividerPointerDown,
  onDividerKeyDown,
  ariaLabel,
  testId,
}: StudentSplitPaneResizerProps) {
  const tabletOffset = STUDENT_TABLET_SPLIT_HIT_TARGET_WIDTH_PX / 2;

  return (
    <div
      onMouseDown={onDividerPointerDown}
      onTouchStart={onDividerPointerDown}
      onKeyDown={onDividerKeyDown}
      // S1-C2: min 24px hit area (w-6); slider min/max/now reflect the REAL
      // pixel clamp range so Home/End + AT match the actual drag limits.
      className={
        isTabletMode
          ? 'group absolute inset-y-0 z-20 flex w-8 cursor-col-resize touch-none items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          : 'relative hidden w-6 min-w-6 flex-shrink-0 cursor-col-resize touch-none items-center justify-center bg-gray-400 transition-colors hover:bg-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 lg:flex'
      }
      style={isTabletMode ? { left: `calc(${leftWidth}% - ${tabletOffset}px)` } : undefined}
      role="slider"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={Math.round(minWidth)}
      aria-valuemax={Math.round(maxWidth)}
      aria-valuenow={Math.round(Math.min(maxWidth, Math.max(minWidth, leftWidth)))}
      aria-valuetext={`${Math.round(leftWidth)} percent material pane, adjustable from ${Math.round(minWidth)} to ${Math.round(maxWidth)} percent`}
      tabIndex={0}
      data-testid={testId}
    >
      {isTabletMode ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-1/2 w-2 -translate-x-1/2 bg-gray-400 transition-colors group-hover:bg-gray-600"
          aria-hidden="true"
        />
      ) : null}
      <div
        className={`${isTabletMode ? 'h-16 w-8' : 'h-10 w-8'} pointer-events-none absolute z-10 flex flex-col items-center justify-center gap-0.5 border border-gray-400 bg-white shadow-sm`}
        data-testid={`${testId}-handle`}
      >
        <ArrowLeftRight size={isTabletMode ? 16 : 14} className="text-gray-600" aria-hidden="true" />
        {/* S1-C2: visible % readout so the split position is perceivable without AT. */}
        <span className="text-[9px] font-bold tabular-nums leading-none text-gray-700" aria-hidden="true">
          {Math.round(leftWidth)}%
        </span>
      </div>
    </div>
  );
}
