import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

type DragState = {
  active: boolean;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  touchId: number | null;
};

const INITIAL_STATE: DragState = {
  active: false,
  startX: 0,
  startY: 0,
  startScrollLeft: 0,
  startScrollTop: 0,
  touchId: null,
};

export function useDragToPan<T extends HTMLElement>(enabled: boolean) {
  const stateRef = useRef<DragState>(INITIAL_STATE);
  const targetRef = useRef<T | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const endDrag = useCallback(() => {
    if (!stateRef.current.active) {
      return;
    }

    stateRef.current = INITIAL_STATE;
    targetRef.current = null;
    setIsDragging(false);
  }, []);

  const updateDrag = useCallback((clientX: number, clientY: number) => {
    if (!stateRef.current.active || !targetRef.current) {
      return;
    }

    const deltaX = clientX - stateRef.current.startX;
    const deltaY = clientY - stateRef.current.startY;

    targetRef.current.scrollLeft = stateRef.current.startScrollLeft - deltaX;
    targetRef.current.scrollTop = stateRef.current.startScrollTop - deltaY;
  }, []);

  const beginDrag = useCallback(
    (target: T, clientX: number, clientY: number, touchId: number | null) => {
      if (!enabled) {
        return;
      }

      targetRef.current = target;
      stateRef.current = {
        active: true,
        startX: clientX,
        startY: clientY,
        startScrollLeft: target.scrollLeft,
        startScrollTop: target.scrollTop,
        touchId,
      };
      setIsDragging(true);
    },
    [enabled],
  );

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      updateDrag(event.clientX, event.clientY);
    };

    const handleMouseUp = () => {
      endDrag();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!stateRef.current.active) {
        return;
      }

      if (event.touches.length !== 1) {
        endDrag();
        return;
      }

      const trackedTouch =
        stateRef.current.touchId === null
          ? event.touches[0]
          : Array.from(event.touches).find((touch) => touch.identifier === stateRef.current.touchId);

      if (!trackedTouch) {
        return;
      }

      updateDrag(trackedTouch.clientX, trackedTouch.clientY);
      event.preventDefault();
    };

    const handleTouchEnd = () => {
      endDrag();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [endDrag, updateDrag]);

  const onMouseDown = useCallback(
    (event: React.MouseEvent<T>) => {
      if (!enabled) {
        return;
      }
      if (event.button !== 0) {
        return;
      }

      beginDrag(event.currentTarget, event.clientX, event.clientY, null);
      event.preventDefault();
    },
    [beginDrag, enabled],
  );

  const onTouchStart = useCallback(
    (event: React.TouchEvent<T>) => {
      if (!enabled) {
        return;
      }
      if (event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      beginDrag(event.currentTarget, touch.clientX, touch.clientY, touch.identifier);
      event.preventDefault();
    },
    [beginDrag, enabled],
  );

  const dragStyle: React.CSSProperties | undefined = enabled
    ? {
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'manipulation',
      }
    : undefined;

  return {
    isDragging,
    cancelDrag: endDrag,
    dragHandlers: {
      onMouseDown,
      onTouchStart,
    },
    dragStyle,
  };
}
