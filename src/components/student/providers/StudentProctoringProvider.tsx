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

export function ProctoringProvider({
  children,
  config,
  scheduleId,
}: ProctoringProviderProps) {
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntime();
  const { state: attemptState } = useStudentAttempt();
  const cooldownByTypeRef = useRef<Record<string, number>>({});
  const fullscreenReentryAttempts = useRef(0);
  const violationCooldownMs = 5_000;

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
  }, [attemptState.attemptId, runtimeActions, scheduleId]);

  const requestFullscreen = useCallback(async (): Promise<boolean> => {
    try {
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

  const detectSecondaryScreens = useCallback(async () => {
    if (!config.security.detectSecondaryScreen || runtimeState.phase !== 'exam') {
      return;
    }

    if (!('getScreenDetails' in window)) {
      if (isSafariBrowser()) {
        return;
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
    } catch {
      // Permission denial is non-actionable here.
    }
  }, [config.security.detectSecondaryScreen, handleViolation, runtimeState.phase]);

  useEffect(() => {
    let tabSwitchDebounceTimer: number | null = null;
    let fullscreenReentryTimer: number | null = null;
    let secondaryScreenCheckTimer: number | null = null;

    const handleVisibilityChange = () => {
      if (
        !document.hidden ||
        runtimeState.phase !== 'exam' ||
        config.security.tabSwitchRule === 'none'
      ) {
        return;
      }

      if (tabSwitchDebounceTimer) {
        window.clearTimeout(tabSwitchDebounceTimer);
      }

      tabSwitchDebounceTimer = window.setTimeout(() => {
        if (config.security.tabSwitchRule === 'warn') {
          handleViolation(
            'TAB_SWITCH',
            'Tab switching detected. You must remain on the examination page at all times.',
            'medium',
          );
          return;
        }

        handleViolation('TAB_SWITCH', 'Tab switching detected. Exam terminated.', 'critical');
        runtimeActions.terminateExam();
      }, 500);
    };

    const handleFullscreenChange = async () => {
      if (runtimeState.phase !== 'exam' || !config.security.requireFullscreen) {
        return;
      }

      if (document.fullscreenElement) {
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
        runtimeActions.terminateExam();
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
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    if (runtimeState.phase === 'exam' && config.security.detectSecondaryScreen) {
      secondaryScreenCheckTimer = window.setInterval(() => {
        void detectSecondaryScreens();
      }, 15_000);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
