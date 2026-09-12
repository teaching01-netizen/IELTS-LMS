import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { STUDENT_TABLET_SPLIT_HIT_TARGET_WIDTH_PX } from './splitPaneDimensions';

export interface StudentSplitResizeCommands {
  /** Make the material pane 5% narrower. */
  narrower: () => void;
  /** Make the material pane 5% wider. */
  wider: () => void;
  /** Restore the equal 50/50 split. */
  reset: () => void;
}

interface StudentSplitPaneResizerProps {
  isTabletMode: boolean;
  leftWidth: number;
  /** Real pixel-clamp range in % (from useSplitPaneResize splitBounds). Falls back to 0/100. */
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
  /** Name of the pane this separator controls (aria-controls target id). */
  controlsId?: string | undefined;
  onDividerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDividerPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDividerPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDividerKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Keyboard/drag-free resize actions (P2.4 resize menu). */
  resizeCommands?: StudentSplitResizeCommands | undefined;
  ariaLabel: string;
  testId: string;
}

/**
 * P2.4 — labeled window separator for the material pane.
 *
 * Pointer Events with pointer capture replace the old mouse/touch document
 * listeners: pointerdown starts and captures, pointermove schedules the
 * ratio, pointerup/pointercancel/lostpointercapture end the gesture with the
 * last valid layout. Keyboard adjusts 2% per arrow press (5% with Shift);
 * Home/End reach the valid bounds. A visible-on-focus/touch resize menu
 * (narrower/wider/reset) provides a drag-free alternative for keyboard and
 * touch users; its buttons keep focus order without requiring hover.
 */
export function StudentSplitPaneResizer({
  isTabletMode,
  leftWidth,
  minWidth = 0,
  maxWidth = 100,
  controlsId,
  onDividerPointerDown,
  onDividerPointerMove,
  onDividerPointerEnd,
  onDividerKeyDown,
  resizeCommands,
  ariaLabel,
  testId,
}: StudentSplitPaneResizerProps) {
  const tabletOffset = STUDENT_TABLET_SPLIT_HIT_TARGET_WIDTH_PX / 2;
  // Touch users cannot hover, so the menu opens on tap (pointerdown), and
  // keyboard users get it on focus. It stays mounted once revealed.
  const [menuRevealed, setMenuRevealed] = useState(false);
  const revealMenu = () => setMenuRevealed(true);

  return (
    <div
      onPointerDown={(event) => {
        revealMenu();
        onDividerPointerDown(event);
      }}
      onPointerMove={onDividerPointerMove}
      onPointerUp={onDividerPointerEnd}
      onPointerCancel={onDividerPointerEnd}
      onLostPointerCapture={onDividerPointerEnd}
      onFocus={revealMenu}
      onKeyDown={onDividerKeyDown}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-controls={controlsId}
      aria-valuemin={Math.round(minWidth)}
      aria-valuemax={Math.round(maxWidth)}
      aria-valuenow={Math.round(Math.min(maxWidth, Math.max(minWidth, leftWidth)))}
      aria-valuetext={`${Math.round(leftWidth)} percent material pane, adjustable from ${Math.round(minWidth)} to ${Math.round(maxWidth)} percent`}
      tabIndex={0}
      data-testid={testId}
      className={
        isTabletMode
          ? 'group absolute inset-y-0 z-20 flex w-8 cursor-col-resize touch-none items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          : 'relative flex w-2.5 min-w-2.5 flex-shrink-0 cursor-col-resize touch-none items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
      }
      style={isTabletMode ? { left: `calc(${leftWidth}% - ${tabletOffset}px)` } : undefined}
    >
      {/* Quiet 1-2px line within the rail (design contract). */}
      <div
        className={
          isTabletMode
            ? 'pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-gray-400 transition-colors group-hover:bg-gray-600'
            : 'pointer-events-none h-full w-px bg-gray-300 transition-colors group-hover:bg-gray-600'
        }
        aria-hidden="true"
      />
      {/* Grip + % readout occupy an overlay so it cannot move pane content. */}
      <div
        className={`${isTabletMode ? 'h-16 w-8' : 'h-12 w-8'} pointer-events-none absolute z-10 hidden flex-col items-center justify-center gap-0.5 rounded-sm border border-gray-400 bg-white shadow-sm group-focus-within:flex group-hover:flex`}
        data-testid={`${testId}-handle`}
      >
        <ArrowLeftRight size={isTabletMode ? 16 : 14} className="text-gray-600" aria-hidden="true" />
        <span className="text-[9px] font-bold tabular-nums leading-none text-gray-700" aria-hidden="true">
          {Math.round(leftWidth)}%
        </span>
      </div>
      {/* Drag-free resize menu for keyboard/touch users (P2.4). Rendered in
          a static overlay so opening it never shifts pane content. */}
      {resizeCommands && menuRevealed ? (
        <div
          className={`${isTabletMode ? 'left-1/2 top-1/2 -translate-x-1/2 translate-y-4' : 'left-1/2 top-1/2 -translate-x-1/2 translate-y-5'} absolute z-30 flex w-max flex-col gap-1 rounded-sm border border-gray-400 bg-white p-1 shadow-md`}
          data-testid={`${testId}-menu`}
          role="group"
          aria-label={`${ariaLabel} resize actions`}
          onPointerDown={(event) => {
            // Menu interactions must not start a separator drag gesture.
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-left text-xs font-semibold text-gray-900 transition-colors hover:bg-gray-100"
            onClick={() => {
              resizeCommands.narrower();
            }}
          >
            Material narrower
          </button>
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-left text-xs font-semibold text-gray-900 transition-colors hover:bg-gray-100"
            onClick={() => {
              resizeCommands.wider();
            }}
          >
            Material wider
          </button>
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-left text-xs font-semibold text-gray-900 transition-colors hover:bg-gray-100"
            onClick={() => {
              resizeCommands.reset();
            }}
          >
            Reset split
          </button>
        </div>
      ) : null}
    </div>
  );
}
