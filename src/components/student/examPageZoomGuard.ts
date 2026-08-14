export const EXAM_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

const SAFARI_GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/**
 * Guards native page zoom during the exam lifecycle only.
 *
 * This guard owns the locked viewport meta and Safari gesture/multi-touch
 * prevention. Viewport *height* is owned by `useStudentExamViewport` (which
 * publishes `--student-exam-height` on the shell) and the document page lock
 * (`html/body.student-exam-active`) is owned by `useStudentExamPageLock`.
 */
export function installExamPageZoomGuard(targetDocument: Document): () => void {
  let viewport = targetDocument.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const createdViewport = viewport === null;

  if (!viewport) {
    viewport = targetDocument.createElement('meta');
    viewport.name = 'viewport';
    targetDocument.head.appendChild(viewport);
  }

  const originalContent = viewport.getAttribute('content');
  viewport.setAttribute('content', EXAM_VIEWPORT_CONTENT);

  const preventGesture = (event: Event) => {
    event.preventDefault();
  };

  const preventMultiTouchMove = (event: Event) => {
    const touchEvent = event as TouchEvent;
    if (touchEvent.touches.length >= 2) {
      event.preventDefault();
    }
  };

  targetDocument.addEventListener('touchmove', preventMultiTouchMove, {
    capture: true,
    passive: false,
  });
  for (const eventName of SAFARI_GESTURE_EVENTS) {
    targetDocument.addEventListener(eventName, preventGesture, {
      capture: true,
      passive: false,
    });
  }

  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    targetDocument.removeEventListener('touchmove', preventMultiTouchMove, true);
    for (const eventName of SAFARI_GESTURE_EVENTS) {
      targetDocument.removeEventListener(eventName, preventGesture, true);
    }

    if (createdViewport) {
      viewport.remove();
    } else if (originalContent === null) {
      viewport.removeAttribute('content');
    } else {
      viewport.setAttribute('content', originalContent);
    }
  };
}
