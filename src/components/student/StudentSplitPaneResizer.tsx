import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { STUDENT_SPLIT_RAIL_WIDTH_PX } from './layout/studentLayoutMode';
import {
  STUDENT_SPLIT_DRAG_START_THRESHOLD_PX,
  STUDENT_SPLIT_HINT_DELAY_MS,
  STUDENT_SPLIT_POINTER_HIT_TARGET_WIDTH_PX,
  STUDENT_SPLIT_TOUCH_HIT_TARGET_WIDTH_PX,
  STUDENT_SPLIT_TOUCH_INTENT_THRESHOLD_PX,
  STUDENT_TABLET_SPLIT_HIT_TARGET_WIDTH_PX,
} from './splitPaneDimensions';

export interface StudentSplitResizeCommands {
  /** Make the material pane 5% narrower. */
  narrower: () => void;
  /** Make the material pane 5% wider. */
  wider: () => void;
  /** Restore the recommended split. */
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
  /** Keyboard/pointer-free resize actions, surfaced through the context menu. */
  resizeCommands?: StudentSplitResizeCommands | undefined;
  ariaLabel: string;
  testId: string;
}

type SplitInteraction = 'rest' | 'hover' | 'pressed' | 'dragging';

/** The "Drag to resize" hint is taught once per app session, then never again. */
let splitterHintShownThisSession = false;

const menuItemClassName =
  'w-full rounded-sm px-2 py-1 text-left text-xs font-semibold text-gray-900 transition-colors duration-[90ms] ease-out hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700';

const hintClassName =
  'pointer-events-none absolute left-1/2 top-[calc(50%+2.25rem)] z-30 w-max -translate-x-1/2 rounded-sm border border-gray-300 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 shadow-sm';

