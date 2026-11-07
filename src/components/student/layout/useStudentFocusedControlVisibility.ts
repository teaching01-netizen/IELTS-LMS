import { useEffect } from 'react';
import { isEditableElement } from './useStudentExamViewport';

/** Internal scrolling surfaces owned by exam panes. */
const EXAM_SCROLL_OWNER_SELECTOR = [
  '.student-reading-question-pane',
  '.student-writing-editor-pane',
  '.student-listening-question-pane',
  '[data-student-zoom-scroll]',
].join(', ');
const EXPLICIT_EXAM_SCROLL_OWNER_SELECTOR = '[data-student-exam-scroll-owner]';

/** Keep the control this far above the keyboard edge. */
const REVEAL_MARGIN_PX = 12;
// Chrome on iOS can overlay its 44pt autofill accessory above the keyboard.
const CHROME_IOS_ACCESSORY_HEIGHT = 44;
const SCROLL_CLEARANCE_PROPERTY = '--student-keyboard-scroll-clearance';

function findNearestExamScrollOwner(element: Element): HTMLElement | null {
  const explicitOwner = element.closest<HTMLElement>(EXPLICIT_EXAM_SCROLL_OWNER_SELECTOR);
  if (explicitOwner) {
    return explicitOwner;
  }

  let current = element.parentElement;
  while (current && !current.matches('.student-exam-shell')) {
    if (current instanceof HTMLElement) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      const isOverflowScrollOwner =
        overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
      if (
        isOverflowScrollOwner &&
        (current.matches(EXAM_SCROLL_OWNER_SELECTOR) || current.scrollHeight > current.clientHeight)
      ) {
        return current;
      }
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * If opening the software keyboard leaves the focused answer control outside
 * the visual viewport, scrolls the nearest exam pane just enough to reveal it.
 *
 * Follow the viewport during keyboard animation and focus changes. Only the
 * answer's scroll pane moves, with enough extra scroll room for its last field.
 */
export function useStudentFocusedControlVisibility(keyboardOpen: boolean): void {
  useEffect(() => {
    if (!keyboardOpen || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return;
    }

    const isChromeOnIos = /CriOS\//.test(navigator.userAgent);
    let ownerWithClearance: HTMLElement | null = null;
    let pendingFrame: number | null = null;

    const reveal = () => {
      pendingFrame = null;
      const activeElement = document.activeElement;
      const shell = activeElement?.closest('.student-exam-shell');
      if (!activeElement || !shell || !isEditableElement(activeElement)) {
        return;
      }

      const owner = findNearestExamScrollOwner(activeElement);
      if (ownerWithClearance !== owner) {
        ownerWithClearance?.style.removeProperty(SCROLL_CLEARANCE_PROPERTY);
        ownerWithClearance = owner;
      }
      if (!owner) {
        return;
      }

      const pane = owner.getBoundingClientRect();
      const viewportBottom = visualViewport.offsetTop + visualViewport.height;
      const visibleTop = Math.max(pane.top, visualViewport.offsetTop) + REVEAL_MARGIN_PX;
      const bottomWithoutAccessory = Math.min(pane.bottom, viewportBottom - REVEAL_MARGIN_PX);
      const accessoryHeight = isChromeOnIos
        ? CHROME_IOS_ACCESSORY_HEIGHT / (visualViewport.scale || 1)
        : 0;
      const fieldHeight = activeElement.getBoundingClientRect().height;
      const accessoryClearance = Math.min(accessoryHeight, Math.max(0, bottomWithoutAccessory - visibleTop - fieldHeight));
      const visibleBottom = Math.min(pane.bottom, viewportBottom - REVEAL_MARGIN_PX - accessoryClearance);
      if (visibleBottom <= visibleTop) {
        return;
      }

      // Rects include exam zoom, but scrollTop and the spacer use layout pixels.
      const zoom = owner.currentCSSZoom || Number.parseFloat(getComputedStyle(shell).zoom) || 1;
      const clearance = Math.max(0, pane.bottom - visibleBottom) / zoom;
      owner.style.setProperty(SCROLL_CLEARANCE_PROPERTY, `${clearance}px`);
      const rect = activeElement.getBoundingClientRect();
      // If the entire field cannot fit, prioritize its start.
      const latestVisibleTop = Math.max(visibleTop, visibleBottom - rect.height);
      const targetTop = Math.min(latestVisibleTop, Math.max(visibleTop, rect.top));
      const scrollDelta = rect.top - targetTop;
      if (scrollDelta !== 0) {
        owner.scrollTop += scrollDelta / zoom;
      }
    };

    const scheduleReveal = () => {
      if (pendingFrame === null) {
        pendingFrame = window.requestAnimationFrame(reveal);
      }
    };

    visualViewport.addEventListener('resize', scheduleReveal);
    visualViewport.addEventListener('scroll', scheduleReveal);
    document.addEventListener('focusin', scheduleReveal);
    scheduleReveal();

    return () => {
      visualViewport.removeEventListener('resize', scheduleReveal);
      visualViewport.removeEventListener('scroll', scheduleReveal);
      document.removeEventListener('focusin', scheduleReveal);
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
      }
      ownerWithClearance?.style.removeProperty(SCROLL_CLEARANCE_PROPERTY);
    };
  }, [keyboardOpen]);
}
