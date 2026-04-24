import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { saveStudentAuditEvent } from '@services/studentAuditService';
import { ExamConfig, ViolationSeverity } from '../../../types';
import {
  getFullscreenElement,
  isAppleMobileDevice,
  requestStudentFullscreen,
} from '../fullscreen';
import { useStudentAttempt } from './StudentAttemptProvider';
import { useStudentRuntime } from './StudentRuntimeProvider';

interface ProctoringContextValue {
  handleViolation: (
    type: string,
    message: string,
    severity?: ViolationSeverity,
  ) => void;
}

const ProctoringContext = createContext<ProctoringContextValue | null>(null);

interface ProctoringProviderProps {
  children: ReactNode;
  config: ExamConfig;
  scheduleId?: string | undefined;
}

function isSafariBrowser() {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}

function isTextInputElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  const tag = element.tagName?.toLowerCase?.() ?? '';
  if (tag === 'textarea') {
    return true;
  }

  if (tag === 'input') {
    const type = (element as HTMLInputElement).type?.toLowerCase?.() ?? 'text';
    const nonTextTypes = new Set([
      'button',
      'checkbox',
      'color',
      'date',
      'datetime-local',
      'file',
      'hidden',
      'image',
      'month',
      'radio',
      'range',
      'reset',
      'submit',
      'time',
      'week',
    ]);
    return !nonTextTypes.has(type);
  }

  if ('isContentEditable' in element && Boolean((element as HTMLElement).isContentEditable)) {
    return true;
  }

  return false;
}

function getViewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