/**
 * P2.4 — the seam between the material pane and the question pane.
 *
 * The divider is a directly manipulated spatial control, not a button:
 *
 *   REST → hover → grab → drag → release
 *
 * A quiet persistent grabber advertises that the line can move, while the
 * real hit target is far wider than the hairline (24px pointer, 44px touch)
 * so students never have to aim. Dragging resizes continuously; nothing
 * animates while the pointer is down. Double-click (or Enter, from
 * `useSplitPaneResize`) restores the recommended split, and the narrower/
 * wider/reset commands moved off primary click onto the context menu so a
 * plain click only focuses the separator.
 *
 * Keyboard is first-class: the separator is tabbable and hands
 * arrow/Home/End/Enter to the resize hook.
 *
 * Touch is a different interaction model, not a bigger hit target. The
 * grabbable zone is 48pt wide and the grip grows slightly under a finger; but
 * nothing resizes until the pointer has travelled far enough for its intent
 * to be legible. At that moment the dominant axis decides: mostly horizontal
 * engages the splitter (re-anchored so the divider does not jump), mostly
 * vertical is handed back to native scrolling. Once engaged the gesture stays
 * locked to the splitter until release, so a wobbly finger cannot turn a
 * deliberate resize into a page scroll.
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
  // Invisible overlay widths: the rail keeps its layout width while the
  // grabbable area grows to the pointer/touch target.
  const hitAreaInset = isTabletMode
    ? (STUDENT_SPLIT_TOUCH_HIT_TARGET_WIDTH_PX - STUDENT_TABLET_SPLIT_HIT_TARGET_WIDTH_PX) / 2
    : (STUDENT_SPLIT_POINTER_HIT_TARGET_WIDTH_PX - STUDENT_SPLIT_RAIL_WIDTH_PX) / 2;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    pointerType: string;
    /** Touch waits for the direction to be decided before it resizes. */
    engaged: boolean;
  } | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [interaction, setInteraction] = useState<SplitInteraction>('rest');
  const [menuOpen, setMenuOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [touchGestureActive, setTouchGestureActive] = useState(false);

  const clearHintTimer = useCallback(() => {
    if (hintTimerRef.current !== null) {
      clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearHintTimer, [clearHintTimer]);

  // The context menu is the only place the resize commands live; focus moves
  // into it when it opens so keyboard users can act on it immediately.
  useEffect(() => {
    if (menuOpen) {
      firstMenuItemRef.current?.focus();
    }
    if (!menuOpen) {
      return;
    }
    const handleDocumentPointerDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  }, [menuOpen]);

  const scheduleHint = (pointerType: string) => {
    if (pointerType === 'touch' || splitterHintShownThisSession || hintTimerRef.current !== null) {
      return;
    }
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = null;
      // One appearance only: once the student has seen it, it is visual noise.
      splitterHintShownThisSession = true;
      setHintVisible(true);
    }, STUDENT_SPLIT_HINT_DELAY_MS);
  };

  const releasePointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // jsdom and detached nodes lack pointer capture; nothing to release.
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Secondary clicks open the context menu instead of starting a gesture.
    if (event.button !== 0) {
      return;
    }
    const pointerType = event.pointerType || 'mouse';
    const isTouch = pointerType === 'touch';
    setMenuOpen(false);
    setInteraction('pressed');
    setTouchGestureActive(isTouch);
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pointerType,
      // A mouse or pen has a cursor and a fine point, so it engages at once.
      engaged: !isTouch,
    };
    onDividerPointerDown(event);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      // Only the gesture this separator started can move the seam.
      return;
    }
    const travelX = event.clientX - gesture.startX;
    const travelY = event.clientY - gesture.startY;
    const absX = Math.abs(travelX);
    const absY = Math.abs(travelY);

    if (!gesture.engaged) {
      // Undecided: the first couple of pixels mean nothing yet, so the split
      // stays exactly where it is.
      if (
        absX < STUDENT_SPLIT_TOUCH_INTENT_THRESHOLD_PX &&
        absY < STUDENT_SPLIT_TOUCH_INTENT_THRESHOLD_PX
      ) {
        return;
      }
      if (absY > absX) {
        // Vertical intent belongs to the panes: hand the gesture back to
        // native scrolling and leave the layout untouched.
        gestureRef.current = null;
        setTouchGestureActive(false);
        setInteraction('rest');
        releasePointerCapture(event);
        onDividerPointerEnd(event);
        return;
      }
      // Horizontal intent: engage, re-anchoring the drag at the recognition
      // point so the divider never jumps by the recognition distance.
      gesture.engaged = true;
      setInteraction('dragging');
      onDividerPointerEnd(event);
      onDividerPointerDown(event);
      return;
    }

    if (
      interaction === 'pressed' &&
      Math.max(absX, absY) >= STUDENT_SPLIT_DRAG_START_THRESHOLD_PX
    ) {
      setInteraction('dragging');
    }
    onDividerPointerMove(event);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current && gestureRef.current.pointerId !== event.pointerId) {
      return;
    }
    const pointerType = gestureRef.current?.pointerType ?? event.pointerType;
    gestureRef.current = null;
    setTouchGestureActive(false);
    setInteraction(pointerType === 'touch' ? 'rest' : 'hover');
    onDividerPointerEnd(event);
  };

  const handlePointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.pointerType || 'mouse') === 'touch') {
      return;
    }
    setInteraction((current) => (current === 'rest' ? 'hover' : current));
    scheduleHint(event.pointerType || 'mouse');
  };

  const handlePointerLeave = () => {
    clearHintTimer();
    setHintVisible(false);
    setInteraction((current) => (current === 'hover' ? 'rest' : current));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      setMenuOpen(true);
      return;
    }
    if (event.key === 'Escape' && menuOpen) {
      setMenuOpen(false);
      return;
    }
    onDividerKeyDown(event);
  };

  const handleDoubleClick = () => {
    if (!resizeCommands) {
      return;
    }
    setMenuOpen(false);
    resizeCommands.reset();
  };

  const active = interaction === 'pressed' || interaction === 'dragging';
  // One width and one colour class at a time, so the rendered tone never
  // depends on stylesheet ordering. Neutral grey at rest, accent only while
  // pressed/dragging/focused — blue keeps a single meaning in the exam UI.
  const lineWidthClass = active || isTabletMode ? 'w-0.5' : 'w-px';
  const lineColorClass = active
    ? 'bg-blue-700'
    : interaction === 'hover'
      ? 'bg-gray-500'
      : isTabletMode
        ? 'bg-gray-400'
        : 'bg-gray-300';
  const lineClassName = [
    'pointer-events-none absolute left-1/2 top-0 h-full -translate-x-1/2',
    'transition-[background-color,width] duration-[120ms] ease-out',
    lineWidthClass,
    lineColorClass,
    'group-focus-visible:w-0.5 group-focus-visible:bg-blue-700',
  ].join(' ');
  const grabberClassName = [
    // Touch gets a more legible grip than a fine pointer: the affordance has
    // to carry the whole message when there is no cursor to change.
    'pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-11 w-5 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[3px]',
    'pointer-coarse:h-12 pointer-coarse:w-6',
    'rounded-[10px] border bg-white',
    'transition-[transform,border-color,box-shadow] duration-[90ms] ease-out',
    active
      ? `${
          // A finger slightly grows the grip; a mouse click slightly dips it.
          // Neither bounces — exam software stays calm.
          touchGestureActive ? 'scale-[1.03]' : 'scale-[0.96]'
        } border-blue-700 shadow-[0_1px_3px_rgba(15,23,42,0.12)]`
      : interaction === 'hover'
        ? 'border-gray-400 shadow-[0_1px_3px_rgba(15,23,42,0.10)]'
        : 'border-gray-300 shadow-[0_1px_2px_rgba(15,23,42,0.06)]',
    'group-focus-visible:border-blue-700',
  ].join(' ');
  const grabberMarkClassName = [
    'h-[2px] w-2.5 rounded-full pointer-coarse:h-[2.5px] pointer-coarse:w-3.5',
    active ? 'bg-blue-700' : 'bg-gray-400',
    'transition-colors duration-[90ms] ease-out',
    'group-focus-visible:bg-blue-700',
  ].join(' ');

  return (
    <div
      ref={rootRef}
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-controls={controlsId}
      aria-valuemin={Math.round(minWidth)}
      aria-valuemax={Math.round(maxWidth)}
      aria-valuenow={Math.round(Math.min(maxWidth, Math.max(minWidth, leftWidth)))}
      aria-valuetext={`Material width, ${Math.round(leftWidth)} percent, adjustable from ${Math.round(minWidth)} to ${Math.round(maxWidth)} percent`}
      tabIndex={0}
      data-testid={testId}
      data-split-state={interaction}
      data-split-dragging={active ? 'true' : undefined}
      data-split-pointer={touchGestureActive ? 'touch' : 'fine'}
      data-split-menu-open={menuOpen ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
      className={
        isTabletMode
          ? 'group absolute inset-y-0 z-20 flex w-8 cursor-col-resize touch-pan-y select-none items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
          : 'group relative flex w-2.5 min-w-2.5 flex-shrink-0 cursor-col-resize touch-pan-y select-none items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'
      }
      style={isTabletMode ? { left: `calc(${leftWidth}% - ${tabletOffset}px)` } : undefined}
    >
      {/* Forgiving grab area: the divider is grabbable anywhere along its
          length and well beyond its hairline width. */}
      <span
        aria-hidden="true"
        data-testid={`${testId}-hit-area`}
        className="absolute inset-y-0"
        style={{ insetInline: `-${hitAreaInset}px` }}
      />
      {/* Quiet hairline: 1px at rest, 2px + accent while pressed/dragging. */}
      <span aria-hidden="true" data-testid={`${testId}-line`} className={lineClassName} />
      {/* Persistent grabber: discoverable, not distracting. */}
      <span aria-hidden="true" data-testid={`${testId}-grabber`} className={grabberClassName}>
        {[0, 1, 2].map((mark) => (
          <span key={mark} className={grabberMarkClassName} />
        ))}
      </span>
      {hintVisible ? (
        <span aria-hidden="true" data-testid={`${testId}-hint`} className={hintClassName}>
          Drag to resize
        </span>
      ) : null}
      {/* Supplementary commands for pointer power users. Primary click no
          longer opens anything — the context menu does, and keyboard users
          already have arrows/Home/End/Enter. */}
      {resizeCommands && menuOpen ? (
        <div
          data-testid={`${testId}-menu`}
          role="menu"
          tabIndex={-1}
          aria-label={`${ariaLabel} actions`}
          className="absolute left-1/2 top-1/2 z-30 flex w-max -translate-x-1/2 translate-y-6 flex-col gap-1 rounded-sm border border-gray-300 bg-white p-1 shadow-md"
          onPointerDown={(event) => {
            // Menu interactions must not start a separator drag gesture.
            event.stopPropagation();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            ref={firstMenuItemRef}
            type="button"
            role="menuitem"
            className={menuItemClassName}
            onClick={() => {
              resizeCommands.narrower();
              setMenuOpen(false);
            }}
          >
            Material narrower
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClassName}
            onClick={() => {
              resizeCommands.wider();
              setMenuOpen(false);
            }}
          >
            Material wider
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClassName}
            onClick={() => {
              resizeCommands.reset();
              setMenuOpen(false);
            }}
          >
            Reset split
          </button>
        </div>
      ) : null}
    </div>
  );
}
