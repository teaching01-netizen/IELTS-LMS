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

function getFullscreenElement() {
  return (
    document.fullscreenElement ??
    (
      document as Document & {
        webkitFullscreenElement?: Element | null;
      }
    ).webkitFullscreenElement ??
    null
  );
}

export function ProctoringProvider({
  children,
  config,
  scheduleId,
}: ProctoringProviderProps) {
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntime();
  const { state: attemptState } = useStudentAttempt();
  const cooldownByTypeRef = useRef<Record<string, number>>({});
  const fullscreenReentryAttempts = useRef(0);
  const fullscreenEntryAttemptedRef = useRef(false);
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
      if (getFullscreenElement()) {
        return true;
      }

      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        return true;
      }

      if ('webkitRequestFullscreen' in document.documentElement) {
        await (
          document.documentElement as HTMLElement & {
            webkitRequestFullscreen?: () => Promise<void> | void;
          }
        ).webkitRequestFullscreen?.();
        return true;
      }

      return false;
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
    let closeSignalAt = 0;

    const closeSignalWindowMs = 1_000;
    const closeSignalDelayMs = 50;
    const tabSwitchDedupeWindowMs = 300;
    const secondaryScreenCheckIntervalMs = 3_000;

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

    const handleBlur = () => {
      window.setTimeout(() => {
        if (Date.now() - closeSignalAt < closeSignalWindowMs) {
          return;
        }
        handleTabSwitch('blur');
      }, closeSignalDelayMs);
    };

    const handlePageHide = () => {
      recordCloseSignal('pagehide');
    };

    const handleBeforeUnload = () => {
      recordCloseSignal('beforeunload');
    };

    const handleFullscreenChange = async () => {
      if (runtimeState.phase !== 'exam' || !config.security.requireFullscreen) {
        return;
      }

      if (getFullscreenElement()) {
        fullscreenReentryAttempts.current = 0;
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

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

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
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (tabSwitchDebounceTimer) {
        window.clearTimeout(tabSwitchDebounceTimer);
      }
      if (fullscreenReentryTimer) {
        window.clearTimeout(fullscreenReentryTimer);
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