export function ProctoringProvider({
  children,
  config,
  scheduleId,
}: ProctoringProviderProps) {
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntime();
  const { state: attemptState } = useStudentAttempt();
  const shouldPreventTranslation = config.security.preventTranslation !== false;
  const cooldownByTypeRef = useRef<Record<string, number>>({});
  const fullscreenReentryAttempts = useRef(0);
  const fullscreenEntryAttemptedRef = useRef(false);
  const viewportBaselineHeightRef = useRef<number>(getViewportHeight());
  const defaultViolationCooldownMs = 5_000;
  const secondaryScreenViolationCooldownMs = 15_000;
  const screenDetailsUnsupportedRef = useRef(false);
  const screenDetailsLastPermissionDeniedAtRef = useRef(0);
  const violationCountsRef = useRef<Record<ViolationSeverity, number>>({
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  });

  const handleViolation = useCallback((
    type: string,
    message: string,
    severity: ViolationSeverity = 'medium',
  ) => {
    const now = Date.now();
    const lastViolationAt = cooldownByTypeRef.current[type] ?? 0;

    const violationCooldownMs =
      type === 'TAB_SWITCH' || type === 'FULLSCREEN_EXIT'
        ? 0
        : type === 'SECONDARY_SCREEN'
          ? secondaryScreenViolationCooldownMs
          : defaultViolationCooldownMs;

    if (violationCooldownMs > 0) {
      if (now - lastViolationAt < violationCooldownMs) {
        return;
      }
    }

    cooldownByTypeRef.current[type] = now;
    
    // Increment violation count for severity
    violationCountsRef.current[severity]++;
    
    const thresholds = config.security.severityThresholds;
    
    // Check severity thresholds
    if (severity === 'critical') {
      // Always terminate on critical
      runtimeActions.addViolation(type, severity, message);
      void saveStudentAuditEvent(
        scheduleId,
        'VIOLATION_DETECTED',
        {
          severity,
          message,
          violationType: type,
          action: 'terminate',
        },
        attemptState.attemptId ?? undefined,
      );
      runtimeActions.terminateExam();
      return;
    }
    
    if (severity === 'high') {
      const highLimit = thresholds?.highLimit ?? 2;
      if (violationCountsRef.current.high >= highLimit) {
        runtimeActions.addViolation(type, severity, message);
        void saveStudentAuditEvent(
          scheduleId,
          'VIOLATION_DETECTED',
          {
            severity,
            message,
            violationType: type,
            count: violationCountsRef.current.high,
            threshold: highLimit,
            action: config.progression.allowPause ? 'pause' : 'terminate',
          },
          attemptState.attemptId ?? undefined,
        );
        if (config.progression.allowPause) {
          runtimeActions.pauseExam();
        } else {
          runtimeActions.terminateExam();
        }
        return;
      }
    }
    
    if (severity === 'medium') {
      const mediumLimit = thresholds?.mediumLimit ?? config.progression.warningThreshold ?? 3;
      if (violationCountsRef.current.medium >= mediumLimit) {
        runtimeActions.addViolation(type, severity, message);
        void saveStudentAuditEvent(
          scheduleId,
          'VIOLATION_DETECTED',
          {
            severity,
            message,
            violationType: type,
            count: violationCountsRef.current.medium,
            threshold: mediumLimit,
            action: 'warn',
          },
          attemptState.attemptId ?? undefined,
        );
        return;
      }
    }
    
    if (severity === 'low') {
      const lowLimit = thresholds?.lowLimit ?? 5;
      if (violationCountsRef.current.low >= lowLimit) {
        runtimeActions.addViolation(type, severity, message);
        void saveStudentAuditEvent(
          scheduleId,
          'VIOLATION_DETECTED',
          {
            severity,
            message,
            violationType: type,
            count: violationCountsRef.current.low,
            threshold: lowLimit,
            action: 'warn',
          },
          attemptState.attemptId ?? undefined,
        );
        return;
      }
    }
    
    // Default: just log the violation
    runtimeActions.addViolation(type, severity, message);
    void saveStudentAuditEvent(
      scheduleId,
      'VIOLATION_DETECTED',
      {
        severity,
        message,
        violationType: type,
      },
      attemptState.attemptId ?? undefined,
    );
  }, [attemptState.attemptId, config.security.severityThresholds, runtimeActions, scheduleId]);

  const requestFullscreen = useCallback(async (): Promise<boolean> => {
    try {
      return await requestStudentFullscreen();
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (runtimeState.phase !== 'exam' || !config.security.requireFullscreen) {
      fullscreenEntryAttemptedRef.current = false;
      return;
    }

    if (getFullscreenElement() || fullscreenEntryAttemptedRef.current) {
      return;
    }

    fullscreenEntryAttemptedRef.current = true;
    void requestFullscreen();
  }, [config.security.requireFullscreen, requestFullscreen, runtimeState.phase]);

  useEffect(() => {
    const translateMetaId = 'student-notranslate-meta';
    const root = document.documentElement;

    const removeNoTranslateMarkers = () => {
      root.removeAttribute('translate');
      root.classList.remove('notranslate');
      document.head.querySelector(`#${translateMetaId}`)?.remove();
    };

    if (runtimeState.phase !== 'exam' || !shouldPreventTranslation) {
      removeNoTranslateMarkers();
      return;
    }

    root.setAttribute('translate', 'no');
    root.classList.add('notranslate');

    if (!document.head.querySelector(`#${translateMetaId}`)) {
      const meta = document.createElement('meta');
      meta.id = translateMetaId;
      meta.name = 'google';
      meta.content = 'notranslate';
      document.head.appendChild(meta);
    }

    return removeNoTranslateMarkers;
  }, [runtimeState.phase, shouldPreventTranslation]);

  useEffect(() => {
    if (runtimeState.phase !== 'exam' || !shouldPreventTranslation) {
      return;
    }

    const detectTranslation = () => {
      const root = document.documentElement;
      const hasTranslateClasses =
        root.classList.contains('translated-ltr') || root.classList.contains('translated-rtl');
      const hasTranslateDom =
        document.querySelector('#goog-gt-tt') != null ||
        document.querySelector('iframe.goog-te-banner-frame') != null ||
        document.querySelector('.goog-te-banner-frame') != null;

      if (!hasTranslateClasses && !hasTranslateDom) {
        return;
      }

      handleViolation(
        'TRANSLATION_DETECTED',
        'Translation tools detected. Please disable translation and continue in the original language.',
        'medium',
      );
    };

    detectTranslation();

    const intervalId = window.setInterval(detectTranslation, 2_000);
    const observer = new MutationObserver(() => {
      detectTranslation();
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      window.clearInterval(intervalId);
      observer.disconnect();
    };
  }, [handleViolation, runtimeState.phase, shouldPreventTranslation]);

  const detectSecondaryScreens = useCallback(async () => {
    if (!config.security.detectSecondaryScreen || runtimeState.phase !== 'exam') {
      return;
    }

    if (screenDetailsUnsupportedRef.current) {
      return;
    }

    if (!('getScreenDetails' in window)) {
      // Log unsupported API as informational event
      if (!isSafariBrowser()) {
        void saveStudentAuditEvent(
          scheduleId,
          'SCREEN_CHECK_UNSUPPORTED',
          {
            browser: navigator.userAgent,
            userAgent: navigator.userAgent,
          },
          attemptState.attemptId ?? undefined,
        );
      }
      screenDetailsUnsupportedRef.current = true;
      return;
    }

    try {
      const screenDetails = await (
        window as Window & {
          getScreenDetails?: () => Promise<{
            screens?: Array<unknown>;
          }>;
        }
      ).getScreenDetails?.();

      if ((screenDetails?.screens?.length ?? 0) > 1) {
        handleViolation(
          'SECONDARY_SCREEN',
          `Multiple screens detected (${screenDetails?.screens?.length ?? 0}). Please disconnect additional displays.`,
          'high',
        );
      }
    } catch (error) {
      const now = Date.now();
      if (now - screenDetailsLastPermissionDeniedAtRef.current < 60_000) {
        return;
      }
      screenDetailsLastPermissionDeniedAtRef.current = now;

      void saveStudentAuditEvent(
        scheduleId,
        'SCREEN_CHECK_PERMISSION_DENIED',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        attemptState.attemptId ?? undefined,
      );
    }
  }, [
    attemptState.attemptId,
    config.security.detectSecondaryScreen,
    handleViolation,
    runtimeState.phase,
    scheduleId,
  ]);

  useEffect(() => {
    let tabSwitchDebounceTimer: number | null = null;
    let lastTabSwitchTime = 0;
    let fullscreenReentryTimer: number | null = null;
    let secondaryScreenCheckTimer: number | null = null;
    let fullscreenExitDeferTimer: number | null = null;
    let fullscreenExitDeferStartedAt = 0;
    let closeSignalAt = 0;
    let lastViewportResizeAt = 0;

    const closeSignalWindowMs = 1_000;
    const closeSignalDelayMs = 50;
    const tabSwitchDedupeWindowMs = 300;
    const secondaryScreenCheckIntervalMs = 3_000;
    const fullscreenExitDeferCheckDelayMs = 400;
    const fullscreenExitMaxDeferMs = 8_000;
    const fullscreenGestureAttemptCooldownMs = 1_500;
    const fullscreenViewportSettleMs = 1_000;
    let lastFullscreenGestureAttemptAt = 0;

    const recordCloseSignal = (eventType: string) => {
      if (runtimeState.phase !== 'exam') {
        return;
      }

      closeSignalAt = Date.now();
      void saveStudentAuditEvent(
        scheduleId,
        'BROWSER_CLOSE_DETECTED',
        {
          eventType,
          timestamp: new Date().toISOString(),
        },
        attemptState.attemptId ?? undefined,
      );
    };

    const handleTabSwitch = (eventType: string) => {
      if (
        runtimeState.phase !== 'exam' ||
        config.security.tabSwitchRule === 'none'
      ) {
        return;
      }

      const now = Date.now();
      
      // Deduplicate bursts of events.
      if (now - lastTabSwitchTime < tabSwitchDedupeWindowMs) {
        return;
      }
      lastTabSwitchTime = now;

      if (tabSwitchDebounceTimer) {
        window.clearTimeout(tabSwitchDebounceTimer);
      }

      tabSwitchDebounceTimer = null;

      if (config.security.tabSwitchRule === 'warn') {
        handleViolation(
          'TAB_SWITCH',
          `Tab switching detected via ${eventType}. You must remain on the examination page at all times.`,
          'medium',
        );
        return;
      }

      handleViolation('TAB_SWITCH', `Tab switching detected via ${eventType}. Exam terminated.`, 'critical');
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        return;
      }
      window.setTimeout(() => {
        if (Date.now() - closeSignalAt < closeSignalWindowMs) {
          return;
        }
        handleTabSwitch('visibilitychange');
      }, closeSignalDelayMs);
    };

    const handlePageHide = () => {
      recordCloseSignal('pagehide');
    };

    const handleBeforeUnload = () => {
      recordCloseSignal('beforeunload');
    };

    const isIosWebKit = isAppleMobileDevice(navigator.userAgent);

    const clearFullscreenExitDefer = () => {
      if (fullscreenExitDeferTimer) {
        window.clearTimeout(fullscreenExitDeferTimer);
        fullscreenExitDeferTimer = null;
      }
      fullscreenExitDeferStartedAt = 0;
    };

    const isKeyboardLikelyOpen = () => {
      const baseline = viewportBaselineHeightRef.current;
      const current = getViewportHeight();
      const delta = baseline - current;
      return delta > 140;
    };

    const shouldIgnoreTextEntryBlur = () => {
      if (!isIosWebKit || document.hidden) {
        return false;
      }

      const focusedTextInput = isTextInputElement(document.activeElement);
      const viewportRecentlyChanged = Date.now() - lastViewportResizeAt < fullscreenViewportSettleMs;

      return focusedTextInput || isKeyboardLikelyOpen() || viewportRecentlyChanged;
    };

    const handleBlur = () => {
      window.setTimeout(() => {
        if (Date.now() - closeSignalAt < closeSignalWindowMs || shouldIgnoreTextEntryBlur()) {
          return;
        }
        handleTabSwitch('blur');
      }, closeSignalDelayMs);
    };

    const shouldDeferFullscreenExit = () => {
      if (!isIosWebKit) {
        return false;
      }

      const focusedTextInput = isTextInputElement(document.activeElement);
      const viewportRecentlyChanged = Date.now() - lastViewportResizeAt < fullscreenViewportSettleMs;
      return focusedTextInput || isKeyboardLikelyOpen() || viewportRecentlyChanged;
    };

    const handleFullscreenChange = async (options: { forceEnforce?: boolean } = {}) => {
      if (runtimeState.phase !== 'exam' || !config.security.requireFullscreen) {
        return;
      }

      if (getFullscreenElement()) {
        fullscreenReentryAttempts.current = 0;
        clearFullscreenExitDefer();
        const currentHeight = getViewportHeight();
        viewportBaselineHeightRef.current = Math.max(viewportBaselineHeightRef.current, currentHeight);
        return;
      }

      if (!options.forceEnforce && shouldDeferFullscreenExit()) {
        if (!fullscreenExitDeferStartedAt) {
          fullscreenExitDeferStartedAt = Date.now();
        }

        if (fullscreenExitDeferTimer) {
          window.clearTimeout(fullscreenExitDeferTimer);
        }

        fullscreenExitDeferTimer = window.setTimeout(() => {
          fullscreenExitDeferTimer = null;

          if (getFullscreenElement()) {
            clearFullscreenExitDefer();
            return;
          }

          const elapsed = Date.now() - fullscreenExitDeferStartedAt;
          if (shouldDeferFullscreenExit() && elapsed < fullscreenExitMaxDeferMs) {
            // Keep deferring until the keyboard/focus settles or we hit the cap.
            void handleFullscreenChange();
            return;
          }

          clearFullscreenExitDefer();
          void handleFullscreenChange({ forceEnforce: true });
        }, fullscreenExitDeferCheckDelayMs);

        return;
      }

      const projectedViolationCount = runtimeState.fullscreenViolationCount + 1;

      if (projectedViolationCount >= config.security.fullscreenMaxViolations) {
        handleViolation(
          'FULLSCREEN_EXIT',
          'Maximum fullscreen violations exceeded. Exam terminated.',
          'critical',
        );
        return;
      }

      handleViolation(
        'FULLSCREEN_EXIT',
        config.security.fullscreenAutoReentry
          ? 'Fullscreen mode was exited. Please return to fullscreen to continue.'
          : 'You have exited fullscreen mode. The examination must be taken in fullscreen.',
        'high',
      );

      if (!config.security.fullscreenAutoReentry) {
        return;
      }

      const attemptReentry = async (attempt: number): Promise<void> => {
        if (attempt >= 3) {
          void saveStudentAuditEvent(
            scheduleId,
            'VIOLATION_DETECTED',
            {
              severity: 'high',
              message: 'Failed to re-enter fullscreen after multiple attempts.',
              violationType: 'FULLSCREEN_REENTRY_FAILED',
              attemptCount: attempt,
            },
            attemptState.attemptId ?? undefined,
          );
          fullscreenReentryAttempts.current = 0;
          return;
        }

        const success = await requestFullscreen();
        if (success) {
          fullscreenReentryAttempts.current = 0;
          return;
        }

        fullscreenReentryAttempts.current = attempt + 1;
        fullscreenReentryTimer = window.setTimeout(() => {
          void attemptReentry(attempt + 1);
        }, 1_000 * (attempt + 1));
      };

      await attemptReentry(0);
    };

    const handleFullscreenChangeEvent = () => {
      void handleFullscreenChange();
    };

    const attemptFullscreenOnGesture = () => {
      if (
        runtimeState.phase !== 'exam' ||
        !config.security.requireFullscreen ||
        !config.security.fullscreenAutoReentry
      ) {
        return;
      }

      if (!isIosWebKit) {
        return;
      }

      if (getFullscreenElement()) {
        return;
      }

      const now = Date.now();
      if (now - lastFullscreenGestureAttemptAt < fullscreenGestureAttemptCooldownMs) {
        return;
      }
      lastFullscreenGestureAttemptAt = now;
      void requestFullscreen();
    };

    const handleFocusOut = () => {
      if (runtimeState.phase !== 'exam' || !config.security.requireFullscreen) {
        return;
      }

      if (fullscreenExitDeferStartedAt) {
        void handleFullscreenChange();
      }
    };

    const handleViewportResize = () => {
      if (!isIosWebKit) {
        return;
      }

      lastViewportResizeAt = Date.now();
      const currentHeight = getViewportHeight();
      if (!isTextInputElement(document.activeElement) && currentHeight > viewportBaselineHeightRef.current) {
        viewportBaselineHeightRef.current = currentHeight;
      }

      if (fullscreenExitDeferStartedAt && !isKeyboardLikelyOpen()) {
        void handleFullscreenChange();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('fullscreenchange', handleFullscreenChangeEvent);
    document.addEventListener(
      'webkitfullscreenchange' as unknown as 'fullscreenchange',
      handleFullscreenChangeEvent,
    );
    document.addEventListener('focusout', handleFocusOut, true);
    window.visualViewport?.addEventListener('resize', handleViewportResize);
    document.addEventListener('pointerup', attemptFullscreenOnGesture, true);
    document.addEventListener('touchend', attemptFullscreenOnGesture, true);

    if (runtimeState.phase === 'exam' && config.security.detectSecondaryScreen) {
      secondaryScreenCheckTimer = window.setInterval(() => {
        void detectSecondaryScreens();
      }, secondaryScreenCheckIntervalMs);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('fullscreenchange', handleFullscreenChangeEvent);
      document.removeEventListener(
        'webkitfullscreenchange' as unknown as 'fullscreenchange',
        handleFullscreenChangeEvent,
      );
      document.removeEventListener('focusout', handleFocusOut, true);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      document.removeEventListener('pointerup', attemptFullscreenOnGesture, true);
      document.removeEventListener('touchend', attemptFullscreenOnGesture, true);
      if (tabSwitchDebounceTimer) {
        window.clearTimeout(tabSwitchDebounceTimer);
      }
      if (fullscreenReentryTimer) {
        window.clearTimeout(fullscreenReentryTimer);
      }
      if (fullscreenExitDeferTimer) {
        window.clearTimeout(fullscreenExitDeferTimer);
      }
      if (secondaryScreenCheckTimer) {
        window.clearInterval(secondaryScreenCheckTimer);
      }
    };
  }, [
    config.security,
    detectSecondaryScreens,
    handleViolation,
    requestFullscreen,
    runtimeActions,
    runtimeState.fullscreenViolationCount,
    runtimeState.phase,
    attemptState.attemptId,
    scheduleId,
  ]);

  return (
    <ProctoringContext.Provider value={{ handleViolation }}>
      {children}
    </ProctoringContext.Provider>
  );
}

export function useProctoring() {
  const context = useContext(ProctoringContext);
  if (!context) {
    throw new Error('useProctoring must be used within ProctoringProvider');
  }
  return context;
}
