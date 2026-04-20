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
  const violationCooldownMs = 5_000;
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

    if (now - lastViolationAt < violationCooldownMs) {
      return;
    }

    cooldownByTypeRef.current[type] = now;
    
    // Increment violation count for severity
    violationCountsRef.current[severity]++;
    
    const thresholds = config.security.severityThresholds;
    
    // Check severity thresholds
    if (severity === 'critical' || thresholds?.criticalAction === 'terminate') {
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
            action: 'pause',
          },
          attemptState.attemptId ?? undefined,
        );
        runtimeActions.pauseExam();
        return;
      }
    }
    
    if (severity === 'medium') {
      const mediumLimit = thresholds?.mediumLimit ?? 3;
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
      // Log permission denied as informational event
      void saveStudentAuditEvent(
        scheduleId,
        'SCREEN_CHECK_PERMISSION_DENIED',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        attemptState.attemptId ?? undefined,
      );
    }
  }, [config.security.detectSecondaryScreen, handleViolation, runtimeState.phase, scheduleId, attemptState.attemptId]);

  useEffect(() => {
    let tabSwitchDebounceTimer: number | null = null;
    let lastTabSwitchTime = 0;
    let fullscreenReentryTimer: number | null = null;
    let secondaryScreenCheckTimer: number | null = null;

    const handleTabSwitch = (eventType: string) => {
      if (
        runtimeState.phase !== 'exam' ||
        config.security.tabSwitchRule === 'none'
      ) {
        return;
      }

      const now = Date.now();
      
      // Deduplicate events within 500ms
      if (now - lastTabSwitchTime < 500) {
        return;
      }
      lastTabSwitchTime = now;

      if (tabSwitchDebounceTimer) {
        window.clearTimeout(tabSwitchDebounceTimer);
      }

      tabSwitchDebounceTimer = window.setTimeout(() => {
        if (config.security.tabSwitchRule === 'warn') {
          handleViolation(
            'TAB_SWITCH',
            `Tab switching detected via ${eventType}. You must remain on the examination page at all times.`,
            'medium',
          );
          return;
        }

        handleViolation('TAB_SWITCH', `Tab switching detected via ${eventType}. Exam terminated.`, 'critical');
        runtimeActions.terminateExam();
      }, 500);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        return;
      }
      handleTabSwitch('visibilitychange');
    };

    const handleBlur = () => {
      handleTabSwitch('blur');
    };

    const handlePageHide = () => {
      handleTabSwitch('pagehide');
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

      if (!config.security.fullscreenAutoReentry) {
        handleViolation(
          'FULLSCREEN_EXIT',
          'You have exited fullscreen mode. The examination must be taken in fullscreen.',
          'high',
        );
        return;
      }

      const attemptReentry = async (attempt: number): Promise<void> => {
        if (attempt >= 3) {
          handleViolation(
            'FULLSCREEN_EXIT',
            'Failed to re-enter fullscreen after multiple attempts.',
            'high',
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
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    if (runtimeState.phase === 'exam' && config.security.detectSecondaryScreen) {
      secondaryScreenCheckTimer = window.setInterval(() => {
        void detectSecondaryScreens();
      }, 15_000);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handlePageHide);
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
