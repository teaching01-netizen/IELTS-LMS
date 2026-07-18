export const EXAM_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=overlays-content';

const SAFARI_GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

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
