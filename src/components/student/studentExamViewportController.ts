export interface StudentExamViewportControllerOptions {
  targetWindow: Window;
  targetDocument: Document;
  protectHeight: boolean;
}

const SETTLE_DELAYS_MS = [80, 220, 420] as const;
const NATIVE_SCALE_TOLERANCE = 0.01;
type ProtectedHeightRebaseMode = 'none' | 'initial' | 'recovery';

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
  const scheduledTimers = new Set<number>();
  const hasAnimationFrame = typeof targetWindow.requestAnimationFrame === 'function';
  let scheduledFrame: number | null = null;
  let protectedHeight: number | null = null;
  let protectedHeightRebaseMode: ProtectedHeightRebaseMode = 'none';
  let disposed = false;

  const applyViewportRect = (height: number, offsetTop: number) => {
    root.style.setProperty(
      '--student-viewport-height',
      `${Math.max(0, Math.round(height))}px`,
    );
    root.style.setProperty(
      '--student-viewport-offset-top',
      `${Math.max(0, Math.round(offsetTop))}px`,
    );
  };

  const measure = () => {
    if (disposed) {
      return;
    }

    const nextHeight = Math.round(visualViewport?.height ?? targetWindow.innerHeight);
    const nextOffsetTop = visualViewport?.offsetTop ?? 0;
    const scale = visualViewport?.scale ?? 1;
    const editableFocused = isEditableElement(targetDocument.activeElement);
    const mayRebaseProtectedHeight =
      protectedHeightRebaseMode !== 'none' &&
      !editableFocused &&
      Math.abs(scale - 1) <= NATIVE_SCALE_TOLERANCE;

    if (!protectHeight || protectedHeight === null || mayRebaseProtectedHeight) {
      protectedHeight = nextHeight;
    }

    applyViewportRect(protectHeight ? protectedHeight : nextHeight, nextOffsetTop);
  };

  const clearScheduledWork = () => {
    if (scheduledFrame !== null) {
      if (hasAnimationFrame) {
        targetWindow.cancelAnimationFrame(scheduledFrame);
      } else {
        targetWindow.clearTimeout(scheduledFrame);
      }
      scheduledFrame = null;
    }

    for (const timer of scheduledTimers) {
      targetWindow.clearTimeout(timer);
    }
    scheduledTimers.clear();
  };

  const scheduleFrame = (callback: () => void) => {
    if (hasAnimationFrame) {
      return targetWindow.requestAnimationFrame(callback);
    }

    return targetWindow.setTimeout(callback, 16);
  };

  const scheduleSettleCycle = (requestedRebaseMode: ProtectedHeightRebaseMode) => {
    if (disposed) {
      return;
    }

    if (
      requestedRebaseMode === 'recovery' ||
      protectedHeightRebaseMode !== 'recovery'
    ) {
      protectedHeightRebaseMode = requestedRebaseMode;
    }
    clearScheduledWork();
    measure();

    scheduledFrame = scheduleFrame(() => {
      scheduledFrame = null;
      measure();
    });

    SETTLE_DELAYS_MS.forEach((delay, index) => {
      const timer = targetWindow.setTimeout(() => {
        scheduledTimers.delete(timer);
        measure();
        if (index === SETTLE_DELAYS_MS.length - 1) {
          protectedHeightRebaseMode = 'none';
        }
      }, delay);
      scheduledTimers.add(timer);
    });
  };

  const scheduleProtectedMeasurement = () => scheduleSettleCycle('none');
  const handlePageShow = () => scheduleSettleCycle('recovery');
  const handleFocusOut = (event: FocusEvent) => {
    if (isEditableElement(event.target)) {
      scheduleSettleCycle('recovery');
    }
  };
  const handleVisibilityChange = () => {
    if (targetDocument.visibilityState === 'visible') {
      scheduleSettleCycle('recovery');
    }
  };
  const handleTouch = (event: TouchEvent) => {
    if (event.type === 'touchstart' || event.type === 'touchmove') {
      if (!protectHeight || event.touches.length < 2) {
        return;
      }
    } else if (!protectHeight) {
      return;
    }

    scheduleProtectedMeasurement();
  };

  root.classList.add('student-exam-active');
  body.classList.add('student-exam-active');
  targetWindow.addEventListener('resize', scheduleProtectedMeasurement);
  targetWindow.addEventListener('orientationchange', scheduleProtectedMeasurement);
  targetWindow.addEventListener('pageshow', handlePageShow);
  visualViewport?.addEventListener('resize', scheduleProtectedMeasurement);
  visualViewport?.addEventListener('scroll', scheduleProtectedMeasurement);
  targetDocument.addEventListener('visibilitychange', handleVisibilityChange);
  targetDocument.addEventListener('focusout', handleFocusOut, true);
  targetDocument.addEventListener('touchstart', handleTouch, true);
  targetDocument.addEventListener('touchmove', handleTouch, true);
  targetDocument.addEventListener('touchend', handleTouch, true);
  targetDocument.addEventListener('touchcancel', handleTouch, true);
  scheduleSettleCycle('initial');

  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    disposed = true;
    clearScheduledWork();
    root.classList.remove('student-exam-active');
    body.classList.remove('student-exam-active');
    root.style.removeProperty('--student-viewport-height');
    root.style.removeProperty('--student-viewport-offset-top');
    targetWindow.removeEventListener('resize', scheduleProtectedMeasurement);
    targetWindow.removeEventListener('orientationchange', scheduleProtectedMeasurement);
    targetWindow.removeEventListener('pageshow', handlePageShow);
    visualViewport?.removeEventListener('resize', scheduleProtectedMeasurement);
    visualViewport?.removeEventListener('scroll', scheduleProtectedMeasurement);
    targetDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    targetDocument.removeEventListener('focusout', handleFocusOut, true);
    targetDocument.removeEventListener('touchstart', handleTouch, true);
    targetDocument.removeEventListener('touchmove', handleTouch, true);
    targetDocument.removeEventListener('touchend', handleTouch, true);
    targetDocument.removeEventListener('touchcancel', handleTouch, true);
  };
}
