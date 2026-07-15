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
import { isAppleMobileDevice } from '../appleMobileDevice';
import { useStudentAttempt } from './StudentAttemptProvider';
import { useStudentRuntime } from './StudentRuntimeProvider';
import { useStudentTranslationGuard } from './useStudentTranslationGuard';

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
  enabled?: boolean | undefined;
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
  enabled = true,
}: ProctoringProviderProps) {
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntime();
  const { state: attemptState, actions: attemptActions } = useStudentAttempt();
  const shouldPreventTranslation = config.security.preventTranslation !== false;
  const cooldownByTypeRef = useRef<Record<string, number>>({});
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
    if (!enabled) {
      return;
    }

    const now = Date.now();
    const lastViolationAt = cooldownByTypeRef.current[type] ?? 0;

    const violationCooldownMs =
      type === 'TAB_SWITCH'
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
    const recordViolation = () => {
      const timestamp = new Date().toISOString();
      const violationId = `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const violation = {
        id: violationId,
        type,
        severity,
        timestamp,
        description: message,
      };
      runtimeActions.addViolation(type, severity, message, violationId, timestamp);
      attemptActions.persistViolation(violation);
      return { violationId, timestamp };
    };
    
    // Check severity thresholds
    if (severity === 'critical') {
      // Always terminate on critical
      const { violationId } = recordViolation();
      void saveStudentAuditEvent(
        scheduleId,
        'VIOLATION_DETECTED',
        {
          violationId,
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
        const { violationId } = recordViolation();
        void saveStudentAuditEvent(
          scheduleId,
          'VIOLATION_DETECTED',
          {
            violationId,
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
        const { violationId } = recordViolation();
        void saveStudentAuditEvent(
          scheduleId,
          'VIOLATION_DETECTED',
          {
            violationId,
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
        const { violationId } = recordViolation();
        void saveStudentAuditEvent(
          scheduleId,
          'VIOLATION_DETECTED',
          {
            violationId,
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
    const { violationId } = recordViolation();
    void saveStudentAuditEvent(
      scheduleId,
      'VIOLATION_DETECTED',
      {
        violationId,
        severity,
        message,
        violationType: type,
      },
      attemptState.attemptId ?? undefined,
    );
  }, [
    attemptActions,
    attemptState.attemptId,
    config.progression.allowPause,
    config.progression.warningThreshold,
    config.security.severityThresholds,
    enabled,
    runtimeActions,
    scheduleId,
  ]);

  useStudentTranslationGuard(
    enabled && runtimeState.phase === 'exam' && shouldPreventTranslation,
    handleViolation,
  );

  const detectSecondaryScreens = useCallback(async () => {
    if (!enabled || !config.security.detectSecondaryScreen || runtimeState.phase !== 'exam') {
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
    enabled,
    handleViolation,
    runtimeState.phase,
    scheduleId,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let tabSwitchDebounceTimer: number | null = null;
    let lastTabSwitchTime = 0;
    let secondaryScreenCheckTimer: number | null = null;
    let closeSignalAt = 0;
    let lastViewportResizeAt = 0;

    const closeSignalWindowMs = 1_000;
    const closeSignalDelayMs = 200;
    const visibilityCloseCorrelationDelayMs = 500;
    const tabSwitchDedupeWindowMs = 300;
    const secondaryScreenCheckIntervalMs = 3_000;
    const viewportSettleMs = 1_000;

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
        if (!document.hidden) {
          return;
        }
        if (Date.now() - closeSignalAt < closeSignalWindowMs) {
          return;
        }
        handleTabSwitch('visibilitychange');
      }, visibilityCloseCorrelationDelayMs);
    };

    const handlePageHide = () => {
      recordCloseSignal('pagehide');
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      recordCloseSignal('beforeunload');

      if (runtimeState.phase !== 'exam') {
        return;
      }

      const syncState = attemptState.attempt?.recovery.syncState;
      const hasUnsyncedAttemptState =
        attemptState.pendingMutationCount > 0 ||
        syncState === 'saving' ||
        syncState === 'offline' ||
        syncState === 'syncing_reconnect' ||
        syncState === 'error';

      if (!hasUnsyncedAttemptState) {
        return;
      }

      event.preventDefault();
      event.returnValue = 'Unsynced answers may be lost.';
    };

    const isIosWebKit = isAppleMobileDevice(navigator.userAgent);

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
      const viewportRecentlyChanged = Date.now() - lastViewportResizeAt < viewportSettleMs;

      return focusedTextInput || isKeyboardLikelyOpen() || viewportRecentlyChanged;
    };

    const handleBlur = () => {
      window.setTimeout(() => {
        // Ignore blur-only transitions (browser popups/dialogs) unless the tab actually became hidden.
        if (!document.hidden) {
          return;
        }

        if (Date.now() - closeSignalAt < closeSignalWindowMs || shouldIgnoreTextEntryBlur()) {
          return;
        }
        handleTabSwitch('blur');
      }, closeSignalDelayMs);
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
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.visualViewport?.addEventListener('resize', handleViewportResize);

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
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
      if (tabSwitchDebounceTimer) {
        window.clearTimeout(tabSwitchDebounceTimer);
      }
      if (secondaryScreenCheckTimer) {
        window.clearInterval(secondaryScreenCheckTimer);
      }
    };
  }, [
    attemptState.attempt?.recovery.syncState,
    config.security,
    detectSecondaryScreens,
    enabled,
    handleViolation,
    attemptState.pendingMutationCount,
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
