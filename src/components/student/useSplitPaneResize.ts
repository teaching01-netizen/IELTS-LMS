import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

const DEFAULT_LEFT_WIDTH = 40;
const TABLET_DIVIDER_WIDTH = 32;
const DESKTOP_DIVIDER_WIDTH = 16;
const TABLET_MIN_MATERIAL_WIDTH = 48;
const TABLET_MIN_ANSWER_WIDTH = 48;
const DESKTOP_MIN_MATERIAL_WIDTH = 300;
const DESKTOP_MIN_ANSWER_WIDTH = 320;

interface UseSplitPaneResizeOptions {
  isTabletMode: boolean;
  materialPaneWidthProperty: '--reading-pane-width' | '--listening-pane-width' | '--writing-prompt-pane-width';
  answerPaneWidthProperty?: '--question-pane-width' | '--writing-editor-pane-width';
  defaultLeftWidth?: number;
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
}: UseSplitPaneResizeOptions) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const dividerWidth = isTabletMode ? TABLET_DIVIDER_WIDTH : DESKTOP_DIVIDER_WIDTH;

  const clampWidth = useCallback(
    (nextWidth: number) => {
      const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width || window.innerWidth;
      const minMaterialWidth = isTabletMode ? TABLET_MIN_MATERIAL_WIDTH : DESKTOP_MIN_MATERIAL_WIDTH;
      const minAnswerWidth = isTabletMode ? TABLET_MIN_ANSWER_WIDTH : DESKTOP_MIN_ANSWER_WIDTH;
      const minPercent = isTabletMode ? 0 : 20;
      const maxPercent = isTabletMode ? 100 : 80;
      const minByPixels = (minMaterialWidth / workspaceWidth) * 100;
      const maxByPixels = 100 - ((minAnswerWidth + dividerWidth) / workspaceWidth) * 100;
      let lowerBound = Math.max(minPercent, minByPixels);
      let upperBound = Math.min(maxPercent, maxByPixels);

      if (lowerBound > upperBound) {
        lowerBound = minByPixels;
        upperBound = maxByPixels;
      }

      if (lowerBound > upperBound) {
        return defaultLeftWidth;
      }

      return Math.min(upperBound, Math.max(lowerBound, nextWidth));
    },
    [defaultLeftWidth, dividerWidth, isTabletMode],
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
        [answerPaneWidthProperty]: `calc(${100 - leftWidth}% - var(--split-divider-width))`,
        ['--split-divider-width' as string]: `${dividerWidth}px`,
      }) as CSSProperties,
    [answerPaneWidthProperty, dividerWidth, leftWidth, materialPaneWidthProperty],
  );

  return {
    handleDrag,
    splitPaneStyle,
    workspaceRef,
  };
}
