import { useLayoutEffect, useRef } from 'react';

const DEFAULT_SELECTOR = '[data-student-zoom-scroll]';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useZoomScrollAnchoring(scale: number, selector: string = DEFAULT_SELECTOR) {
  const previousScaleRef = useRef(scale);

  useLayoutEffect(() => {
    const previousScale = previousScaleRef.current;
    previousScaleRef.current = scale;

    if (!Number.isFinite(previousScale) || !Number.isFinite(scale) || previousScale <= 0 || scale <= 0) {
      return;
    }

    if (previousScale === scale) {
      return;
    }

    const ratio = scale / previousScale;

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
  }, [scale, selector]);
}
