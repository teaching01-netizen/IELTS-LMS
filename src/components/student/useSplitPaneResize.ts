import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { getSplitPaneBoundsPolicy } from './browserParityPolicy';
import {
  STUDENT_DESKTOP_SPLIT_DIVIDER_WIDTH_PX,
  STUDENT_TABLET_SPLIT_DIVIDER_WIDTH_PX,
} from './splitPaneDimensions';

const DEFAULT_LEFT_WIDTH = 40;

// S1-C3: persist the divider position per exam + module so a remount
// (tab switch, orientation change, re-render) restores the learner's layout
// instead of snapping back to the default. sessionStorage keeps it
// tab-scoped; values are clamped through the pixel-bounds policy on load
// and malformed values fall back to the default.
function readPersistedSplitWidth(storageKey: string, fallback: number, clamp: (value: number) => number): number {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw == null) return fallback;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(parsed);
  } catch {
    return fallback;
  }
}

function persistSplitWidth(storageKey: string, value: number): void {
  try {
    sessionStorage.setItem(storageKey, String(value));
  } catch {
    // Storage may be unavailable (private mode, disabled cookies) — the
    // in-memory state still works; persistence is best-effort.
  }
}

interface UseSplitPaneResizeOptions {
  isTabletMode: boolean;
  materialPaneWidthProperty:
    | '--reading-pane-width'
    | '--listening-pane-width'
    | '--writing-prompt-pane-width'
    | '--science-pane-width';
  answerPaneWidthProperty?: '--question-pane-width' | '--writing-editor-pane-width';
  defaultLeftWidth?: number;
  dividerMode?: 'overlay' | 'consumes-space';
  /** S1-C3: sessionStorage key for the split ratio (per exam + module). Omit to disable. */
  persistenceKey?: string | undefined;
}

function getTouchOrMouseClientX(event: MouseEvent | TouchEvent | ReactMouseEvent | ReactTouchEvent) {
  const firstTouch = 'touches' in event ? event.touches[0] : undefined;
  if ('touches' in event && !firstTouch) {
    return null;
  }

  return firstTouch ? firstTouch.clientX : (event as MouseEvent | ReactMouseEvent).clientX;
}

