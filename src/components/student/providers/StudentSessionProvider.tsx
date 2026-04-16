/**
 * Legacy student provider kept for reference only.
 *
 * The active student runtime lives in `StudentRuntimeProvider`.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ExamConfig } from '../../../types';

export type ExamPhase = 'pre-check' | 'lobby' | 'exam' | 'post-exam';

interface TimeWarning {
  level: 'info' | 'warning' | 'critical';
  message: string;
}

interface ProctoringWarning {
  isOpen: boolean;
  severity: 'medium' | 'high' | 'critical';
  message: string;
}

interface StudentSessionState {
  phase: ExamPhase;
  timeRemaining: number;
  elapsedTime: number;
  timeWarning: TimeWarning | null;
  shownWarnings: Set<number>;
  autoSaveStatus: 'saved' | 'saving' | null;
  proctoringWarning: ProctoringWarning;
  violationCount: number;
  isFullscreenRequired: boolean;
}

interface StudentSessionActions {
  setPhase: (phase: ExamPhase) => void;
  setTimeRemaining: (time: number) => void;
  resetElapsedTime: () => void;
  dismissTimeWarning: () => void;
  setAutoSaveStatus: (status: 'saved' | 'saving' | null) => void;
  showProctoringWarning: (severity: 'medium' | 'high' | 'critical', message: string) => void;
  dismissProctoringWarning: () => void;
  incrementViolationCount: () => number;
  requestFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
}

interface StudentSessionContextValue {
  state: StudentSessionState;
  actions: StudentSessionActions;
}

const StudentSessionContext = createContext<StudentSessionContextValue | null>(null);

interface StudentSessionProviderProps {
  children: ReactNode;
  config: ExamConfig;
  runtimeBacked?: boolean;
  runtimeSnapshot?: {
    currentSectionRemainingSeconds?: number;
    status?: string;
    waitingForNextSection?: boolean;
  } | null;
}

export function StudentSessionProvider({ 
  children, 
  config, 
  runtimeBacked = false,
  runtimeSnapshot = null 
}: StudentSessionProviderProps) {
  const [phase, setPhase] = useState<ExamPhase>(runtimeBacked ? 'exam' : 'pre-check');
  const [timeRemaining, setTimeRemaining] = useState<number>(
    runtimeBacked
      ? runtimeSnapshot?.currentSectionRemainingSeconds || 0
      : 0
  );
  const [elapsedTime, setElapsedTime] = useState(0);
  const [timeWarning, setTimeWarning] = useState<TimeWarning | null>(null);
  const [shownWarnings, setShownWarnings] = useState<Set<number>>(new Set());
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | null>(null);
  const [proctoringWarning, setProctoringWarning] = useState<ProctoringWarning>({
    isOpen: false,
    severity: 'medium',
    message: '',
  });
  const [violationCount, setViolationCount] = useState(0);

  const isFullscreenRequired = config.security.requireFullscreen;

  // Sync phase with runtime state
  useEffect(() => {
    if (!runtimeBacked) {
      return;
    }

    setPhase('exam');

    if (runtimeSnapshot?.status === 'completed') {
      setPhase('post-exam');
    }
  }, [runtimeBacked, runtimeSnapshot?.status]);

  // Timer effect
  useEffect(() => {
    if (runtimeBacked) {
      return;
    }

    if (phase === 'exam' && timeRemaining > 0 && !proctoringWarning.isOpen) {
      const timer = setInterval(() => {
        setTimeRemaining(prev => prev - 1);
        setElapsedTime(prev => prev + 1);
      }, 1000);
      return () => clearInterval(timer);
    } else if (phase === 'exam' && timeRemaining <= 0 && config.progression.autoSubmit) {
      // Auto-submit will be handled by the component
    }
    return undefined;
  }, [phase, runtimeBacked, timeRemaining, proctoringWarning.isOpen, config.progression.autoSubmit]);

  // Time warnings
  useEffect(() => {
    if (runtimeBacked || phase !== 'exam') return;

    const warningThresholds = [
      { seconds: 600, level: 'info' as const, message: '10 minutes remaining' },
      { seconds: 300, level: 'warning' as const, message: '5 minutes remaining' },
      { seconds: 60, level: 'critical' as const, message: '1 minute remaining' },
    ];

    for (const threshold of warningThresholds) {
      if (timeRemaining === threshold.seconds && !shownWarnings.has(threshold.seconds)) {
        setTimeWarning({ level: threshold.level, message: threshold.message });
        setShownWarnings(prev => new Set([...prev, threshold.seconds]));
        
        setTimeout(() => {
          setTimeWarning(null);
        }, 5000);
        break;
      }
    }
  }, [timeRemaining, runtimeBacked, phase, shownWarnings]);

  const resetElapsedTime = useCallback(() => {
    setElapsedTime(0);
  }, []);

  const dismissTimeWarning = useCallback(() => {
    setTimeWarning(null);
  }, []);

  const showProctoringWarning = useCallback((severity: 'medium' | 'high' | 'critical', message: string) => {
    setProctoringWarning({
      isOpen: true,
      severity,
      message,
    });
  }, []);

  const dismissProctoringWarning = useCallback(() => {
    setProctoringWarning(prev => ({ ...prev, isOpen: false }));
  }, []);

  const incrementViolationCount = useCallback(() => {
    setViolationCount(prev => prev + 1);
    return violationCount + 1;
  }, [violationCount]);

  const requestFullscreen = useCallback(async () => {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      try {
        await elem.requestFullscreen();
      } catch (err) {
        console.error(`Error attempting to enable full-screen mode: ${err}`);
      }
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    if (document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore errors
      }
    }
  }, []);

  const state: StudentSessionState = {
    phase,
    timeRemaining,
    elapsedTime,
    timeWarning,
    shownWarnings,
    autoSaveStatus,
    proctoringWarning,
    violationCount,
    isFullscreenRequired,
  };

  const actions: StudentSessionActions = {
    setPhase,
    setTimeRemaining,
    resetElapsedTime,
    dismissTimeWarning,
    setAutoSaveStatus,
    showProctoringWarning,
    dismissProctoringWarning,
    incrementViolationCount,
    requestFullscreen,
    exitFullscreen,
  };

  return (
    <StudentSessionContext.Provider value={{ state, actions }}>
      {children}
    </StudentSessionContext.Provider>
  );
}

export function useStudentSession() {
  const context = useContext(StudentSessionContext);
  if (!context) {
    throw new Error('useStudentSession must be used within StudentSessionProvider');
  }
  return context;
}
