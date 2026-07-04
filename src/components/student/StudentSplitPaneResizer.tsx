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
  onDividerPointerDown: (event: ReactMouseEvent<HTMLDivElement> | ReactTouchEvent<HTMLDivElement>) => void;
  onDividerKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  ariaLabel: string;
  testId: string;
}

export function StudentSplitPaneResizer({
  isTabletMode,
  leftWidth,
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
      className={
        isTabletMode
          ? 'group absolute inset-y-0 z-20 flex w-8 cursor-col-resize touch-none items-center justify-center transition-colors'
          : 'relative hidden w-4 flex-shrink-0 cursor-col-resize touch-none items-center justify-center bg-gray-400 transition-colors hover:bg-gray-600 lg:flex'
      }
      style={isTabletMode ? { left: `calc(${leftWidth}% - ${tabletOffset}px)` } : undefined}
      role="slider"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(leftWidth)}
      aria-valuetext={`${Math.round(leftWidth)}% material pane`}
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
        className={`${isTabletMode ? 'h-16 w-8' : 'h-10 w-8'} pointer-events-none absolute z-10 flex items-center justify-center border border-gray-400 bg-white shadow-sm`}
        data-testid={`${testId}-handle`}
      >
        <ArrowLeftRight size={isTabletMode ? 16 : 14} className="text-gray-600" />
      </div>
    </div>
  );
}
