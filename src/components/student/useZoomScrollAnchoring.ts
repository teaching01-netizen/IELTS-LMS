import { useLayoutEffect, useRef } from 'react';

const DEFAULT_SELECTOR = '[data-student-zoom-scroll]';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useZoomScrollAnchoring(zoom: number, selector: string = DEFAULT_SELECTOR) {
  const previousZoomRef = useRef(zoom);

  useLayoutEffect(() => {
    const previousZoom = previousZoomRef.current;
    previousZoomRef.current = zoom;

    if (!Number.isFinite(previousZoom) || !Number.isFinite(zoom) || previousZoom <= 0 || zoom <= 0) {
      return;
    }

    if (previousZoom === zoom) {
      return;
    }

    const ratio = zoom / previousZoom;

    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth) {
        return;
      }

      const centeredTop = element.scrollTop + element.clientHeight / 2;
      const centeredLeft = element.scrollLeft + element.clientWidth / 2;

      const nextScrollTop = centeredTop * ratio - element.clientHeight / 2;
      const nextScrollLeft = centeredLeft * ratio - element.clientWidth / 2;

      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);

      element.scrollTop = clamp(nextScrollTop, 0, maxScrollTop);
      element.scrollLeft = clamp(nextScrollLeft, 0, maxScrollLeft);
    });
  }, [selector, zoom]);
}
