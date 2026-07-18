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

  const originalViewportHeight = root.style.getPropertyValue(
    '--student-visual-viewport-height',
  );
  const originalViewportHeightPriority = root.style.getPropertyPriority(
    '--student-visual-viewport-height',
  );
  const visualViewport = targetWindow?.visualViewport;
  const viewportSettleTimers = new Set<number>();
  const updateViewportHeight = () => {
    if (!targetWindow) {
      return;
    }
    const height = visualViewport?.height ?? targetWindow.innerHeight;
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    root.style.setProperty('--student-visual-viewport-height', `${height}px`);
  };
  const clearViewportSettleTimers = () => {
    if (!targetWindow) return;
    for (const timer of viewportSettleTimers) {
      targetWindow.clearTimeout(timer);
    }
    viewportSettleTimers.clear();
  };
  const resampleViewportAfterFocusTransition = () => {
    if (!targetWindow) return;
    clearViewportSettleTimers();
    updateViewportHeight();
    for (const delay of [100, 300, 600]) {
      const timer = targetWindow.setTimeout(() => {
        viewportSettleTimers.delete(timer);
        updateViewportHeight();
      }, delay);
      viewportSettleTimers.add(timer);
    }
  };

  updateViewportHeight();
  targetWindow?.addEventListener('resize', updateViewportHeight);
  targetWindow?.addEventListener('orientationchange', updateViewportHeight);
  visualViewport?.addEventListener('resize', updateViewportHeight);
  visualViewport?.addEventListener('scroll', updateViewportHeight);
  targetDocument.addEventListener('focusout', resampleViewportAfterFocusTransition);

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

    targetWindow?.removeEventListener('resize', updateViewportHeight);
    targetWindow?.removeEventListener('orientationchange', updateViewportHeight);
    visualViewport?.removeEventListener('resize', updateViewportHeight);
    visualViewport?.removeEventListener('scroll', updateViewportHeight);
    targetDocument.removeEventListener('focusout', resampleViewportAfterFocusTransition);
    clearViewportSettleTimers();
    if (originalViewportHeight) {
      root.style.setProperty(
        '--student-visual-viewport-height',
        originalViewportHeight,
        originalViewportHeightPriority,
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
