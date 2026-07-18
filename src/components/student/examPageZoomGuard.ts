export const EXAM_VIEWPORT_CONTENT =
  'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

const SAFARI_GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

export function installExamPageZoomGuard(targetDocument: Document): () => void {
  const root = targetDocument.documentElement;
  const body = targetDocument.body;
  const targetWindow = targetDocument.defaultView;
  const rootHadActiveClass = root.classList.contains('student-exam-active');
  const bodyHadActiveClass = body.classList.contains('student-exam-active');
  root.classList.add('student-exam-active');
  body.classList.add('student-exam-active');

  const originalLegacyViewportHeight = root.style.getPropertyValue(
    '--student-visual-viewport-height',
  );
  const originalLegacyViewportHeightPriority = root.style.getPropertyPriority(
    '--student-visual-viewport-height',
  );
  const supportsDynamicViewportHeight =
    typeof targetWindow?.CSS?.supports === 'function' &&
    targetWindow.CSS.supports('height', '100dvh');
  const visualViewport = targetWindow?.visualViewport;
  const updateLegacyViewportHeight = () => {
    if (!targetWindow || supportsDynamicViewportHeight) {
      return;
    }
    const height = visualViewport?.height ?? targetWindow.innerHeight;
    root.style.setProperty('--student-visual-viewport-height', `${height}px`);
  };

  updateLegacyViewportHeight();
  if (!supportsDynamicViewportHeight) {
    targetWindow?.addEventListener('resize', updateLegacyViewportHeight);
    targetWindow?.addEventListener('orientationchange', updateLegacyViewportHeight);
    visualViewport?.addEventListener('resize', updateLegacyViewportHeight);
  }

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

    if (!supportsDynamicViewportHeight) {
      targetWindow?.removeEventListener('resize', updateLegacyViewportHeight);
      targetWindow?.removeEventListener('orientationchange', updateLegacyViewportHeight);
      visualViewport?.removeEventListener('resize', updateLegacyViewportHeight);
    }
    if (originalLegacyViewportHeight) {
      root.style.setProperty(
        '--student-visual-viewport-height',
        originalLegacyViewportHeight,
        originalLegacyViewportHeightPriority,
      );
    } else {
      root.style.removeProperty('--student-visual-viewport-height');
    }
    if (!rootHadActiveClass) {
      root.classList.remove('student-exam-active');
    }
    if (!bodyHadActiveClass) {
      body.classList.remove('student-exam-active');
    }

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
