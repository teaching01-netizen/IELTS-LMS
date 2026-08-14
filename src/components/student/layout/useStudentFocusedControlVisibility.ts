import { useEffect } from 'react';
import { isEditableElement } from './useStudentExamViewport';

/** Internal scrolling surfaces owned by exam panes. */
const EXAM_SCROLL_OWNER_SELECTOR = [
  '.student-reading-question-pane',
  '.student-writing-editor-pane',
  '.student-listening-question-pane',
  '[data-student-zoom-scroll]',
].join(', ');

/** Keep the control this far above the keyboard edge. */
const REVEAL_MARGIN_PX = 12;

function findNearestExamScrollOwner(element: Element): HTMLElement | null {
  let current: Element | null = element;
  while (current && current !== document.body) {
    if (current instanceof HTMLElement) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      const isOverflowScrollOwner =
        overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
      if (current.matches(EXAM_SCROLL_OWNER_SELECTOR) || isOverflowScrollOwner) {
        if (current.scrollHeight > current.clientHeight) {
          return current;
        }
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
 * Only internal content moves: the document/window is never scrolled, and
 * `scrollIntoView()` is only applied after measuring that the control is
 * actually obscured.
 */
export function useStudentFocusedControlVisibility(keyboardOpen: boolean): void {
  useEffect(() => {
    if (!keyboardOpen || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const activeElement = document.activeElement;
    if (!(activeElement instanceof Element) || !isEditableElement(activeElement)) {
      return;
    }

    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return;
    }

    const rect = activeElement.getBoundingClientRect();
    const visibleTop = visualViewport.offsetTop;
    const visibleBottom = visualViewport.offsetTop + visualViewport.height;

    if (rect.bottom <= visibleBottom - REVEAL_MARGIN_PX && rect.top >= visibleTop + REVEAL_MARGIN_PX) {
      return;
    }

    const scrollOwner = findNearestExamScrollOwner(activeElement);
    if (!scrollOwner) {
      return;
    }

    if (rect.bottom > visibleBottom - REVEAL_MARGIN_PX) {
      scrollOwner.scrollTop += rect.bottom - (visibleBottom - REVEAL_MARGIN_PX);
    } else if (rect.top < visibleTop + REVEAL_MARGIN_PX) {
      scrollOwner.scrollTop -= visibleTop + REVEAL_MARGIN_PX - rect.top;
    }
  }, [keyboardOpen]);
}
