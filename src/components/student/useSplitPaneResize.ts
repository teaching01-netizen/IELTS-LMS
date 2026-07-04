import { useCallback, useMemo, useRef, useState } from 'react';
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

interface UseSplitPaneResizeOptions {
  isTabletMode: boolean;
  materialPaneWidthProperty: '--reading-pane-width' | '--listening-pane-width' | '--writing-prompt-pane-width';
  answerPaneWidthProperty?: '--question-pane-width' | '--writing-editor-pane-width';
  defaultLeftWidth?: number;
  dividerMode?: 'overlay' | 'consumes-space';
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
}: UseSplitPaneResizeOptions) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
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
    splitPaneStyle,
    workspaceRef,
  };
}