export function useSplitPaneResize({
  isTabletMode,
  materialPaneWidthProperty,
  answerPaneWidthProperty = '--question-pane-width',
  defaultLeftWidth = DEFAULT_LEFT_WIDTH,
  dividerMode = 'consumes-space',
  persistenceKey,
}: UseSplitPaneResizeOptions) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const dividerWidth = isTabletMode
    ? STUDENT_TABLET_SPLIT_DIVIDER_WIDTH_PX
    : STUDENT_DESKTOP_SPLIT_DIVIDER_WIDTH_PX;
  const dividerConsumesSpace = dividerMode === 'consumes-space';

  const clampWidth = useCallback(
    (nextWidth: number) => {
      const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width || window.innerWidth;
      const boundsPolicy = getSplitPaneBoundsPolicy(isTabletMode, dividerWidth, dividerConsumesSpace);
      const dividerGap = boundsPolicy.dividerConsumesSpace ? boundsPolicy.dividerWidthPx : 0;
      const minByPixels = (boundsPolicy.minMaterialWidthPx / workspaceWidth) * 100;
      const maxByPixels = 100 - ((boundsPolicy.minAnswerWidthPx + dividerGap) / workspaceWidth) * 100;
      let lowerBound = minByPixels;
      let upperBound = maxByPixels;

      if (lowerBound > upperBound) {
        lowerBound = minByPixels;
        upperBound = maxByPixels;
      }

      if (lowerBound > upperBound) {
        return defaultLeftWidth;
      }

      return Math.min(upperBound, Math.max(lowerBound, nextWidth));
    },
    [defaultLeftWidth, dividerConsumesSpace, dividerWidth, isTabletMode],
  );

  // S1-C3: lazy-init from sessionStorage so a remount (module switch,
  // orientation change) restores the learner's ratio instead of snapping
  // back to the default. Keyed per exam + module by the caller via
  // persistenceKey; values are clamped through the pixel-bounds policy.
  const [leftWidth, setLeftWidth] = useState(() =>
    persistenceKey
      ? readPersistedSplitWidth(persistenceKey, defaultLeftWidth, clampWidth)
      : defaultLeftWidth,
  );

  // S1-C3: save on change (try/catch inside the storage helper).
  useEffect(() => {
    if (persistenceKey) {
      persistSplitWidth(persistenceKey, leftWidth);
    }
  }, [leftWidth, persistenceKey]);

  const handleDrag = useCallback(
    (event: ReactMouseEvent | ReactTouchEvent) => {
      event.preventDefault();

      const handlePointerMove = (moveEvent: MouseEvent | TouchEvent) => {
        if (moveEvent.cancelable) {
          moveEvent.preventDefault();
        }

        const clientX = getTouchOrMouseClientX(moveEvent);
        const workspaceRect = workspaceRef.current?.getBoundingClientRect();
        if (clientX === null || !workspaceRect || workspaceRect.width <= 0) {
          return;
        }

        const nextWidth = ((clientX - workspaceRect.left) / workspaceRect.width) * 100;
        setLeftWidth(clampWidth(nextWidth));
      };

      const handlePointerUp = () => {
        document.removeEventListener('mousemove', handlePointerMove);
        document.removeEventListener('mouseup', handlePointerUp);
        document.removeEventListener('touchmove', handlePointerMove);
        document.removeEventListener('touchend', handlePointerUp);
      };

      document.addEventListener('mousemove', handlePointerMove);
      document.addEventListener('mouseup', handlePointerUp);
      document.addEventListener('touchmove', handlePointerMove, { passive: false });
      document.addEventListener('touchend', handlePointerUp);
    },
    [clampWidth],
  );

  const handleKeyboardResize = useCallback(
    (event: ReactKeyboardEvent) => {
      const step = event.shiftKey ? 10 : 5;
      const keyDeltas: Record<string, number> = {
        ArrowLeft: -step,
        ArrowDown: -step,
        ArrowRight: step,
        ArrowUp: step,
      };
      const delta = keyDeltas[event.key];

      if (typeof delta === 'number') {
        event.preventDefault();
        setLeftWidth((currentWidth) => clampWidth(currentWidth + delta));
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        setLeftWidth(clampWidth(0));
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        setLeftWidth(clampWidth(100));
      }
    },
    [clampWidth],
  );

  // S1-C2: real pixel-clamp range expressed in % for the slider semantics.
  // Mirrors clampWidth math so aria-valuemin/max/now always reflect the actual
  // draggable range for the current container width.
  const splitBounds = useMemo(() => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width || (typeof window !== 'undefined' ? window.innerWidth : 1000);
    const boundsPolicy = getSplitPaneBoundsPolicy(isTabletMode, dividerWidth, dividerConsumesSpace);
    const dividerGap = boundsPolicy.dividerConsumesSpace ? boundsPolicy.dividerWidthPx : 0;
    const min = (boundsPolicy.minMaterialWidthPx / workspaceWidth) * 100;
    const max = 100 - ((boundsPolicy.minAnswerWidthPx + dividerGap) / workspaceWidth) * 100;
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    return { min: Math.round(lower * 10) / 10, max: Math.round(upper * 10) / 10 };
    // leftWidth intentionally excluded: bounds describe the container, not the value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dividerConsumesSpace, dividerWidth, isTabletMode, leftWidth]);

  const splitPaneStyle = useMemo(
    () =>
      ({
        [materialPaneWidthProperty]: `${leftWidth}%`,
        [answerPaneWidthProperty]: dividerConsumesSpace
          ? `calc(${100 - leftWidth}% - var(--split-divider-width))`
          : `calc(${100 - leftWidth}%)`,
        ['--split-divider-width' as string]: `${dividerWidth}px`,
      }) as CSSProperties,
    [answerPaneWidthProperty, dividerConsumesSpace, dividerWidth, leftWidth, materialPaneWidthProperty],
  );
  const answerWidth = 100 - leftWidth;
  const materialCompact = isTabletMode ? leftWidth < 46 : leftWidth < 38;
  const answerCompact = isTabletMode ? answerWidth < 50 : answerWidth < 40;

  return {
    answerCompact,
    handleDrag,
    handleKeyboardResize,
    leftWidth,
    materialCompact,
    splitBounds,
    splitPaneStyle,
    workspaceRef,
  };
}
