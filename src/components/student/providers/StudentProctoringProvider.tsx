import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useExamVisibilityIntegrity } from '@student/api/useExamVisibilityIntegrity';
import {
  EXAM_VISIBILITY_WARNING_MESSAGE,
  examVisibilityAuditDetail,
  type ExamVisibilityExcursion,
} from '@student/api/examVisibilityIntegrity';
import { saveStudentAuditEvent } from '@student/application/studentAttemptFacade';
import { ExamConfig, ViolationSeverity } from '../../../types';
import { useStudentAttempt } from './StudentAttemptProvider';
import { useStudentRuntime, useStudentRuntimeSession } from './StudentRuntimeProvider';
import { useStudentTranslationGuard } from './useStudentTranslationGuard';

interface ProctoringContextValue {
  /**
   * Records one violation through the existing pipeline: runtime violation →
   * attempt persistence → `VIOLATION_DETECTED` audit → severity policy. The
   * optional `details` are merged into the audit payload (never into the
   * student-visible message) so integrity events can carry the evidence that
   * applies to them without changing the shared enforcement path.
   */
  handleViolation: (
    type: string,
    message: string,
    severity?: ViolationSeverity,
    details?: Record<string, unknown>,
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

export function ProctoringProvider({
  children,
  config,
  scheduleId,
  enabled = true,
}: ProctoringProviderProps) {
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntimeSession();
  const { state: attemptState, actions: attemptActions } = useStudentAttempt();
  const shouldPreventTranslation = config.security.preventTranslation !== false;
  const cooldownByTypeRef = useRef<Record<string, number>>({});
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
  const configRef = useRef(config);
  const runtimeStateRef = useRef(runtimeState);
  const runtimeActionsRef = useRef(runtimeActions);
  const attemptStateRef = useRef(attemptState);
  const attemptActionsRef = useRef(attemptActions);
  const enabledRef = useRef(enabled);
  const scheduleIdRef = useRef(scheduleId);

  useLayoutEffect(() => {
    configRef.current = config;
    runtimeStateRef.current = runtimeState;
    runtimeActionsRef.current = runtimeActions;
    attemptStateRef.current = attemptState;
    attemptActionsRef.current = attemptActions;
    enabledRef.current = enabled;
    scheduleIdRef.current = scheduleId;
  }, [attemptActions, attemptState, config, enabled, runtimeActions, runtimeState, scheduleId]);

  const handleViolation = useCallback((
    type: string,
    message: string,
    severity: ViolationSeverity = 'medium',
    details?: Record<string, unknown>,
  ) => {
    if (!enabledRef.current) {
      return;
    }
    const auditDetail = details ?? {};

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
    
    const thresholds = configRef.current.security.severityThresholds;
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
      runtimeActionsRef.current.addViolation(type, severity, message, violationId, timestamp);
      attemptActionsRef.current.persistViolation(violation);
      return { violationId, timestamp };
    };
    
    // Check severity thresholds
    if (severity === 'critical') {
      // Always terminate on critical
      const { violationId } = recordViolation();
      void saveStudentAuditEvent(
        scheduleIdRef.current,
        'VIOLATION_DETECTED',
        {
          violationId,
          severity,
          message,
          violationType: type,
          action: 'terminate',
          ...auditDetail,
        },
        attemptStateRef.current.attemptId ?? undefined,
      );
      runtimeActionsRef.current.terminateExam();
      return;
    }
    
    if (severity === 'high') {
      const highLimit = thresholds?.highLimit ?? 2;
      if (violationCountsRef.current.high >= highLimit) {
        const { violationId } = recordViolation();
        void saveStudentAuditEvent(
          scheduleIdRef.current,
          'VIOLATION_DETECTED',
          {
            violationId,
            severity,
            message,
            violationType: type,
            count: violationCountsRef.current.high,
            threshold: highLimit,
            action: configRef.current.progression.allowPause ? 'pause' : 'terminate',
            ...auditDetail,
          },
          attemptStateRef.current.attemptId ?? undefined,
        );
        if (configRef.current.progression.allowPause) {
          runtimeActionsRef.current.pauseExam();
        } else {
          runtimeActionsRef.current.terminateExam();
        }
        return;
      }
    }
    
    if (severity === 'medium') {
      const mediumLimit = thresholds?.mediumLimit ?? configRef.current.progression.warningThreshold ?? 3;
      if (violationCountsRef.current.medium >= mediumLimit) {
        const { violationId } = recordViolation();
        void saveStudentAuditEvent(
          scheduleIdRef.current,
          'VIOLATION_DETECTED',
          {
            violationId,
            severity,
            message,
            violationType: type,
            count: violationCountsRef.current.medium,
            threshold: mediumLimit,
            action: 'warn',
            ...auditDetail,
          },
          attemptStateRef.current.attemptId ?? undefined,
        );
        return;
      }
    }
    
    if (severity === 'low') {
      const lowLimit = thresholds?.lowLimit ?? 5;
      if (violationCountsRef.current.low >= lowLimit) {
        const { violationId } = recordViolation();
        void saveStudentAuditEvent(
          scheduleIdRef.current,
          'VIOLATION_DETECTED',
          {
            violationId,
            severity,
            message,
            violationType: type,
            count: violationCountsRef.current.low,
            threshold: lowLimit,
            action: 'warn',
            ...auditDetail,
          },
          attemptStateRef.current.attemptId ?? undefined,
        );
        return;
      }
    }
    
    // Default: just log the violation
    const { violationId } = recordViolation();
    void saveStudentAuditEvent(
      scheduleIdRef.current,
      'VIOLATION_DETECTED',
      {
        violationId,
        severity,
        message,
        violationType: type,
        ...auditDetail,
      },
      attemptStateRef.current.attemptId ?? undefined,
    );
  }, []);

  useStudentTranslationGuard(
    enabled && runtimeState.phase === 'exam' && shouldPreventTranslation,
    handleViolation,
  );

  /**
   * Tab/app-switch policy adapter.
   *
   * Detection is shared (`useExamVisibilityIntegrity`); only the reaction is
   * IELTS/ACT-specific, and it reuses the existing `handleViolation` pipeline
   * (runtime violation → attempt persistence → audit → severity policy) rather
   * than opening a second persistence path.
   *
   *   none      -> the shared hook never runs
   *   warn      -> record + let the blocking warning overlay ask to continue
   *   terminate -> record + existing termination policy (no escape hatch)
   */
  const handleVisibilityExcursion = useCallback((excursion: ExamVisibilityExcursion) => {
    if (configRef.current.security.tabSwitchRule === 'terminate') {
      handleViolation(
        'TAB_SWITCH',
        `${EXAM_VISIBILITY_WARNING_MESSAGE} The exam has been terminated.`,
        'critical',
        examVisibilityAuditDetail(excursion),
      );
      return;
    }

    handleViolation(
      'TAB_SWITCH',
      EXAM_VISIBILITY_WARNING_MESSAGE,
      'medium',
      examVisibilityAuditDetail(excursion),
    );
  }, [handleViolation]);

  useExamVisibilityIntegrity({
    active: enabled && runtimeState.phase === 'exam',
    enabled: enabled && config.security.tabSwitchRule !== 'none',
    onViolation: handleVisibilityExcursion,
  });

  const detectSecondaryScreens = useCallback(async () => {
    if (
      !enabledRef.current
      || !configRef.current.security.detectSecondaryScreen
      || runtimeStateRef.current.phase !== 'exam'
    ) {
      return;
    }

    if (screenDetailsUnsupportedRef.current) {
      return;
    }

    if (!('getScreenDetails' in window)) {
      // Log unsupported API as informational event
      if (!isSafariBrowser()) {
        void saveStudentAuditEvent(
          scheduleIdRef.current,
          'SCREEN_CHECK_UNSUPPORTED',
          {
            browser: navigator.userAgent,
            userAgent: navigator.userAgent,
          },
          attemptStateRef.current.attemptId ?? undefined,
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
        scheduleIdRef.current,
        'SCREEN_CHECK_PERMISSION_DENIED',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        attemptStateRef.current.attemptId ?? undefined,
      );
    }
  }, [handleViolation]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let secondaryScreenCheckTimer: number | null = null;

    const secondaryScreenCheckIntervalMs = 3_000;

    // Presence telemetry only. `pagehide`/`beforeunload` are far too
    // unreliable (especially on mobile) to decide a tab switch, so they are
    // never consulted for the violation: they only report that the document is
    // going away.
    const recordCloseSignal = (eventType: string) => {
      if (runtimeStateRef.current.phase !== 'exam') {
        return;
      }

      void saveStudentAuditEvent(
        scheduleIdRef.current,
        'BROWSER_CLOSE_DETECTED',
        {
          eventType,
          timestamp: new Date().toISOString(),
        },
        attemptStateRef.current.attemptId ?? undefined,
      );
    };

    const handlePageHide = () => {
      recordCloseSignal('pagehide');
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      recordCloseSignal('beforeunload');

      if (runtimeStateRef.current.phase !== 'exam') {
        return;
      }

      const syncState = attemptStateRef.current.attempt?.recovery.syncState;
      const hasUnsyncedAttemptState =
        attemptStateRef.current.pendingMutationCount > 0 ||
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

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);

    if (runtimeState.phase === 'exam' && config.security.detectSecondaryScreen) {
      secondaryScreenCheckTimer = window.setInterval(() => {
        void detectSecondaryScreens();
      }, secondaryScreenCheckIntervalMs);
    }

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (secondaryScreenCheckTimer) {
        window.clearInterval(secondaryScreenCheckTimer);
      }
    };
  }, [config.security.detectSecondaryScreen, detectSecondaryScreens, enabled, handleViolation, runtimeState.phase]);

  return (
    <ProctoringContext.Provider value={React.useMemo(() => ({ handleViolation }), [handleViolation])}>
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
