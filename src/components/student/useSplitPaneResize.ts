import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { getSplitPaneBoundsPolicy } from './browserParityPolicy';

const DEFAULT_LEFT_WIDTH = 40;
const TABLET_DIVIDER_WIDTH = 32;
const DESKTOP_DIVIDER_WIDTH = 16;

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
  const dividerWidth = isTabletMode ? TABLET_DIVIDER_WIDTH : DESKTOP_DIVIDER_WIDTH;
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
    leftWidth,
    materialCompact,
    splitPaneStyle,
    workspaceRef,
  };
}
