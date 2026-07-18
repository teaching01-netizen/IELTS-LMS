import {
  createStudentExamViewportPolicy,
  reduceStudentExamViewportPolicy,
  type StudentExamViewportMeasurement,
  type StudentExamViewportPolicyEvent,
} from './studentExamViewportPolicy';

export interface StudentExamViewportControllerOptions {
  targetWindow: Window;
  targetDocument: Document;
}

const RECOVERY_WINDOW_MS = 1_500;
const FRAME_FALLBACK_MS = 16;
const PINCH_RELEASE_GUARD_MS = 500;
const MATERIAL_WIDTH_CHANGE_PX = 1;

type RecoveryKind = 'bootstrap' | 'topology' | 'keyboard';
type VirtualKeyboardEventTarget = Pick<
  EventTarget,
  'addEventListener' | 'removeEventListener'
> & {
  readonly boundingRect?: Pick<DOMRectReadOnly, 'height'>;
};

function isEditableElement(value: EventTarget | Element | null): value is HTMLElement {
  return (
    value instanceof HTMLElement &&
    value.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  );
}

function finitePositive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

function finiteOptionalNonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

export function installStudentExamViewportController({
  targetWindow,
  targetDocument,
}: StudentExamViewportControllerOptions): () => void {
  const root = targetDocument.documentElement;
  const body = targetDocument.body;
  const visualViewport = targetWindow.visualViewport;
  const virtualKeyboard = (
    targetWindow.navigator as Navigator & { virtualKeyboard?: VirtualKeyboardEventTarget }
  ).virtualKeyboard;
  const hasAnimationFrame = typeof targetWindow.requestAnimationFrame === 'function';
  let scheduledFrame: number | null = null;
  let pinchReleaseTimer: number | null = null;
  let recoveryDeadline: number | null = null;
  let editableFocusActive = isEditableElement(targetDocument.activeElement);
  let pinchActive = false;
  let disposed = false;
  let lastPublishedHeight: number | null = null;
  let lastPublishedOffsetTop: number | null = null;

  const readMeasurement = (
    fallbackHeight = 1,
    fallbackWidth = 1,
  ): StudentExamViewportMeasurement => {
    const visualHeight = finitePositive(visualViewport?.height);
    const innerHeight = finitePositive(targetWindow.innerHeight);
    const clientHeight = finitePositive(root.clientHeight);
    const innerWidth = finitePositive(targetWindow.innerWidth);
    const clientWidth = finitePositive(root.clientWidth);

    return {
      visualHeight,
      layoutHeight: innerHeight ?? clientHeight ?? fallbackHeight,
      offsetTop: visualHeight === null ? 0 : finiteNonNegative(visualViewport?.offsetTop),
      layoutWidth: innerWidth ?? clientWidth ?? fallbackWidth,
      scale: visualHeight === null ? 1 : (finitePositive(visualViewport?.scale) ?? 1),
      keyboardHeight: finiteOptionalNonNegative(virtualKeyboard?.boundingRect?.height),
    };
  };

  let policy = createStudentExamViewportPolicy(readMeasurement());

  const publishPolicyRect = () => {
    if (disposed) {
      return;
    }

    const { height, offsetTop } = policy.publishedRect;
    if (height === lastPublishedHeight && offsetTop === lastPublishedOffsetTop) {
      return;
    }

    root.style.setProperty('--student-viewport-height', `${height}px`);
    root.style.setProperty('--student-viewport-offset-top', `${offsetTop}px`);
    lastPublishedHeight = height;
    lastPublishedOffsetTop = offsetTop;
  };

  const dispatchPolicyEvent = (event: StudentExamViewportPolicyEvent) => {
    if (disposed) {
      return;
    }

    policy = reduceStudentExamViewportPolicy(policy, event);
    publishPolicyRect();
  };

  const measure = () => {
    dispatchPolicyEvent({
      type: 'measurement-received',
      measurement: readMeasurement(policy.closedHeight, policy.layoutWidth),
    });
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
    if (!disposed && recoveryDeadline !== null && Date.now() < recoveryDeadline) {
      scheduledFrame = scheduleFrame(runRecoveryFrame);
      return;
    }

    recoveryDeadline = null;
    dispatchPolicyEvent({ type: 'recovery-finished' });
  };

  const startRecovery = (kind: RecoveryKind) => {
    if (disposed) {
      return;
    }

    if (kind === 'bootstrap') {
      dispatchPolicyEvent({ type: 'bootstrap-recovery-started' });
    } else if (kind === 'topology') {
      dispatchPolicyEvent({ type: 'topology-recovery-started' });
    } else {
      dispatchPolicyEvent({ type: 'editable-focus-left' });
    }

    recoveryDeadline = Date.now() + RECOVERY_WINDOW_MS;
    measure();
    if (scheduledFrame === null) {
      scheduledFrame = scheduleFrame(runRecoveryFrame);
    }
  };

  const cancelRecovery = () => {
    recoveryDeadline = null;
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
    const nextWidth = readMeasurement(policy.trustedRect.height, policy.layoutWidth).layoutWidth;
    if (Math.abs(nextWidth - policy.layoutWidth) >= MATERIAL_WIDTH_CHANGE_PX) {
      startRecovery('topology');
      return;
    }

    measure();
  };
  const handlePassiveViewportChange = () => measure();
  const handlePageShow = () => startRecovery('bootstrap');
  const handleVisibilityChange = () => {
    if (targetDocument.visibilityState === 'visible') {
      startRecovery('bootstrap');
    }
  };
  const handleOrientationChange = () => startRecovery('topology');
  const handleFocusIn = (event: FocusEvent) => {
    if (!isEditableElement(event.target)) {
      return;
    }

    editableFocusActive = true;
    dispatchPolicyEvent({ type: 'editable-focus-entered' });
  };
  const handleFocusOut = (event: FocusEvent) => {
    if (!isEditableElement(event.target)) {
      return;
    }

    editableFocusActive = isEditableElement(event.relatedTarget);
    if (!editableFocusActive) {
      startRecovery('keyboard');
    }
  };
  const handleTouch = (event: TouchEvent) => {
    if (event.type === 'touchstart' || event.type === 'touchmove') {
      if (event.touches.length < 2) {
        return;
      }

      pinchActive = true;
      cancelRecovery();
      clearPinchReleaseTimer();
      dispatchPolicyEvent({ type: 'pinch-started' });
      return;
    }

    if (event.touches.length >= 2 || !pinchActive) {
      return;
    }

    pinchActive = false;
    cancelRecovery();
    clearPinchReleaseTimer();
    pinchReleaseTimer = targetWindow.setTimeout(() => {
      pinchReleaseTimer = null;
      dispatchPolicyEvent({ type: 'pinch-finished' });
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
  visualViewport?.addEventListener('scrollend', handlePassiveViewportChange);
  virtualKeyboard?.addEventListener('geometrychange', handlePassiveViewportChange);
  targetDocument.addEventListener('visibilitychange', handleVisibilityChange);
  targetDocument.addEventListener('focusin', handleFocusIn, true);
  targetDocument.addEventListener('focusout', handleFocusOut, true);
  targetDocument.addEventListener('touchstart', handleTouch, true);
  targetDocument.addEventListener('touchmove', handleTouch, true);
  targetDocument.addEventListener('touchend', handleTouch, true);
  targetDocument.addEventListener('touchcancel', handleTouch, true);
  publishPolicyRect();
  startRecovery('bootstrap');
  if (editableFocusActive) {
    dispatchPolicyEvent({ type: 'editable-focus-entered' });
  }

  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    disposed = true;
    recoveryDeadline = null;
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
    visualViewport?.removeEventListener('scrollend', handlePassiveViewportChange);
    virtualKeyboard?.removeEventListener('geometrychange', handlePassiveViewportChange);
    targetDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    targetDocument.removeEventListener('focusin', handleFocusIn, true);
    targetDocument.removeEventListener('focusout', handleFocusOut, true);
    targetDocument.removeEventListener('touchstart', handleTouch, true);
    targetDocument.removeEventListener('touchmove', handleTouch, true);
    targetDocument.removeEventListener('touchend', handleTouch, true);
    targetDocument.removeEventListener('touchcancel', handleTouch, true);
  };
}
