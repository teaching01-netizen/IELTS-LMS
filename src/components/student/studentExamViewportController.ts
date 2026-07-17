export interface StudentExamViewportControllerOptions {
  targetWindow: Window;
  targetDocument: Document;
  protectHeight: boolean;
}

const RECOVERY_WINDOW_MS = 1_500;
const FRAME_FALLBACK_MS = 16;
const PINCH_RELEASE_GUARD_MS = 500;
const NATIVE_SCALE_TOLERANCE = 0.01;
type RecoveryKind = 'initial' | 'lifecycle';

function isEditableElement(value: EventTarget | Element | null): value is HTMLElement {
  return (
    value instanceof HTMLElement &&
    value.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  );
}

export function installStudentExamViewportController({
  targetWindow,
  targetDocument,
  protectHeight,
}: StudentExamViewportControllerOptions): () => void {
  const root = targetDocument.documentElement;
  const body = targetDocument.body;
  const visualViewport = targetWindow.visualViewport;
  const hasAnimationFrame = typeof targetWindow.requestAnimationFrame === 'function';
  let scheduledFrame: number | null = null;
  let pinchReleaseTimer: number | null = null;
  let recoveryDeadline: number | null = null;
  let recoveryKind: RecoveryKind | null = null;
  let protectedHeight: number | null = null;
  let editableFocusActive = isEditableElement(targetDocument.activeElement);
  let pinchActive = false;
  let pinchGuardUntil = 0;
  let lastPublishedHeight: number | null = null;
  let lastPublishedOffsetTop: number | null = null;
  let disposed = false;

  const now = () => Date.now();

  const applyViewportRect = (height: number, offsetTop: number) => {
    root.style.setProperty('--student-viewport-height', `${height}px`);
    root.style.setProperty('--student-viewport-offset-top', `${offsetTop}px`);
  };

  const measure = () => {
    if (disposed) {
      return;
    }

    const nextHeight = Math.max(
      0,
      Math.round(visualViewport?.height ?? targetWindow.innerHeight),
    );
    const nextOffsetTop = Math.max(0, Math.round(visualViewport?.offsetTop ?? 0));
    const scale = visualViewport?.scale ?? 1;
    const currentTime = now();
    const editableFocused =
      editableFocusActive || isEditableElement(targetDocument.activeElement);
    const pinchProtected =
      pinchActive ||
      Math.abs(scale - 1) > NATIVE_SCALE_TOLERANCE ||
      currentTime < pinchGuardUntil;
    const recoveryActive =
      recoveryDeadline !== null && currentTime <= recoveryDeadline;

    if (!protectHeight || protectedHeight === null) {
      protectedHeight = nextHeight;
    } else if (!editableFocused && !pinchProtected) {
      const safeGrowth = nextHeight > protectedHeight;
      if (safeGrowth || recoveryActive) {
        protectedHeight = nextHeight;
      }
    }

    const effectiveHeight = protectHeight ? (protectedHeight ?? nextHeight) : nextHeight;
    if (
      effectiveHeight !== lastPublishedHeight ||
      nextOffsetTop !== lastPublishedOffsetTop
    ) {
      applyViewportRect(effectiveHeight, nextOffsetTop);
      lastPublishedHeight = effectiveHeight;
      lastPublishedOffsetTop = nextOffsetTop;
    }
  };

  const scheduleFrame = (callback: () => void) => {
    if (hasAnimationFrame) {
      return targetWindow.requestAnimationFrame(callback);
    }

    return targetWindow.setTimeout(callback, FRAME_FALLBACK_MS);
  };

  const cancelScheduledFrame = () => {
    if (scheduledFrame === null) {
      return;
    }

    if (hasAnimationFrame) {
      targetWindow.cancelAnimationFrame(scheduledFrame);
    } else {
      targetWindow.clearTimeout(scheduledFrame);
    }
    scheduledFrame = null;
  };

  const runRecoveryFrame = () => {
    scheduledFrame = null;
    measure();
    if (!disposed && recoveryDeadline !== null && now() < recoveryDeadline) {
      scheduledFrame = scheduleFrame(runRecoveryFrame);
    } else {
      recoveryDeadline = null;
      recoveryKind = null;
    }
  };

  const startRecoveryWindow = (kind: RecoveryKind = 'lifecycle') => {
    if (disposed) {
      return;
    }

    recoveryDeadline = now() + RECOVERY_WINDOW_MS;
    recoveryKind = kind;
    measure();
    if (scheduledFrame === null) {
      scheduledFrame = scheduleFrame(runRecoveryFrame);
    }
  };

  const cancelRecoveryWindow = () => {
    recoveryDeadline = null;
    recoveryKind = null;
    cancelScheduledFrame();
  };

  const clearPinchReleaseTimer = () => {
    if (pinchReleaseTimer === null) {
      return;
    }

    targetWindow.clearTimeout(pinchReleaseTimer);
    pinchReleaseTimer = null;
  };

  const handleWindowResize = () => {
    if (recoveryKind === 'initial') {
      cancelRecoveryWindow();
    }
    measure();
  };
  const handlePassiveViewportChange = () => measure();
  const handlePageShow = () => startRecoveryWindow();
  const handleVisibilityChange = () => {
    if (targetDocument.visibilityState === 'visible') {
      startRecoveryWindow();
    }
  };
  const handleOrientationChange = () => {
    const scale = visualViewport?.scale ?? 1;
    if (
      !pinchActive &&
      Math.abs(scale - 1) <= NATIVE_SCALE_TOLERANCE &&
      now() >= pinchGuardUntil
    ) {
      startRecoveryWindow();
    }
  };
  const handleViewportScrollEnd = () => {
    const scale = visualViewport?.scale ?? 1;
    if (
      !editableFocusActive &&
      !pinchActive &&
      Math.abs(scale - 1) <= NATIVE_SCALE_TOLERANCE &&
      now() >= pinchGuardUntil
    ) {
      startRecoveryWindow();
    }
  };
  const handleFocusIn = (event: FocusEvent) => {
    if (isEditableElement(event.target)) {
      editableFocusActive = true;
    }
  };
  const handleFocusOut = (event: FocusEvent) => {
    if (!isEditableElement(event.target)) {
      return;
    }

    editableFocusActive = isEditableElement(event.relatedTarget);
    if (!editableFocusActive) {
      startRecoveryWindow();
    }
  };
  const handleTouch = (event: TouchEvent) => {
    if (event.type === 'touchstart' || event.type === 'touchmove') {
      if (event.touches.length < 2) {
        return;
      }

      pinchActive = true;
      cancelRecoveryWindow();
      clearPinchReleaseTimer();
      measure();
      return;
    }

    if (event.touches.length >= 2) {
      return;
    }
    if (!pinchActive) {
      measure();
      return;
    }

    pinchActive = false;
    pinchGuardUntil = now() + PINCH_RELEASE_GUARD_MS;
    cancelRecoveryWindow();
    clearPinchReleaseTimer();
    measure();
    pinchReleaseTimer = targetWindow.setTimeout(() => {
      pinchReleaseTimer = null;
      measure();
    }, PINCH_RELEASE_GUARD_MS);
  };

  root.classList.add('student-exam-active');
  body.classList.add('student-exam-active');
  targetWindow.addEventListener('resize', handleWindowResize);
  targetWindow.addEventListener('orientationchange', handleOrientationChange);
  targetWindow.addEventListener('pageshow', handlePageShow);
  visualViewport?.addEventListener('resize', handlePassiveViewportChange);
  visualViewport?.addEventListener('scroll', handlePassiveViewportChange);
  visualViewport?.addEventListener('scrollend', handleViewportScrollEnd);
  targetDocument.addEventListener('visibilitychange', handleVisibilityChange);
  targetDocument.addEventListener('focusin', handleFocusIn, true);
  targetDocument.addEventListener('focusout', handleFocusOut, true);
  targetDocument.addEventListener('touchstart', handleTouch, true);
  targetDocument.addEventListener('touchmove', handleTouch, true);
  targetDocument.addEventListener('touchend', handleTouch, true);
  targetDocument.addEventListener('touchcancel', handleTouch, true);
  startRecoveryWindow('initial');

  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    disposed = true;
    recoveryDeadline = null;
    recoveryKind = null;
    cancelScheduledFrame();
    clearPinchReleaseTimer();
    root.classList.remove('student-exam-active');
    body.classList.remove('student-exam-active');
    root.style.removeProperty('--student-viewport-height');
    root.style.removeProperty('--student-viewport-offset-top');
    targetWindow.removeEventListener('resize', handleWindowResize);
    targetWindow.removeEventListener('orientationchange', handleOrientationChange);
    targetWindow.removeEventListener('pageshow', handlePageShow);
    visualViewport?.removeEventListener('resize', handlePassiveViewportChange);
    visualViewport?.removeEventListener('scroll', handlePassiveViewportChange);
    visualViewport?.removeEventListener('scrollend', handleViewportScrollEnd);
    targetDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    targetDocument.removeEventListener('focusin', handleFocusIn, true);
    targetDocument.removeEventListener('focusout', handleFocusOut, true);
    targetDocument.removeEventListener('touchstart', handleTouch, true);
    targetDocument.removeEventListener('touchmove', handleTouch, true);
    targetDocument.removeEventListener('touchend', handleTouch, true);
    targetDocument.removeEventListener('touchcancel', handleTouch, true);
  };
}
