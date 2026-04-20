import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { backendPost, isBackendDeliveryEnabled } from '@services/backendBridge';
import { buildStudentHeartbeatEvent } from '@services/studentIntegrityService';
import { mapBackendStudentAttempt, studentAttemptRepository } from '@services/studentAttemptRepository';
import { saveStudentAuditEvent } from '@services/studentAuditService';
import type { ModuleType, Violation } from '../../../types';
import type {
  AttemptSyncState,
  HeartbeatEventType,
  StudentAnswerValue,
  StudentAttempt,
  StudentAttemptMutation,
  StudentAttemptMutationType,
  StudentPreCheckResult,
} from '../../../types/studentAttempt';
import { useStudentRuntime } from './StudentRuntimeProvider';

interface StudentAttemptState {
  attempt: StudentAttempt | null;
  attemptId: string | null;
  lastLocalMutationAt: string | null;
  lastPersistedAt: string | null;
  pendingMutationCount: number;
}

interface StudentAttemptActions {
  persistAnswer: (questionId: string, answer: StudentAnswerValue) => void;
  persistWritingAnswer: (taskId: string, text: string) => void;
  persistFlag: (questionId: string, flagged: boolean) => void;
  persistViolation: (violation: Violation) => void;
  persistPosition: (
    currentModule: ModuleType,
    currentQuestionId: string | null,
    phase: StudentAttempt['phase'],
  ) => void;
  recordPreCheckResult: (result: StudentPreCheckResult) => Promise<void>;
  recordNetworkStatus: (status: 'offline' | 'online', timestamp?: string) => Promise<void>;
  recordHeartbeat: (
    type: HeartbeatEventType,
    payload?: Record<string, unknown>,
  ) => Promise<void>;
  acknowledgeProctorWarning: (warningId: string) => Promise<void>;
  submitAttempt: () => Promise<void>;
  setDeviceFingerprintHash: (hash: string) => Promise<void>;
  flushPending: () => Promise<boolean>;
}

interface StudentAttemptContextValue {
  state: StudentAttemptState;
  actions: StudentAttemptActions;
}

interface StudentAttemptProviderProps {
  children: ReactNode;
  scheduleId?: string | undefined;
  attemptSnapshot?: StudentAttempt | null;
}

type AttemptPatch = Omit<Partial<StudentAttempt>, 'integrity' | 'recovery'> & {
  integrity?: Partial<StudentAttempt['integrity']> | undefined;
  recovery?: Partial<StudentAttempt['recovery']> | undefined;
};

type ObservedSnapshot = {
  answers: string;
  writingAnswers: string;
  flags: string;
  violations: string;
  position: string;
};

const StudentAttemptContext = createContext<StudentAttemptContextValue | null>(null);

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
}

function getClientSessionId(scheduleId: string, studentKey: string): string {
  if (typeof window === 'undefined') {
    return generateUuid();
  }

  const storageKey = `ielts-student-client-session:${scheduleId}:${studentKey}`;
  const stored = window.sessionStorage.getItem(storageKey);
  if (stored) {
    return stored;
  }

  const nextId = generateUuid();
  window.sessionStorage.setItem(storageKey, nextId);
  return nextId;
}

function mergeAttempt(attempt: StudentAttempt, patch: AttemptPatch): StudentAttempt {
  return {
    ...attempt,
    ...patch,
    answers: patch.answers ? { ...attempt.answers, ...patch.answers } : attempt.answers,
    writingAnswers: patch.writingAnswers
      ? { ...attempt.writingAnswers, ...patch.writingAnswers }
      : attempt.writingAnswers,
    flags: patch.flags ? { ...attempt.flags, ...patch.flags } : attempt.flags,
    violations: patch.violations ?? attempt.violations,
    integrity: patch.integrity
      ? {
          ...attempt.integrity,
          ...patch.integrity,
        }
      : attempt.integrity,
    recovery: patch.recovery
      ? {
          ...attempt.recovery,
          ...patch.recovery,
        }
      : attempt.recovery,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
}

function createObservedSnapshot(attempt: StudentAttempt | null): ObservedSnapshot {
  return {
    answers: JSON.stringify(attempt?.answers ?? {}),
    writingAnswers: JSON.stringify(attempt?.writingAnswers ?? {}),
    flags: JSON.stringify(attempt?.flags ?? {}),
    violations: JSON.stringify(attempt?.violations ?? []),
    position: JSON.stringify({
      phase: attempt?.phase ?? 'pre-check',
      currentModule: attempt?.currentModule ?? 'listening',
      currentQuestionId: attempt?.currentQuestionId ?? null,
    }),
  };
}

export function StudentAttemptProvider({
  children,
  scheduleId,
  attemptSnapshot = null,
}: StudentAttemptProviderProps) {
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntime();
  const setRuntimeAttemptSyncState = runtimeActions.setAttemptSyncState;
  const [attempt, setAttempt] = useState<StudentAttempt | null>(attemptSnapshot);
  const [pendingMutationCount, setPendingMutationCount] = useState(0);
  const attemptRef = useRef<StudentAttempt | null>(attemptSnapshot);
  const pendingMutationsRef = useRef<StudentAttemptMutation[]>([]);
  const observedRef = useRef<ObservedSnapshot>(createObservedSnapshot(attemptSnapshot));
  const objectiveFlushTimeoutRef = useRef<number | null>(null);
  const writingFlushTimeoutRef = useRef<number | null>(null);
  const flushPendingRef = useRef<() => Promise<boolean>>(async () => true);
  const flushInFlightRef = useRef<Promise<boolean> | null>(null);

  const setPendingMutations = useCallback((nextMutations: StudentAttemptMutation[]) => {
    pendingMutationsRef.current = nextMutations;
    setPendingMutationCount(nextMutations.length);

    if (attemptRef.current) {
      void studentAttemptRepository.savePendingMutations(
        attemptRef.current.id,
        nextMutations,
      );
    }
  }, []);

  const syncAttemptState = useCallback((nextAttempt: StudentAttempt) => {
    attemptRef.current = nextAttempt;
    setAttempt(nextAttempt);
    setRuntimeAttemptSyncState(nextAttempt.recovery.syncState);
  }, [setRuntimeAttemptSyncState]);

  const scheduleFlush = useCallback((kind: 'objective' | 'writing', delayMs: number) => {
    const timeoutRef =
      kind === 'writing' ? writingFlushTimeoutRef : objectiveFlushTimeoutRef;

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      void flushPendingRef.current();
    }, delayMs);
  }, []);

  const applyPatch = useCallback(async (
    patch: AttemptPatch,
    mutationType: StudentAttemptMutationType,
    delayMs: number,
    payload: Record<string, unknown>,
  ) => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    const timestamp = new Date().toISOString();
    const mutation: StudentAttemptMutation = {
      id: generateId('mutation'),
      attemptId: currentAttempt.id,
      scheduleId: currentAttempt.scheduleId,
      timestamp,
      type: mutationType,
      payload,
    };
    const nextPendingMutations = [...pendingMutationsRef.current, mutation];
    setPendingMutations(nextPendingMutations);

    const syncState: AttemptSyncState = navigator.onLine ? 'saving' : 'offline';
    const nextAttempt = mergeAttempt(currentAttempt, {
      ...patch,
      recovery: {
        ...patch.recovery,
        lastLocalMutationAt: timestamp,
        pendingMutationCount: nextPendingMutations.length,
        syncState,
      },
    });

    syncAttemptState(nextAttempt);

    if (navigator.onLine) {
      scheduleFlush(
        mutationType === 'writing_answer' ? 'writing' : 'objective',
        delayMs,
      );
    }
  }, [scheduleFlush, setPendingMutations, syncAttemptState]);

  const flushPending = useCallback(async () => {
    if (flushInFlightRef.current) {
      return flushInFlightRef.current;
    }

    const promise = (async () => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return true;
    }

    if (!navigator.onLine) {
      const offlineAttempt = mergeAttempt(currentAttempt, {
        recovery: {
          syncState: 'offline',
          pendingMutationCount: pendingMutationsRef.current.length,
        },
      });
      syncAttemptState(offlineAttempt);
      return false;
    }

    if (pendingMutationsRef.current.length === 0) {
      setRuntimeAttemptSyncState(currentAttempt.recovery.syncState);
      return true;
    }

    const savingAttempt = mergeAttempt(currentAttempt, {
      recovery: {
        syncState: 'saving',
        pendingMutationCount: pendingMutationsRef.current.length,
      },
    });
    syncAttemptState(savingAttempt);

    try {
      const persistedAt = new Date().toISOString();
      const persistedAttempt = mergeAttempt(savingAttempt, {
        recovery: {
          lastPersistedAt: persistedAt,
          pendingMutationCount: 0,
          syncState: 'saved',
        },
      });

      await studentAttemptRepository.saveAttempt(persistedAttempt);
      await studentAttemptRepository.clearPendingMutations(persistedAttempt.id);
      pendingMutationsRef.current = [];
      setPendingMutationCount(0);
      syncAttemptState(persistedAttempt);
      return true;
    } catch {
      const erroredAttempt = mergeAttempt(savingAttempt, {
        recovery: {
          syncState: navigator.onLine ? 'error' : 'offline',
          pendingMutationCount: pendingMutationsRef.current.length,
        },
      });
      syncAttemptState(erroredAttempt);
      return false;
    }
    })();

    flushInFlightRef.current = promise;
    try {
      return await promise;
    } finally {
      if (flushInFlightRef.current === promise) {
        flushInFlightRef.current = null;
      }
    }
  }, [setRuntimeAttemptSyncState, syncAttemptState]);

  useEffect(() => {
    flushPendingRef.current = flushPending;
  }, [flushPending]);

  useEffect(() => {
    let cancelled = false;

    if (!attemptSnapshot) {
      attemptRef.current = null;
      observedRef.current = createObservedSnapshot(null);
      setRuntimeAttemptSyncState('idle');
      setAttempt(null);
      setPendingMutationCount(0);
      pendingMutationsRef.current = [];
      return;
    }

    if (
      attemptRef.current?.id === attemptSnapshot.id &&
      pendingMutationsRef.current.length > 0
    ) {
      return;
    }

    attemptRef.current = attemptSnapshot;
    setAttempt(attemptSnapshot);
    observedRef.current = createObservedSnapshot(attemptSnapshot);
    setRuntimeAttemptSyncState(attemptSnapshot.recovery.syncState);

    void (async () => {
      const pendingMutations = await studentAttemptRepository.getPendingMutations(
        attemptSnapshot.id,
      );
      if (cancelled) {
        return;
      }

      pendingMutationsRef.current = pendingMutations;
      setPendingMutationCount(pendingMutations.length);

      if (pendingMutations.length > 0 && navigator.onLine) {
        await flushPending();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attemptSnapshot, flushPending, setRuntimeAttemptSyncState]);

  useEffect(() => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    const nextObserved: ObservedSnapshot = {
      answers: JSON.stringify(runtimeState.answers),
      writingAnswers: JSON.stringify(runtimeState.writingAnswers),
      flags: JSON.stringify(runtimeState.flags),
      violations: JSON.stringify(runtimeState.violations),
      position: JSON.stringify({
        phase: runtimeState.phase,
        currentModule: runtimeState.currentModule,
        currentQuestionId: runtimeState.currentQuestionId,
      }),
    };

    const objectivePatch: AttemptPatch = {};

    if (nextObserved.violations !== observedRef.current.violations) {
      objectivePatch.violations = runtimeState.violations;
    }

    if (nextObserved.position !== observedRef.current.position) {
      objectivePatch.phase = runtimeState.phase;
      objectivePatch.currentModule = runtimeState.currentModule;
      objectivePatch.currentQuestionId = runtimeState.currentQuestionId;
    }

    if (nextObserved.violations !== observedRef.current.violations) {
      void applyPatch(objectivePatch, 'violation', 400, {
        changedAreas: ['violation'],
        violations: runtimeState.violations,
      });
    }

    if (nextObserved.position !== observedRef.current.position) {
      void applyPatch(objectivePatch, 'position', 400, {
        changedAreas: ['position'],
        phase: runtimeState.phase,
        currentModule: runtimeState.currentModule,
        currentQuestionId: runtimeState.currentQuestionId,
      });
    }

    observedRef.current = nextObserved;
  }, [
    applyPatch,
    runtimeState.answers,
    runtimeState.currentModule,
    runtimeState.currentQuestionId,
    runtimeState.flags,
    runtimeState.phase,
    runtimeState.violations,
    runtimeState.writingAnswers,
  ]);

  useEffect(() => {
    return () => {
      if (objectiveFlushTimeoutRef.current) {
        window.clearTimeout(objectiveFlushTimeoutRef.current);
      }
      if (writingFlushTimeoutRef.current) {
        window.clearTimeout(writingFlushTimeoutRef.current);
      }
    };
  }, []);

  const persistAnswer = useCallback((questionId: string, answer: StudentAnswerValue) => {
    void applyPatch(
      {
        answers: {
          [questionId]: answer,
        },
      },
      'answer',
      400,
      { questionId, value: answer },
    );
  }, [applyPatch]);

  const persistWritingAnswer = useCallback((taskId: string, text: string) => {
    void applyPatch(
      {
        writingAnswers: {
          [taskId]: text,
        },
      },
      'writing_answer',
      1_500,
      { taskId, value: text },
    );
  }, [applyPatch]);

  const persistFlag = useCallback((questionId: string, flagged: boolean) => {
    void applyPatch(
      {
        flags: {
          [questionId]: flagged,
        },
      },
      'flag',
      400,
      { questionId, value: flagged },
    );
  }, [applyPatch]);

  const persistViolation = useCallback((violation: Violation) => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    const nextViolations = currentAttempt.violations.some((candidate) => candidate.id === violation.id)
      ? currentAttempt.violations
      : [...currentAttempt.violations, violation];

    void applyPatch(
      {
        violations: nextViolations,
      },
      'violation',
      400,
      {
        violationId: violation.id,
        violationType: violation.type,
      },
    );
  }, [applyPatch]);

  const persistPosition = useCallback((
    currentModule: ModuleType,
    currentQuestionId: string | null,
    phase: StudentAttempt['phase'],
  ) => {
    void applyPatch(
      {
        currentModule,
        currentQuestionId,
        phase,
      },
      'position',
      400,
      {
        currentModule,
        currentQuestionId,
        phase,
      },
    );
  }, [applyPatch]);

  const recordPreCheckResult = useCallback(async (result: StudentPreCheckResult) => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      throw new Error('Missing student attempt context.');
    }

    const resolvedScheduleId = scheduleId ?? currentAttempt.scheduleId;

    if (isBackendDeliveryEnabled()) {
      try {
        const persisted = await backendPost<any>(
          `/v1/student/sessions/${resolvedScheduleId}/precheck`,
          {
            studentKey: currentAttempt.studentKey,
            candidateId: currentAttempt.candidateId,
            candidateName: currentAttempt.candidateName,
            candidateEmail: currentAttempt.candidateEmail,
            clientSessionId: getClientSessionId(resolvedScheduleId, currentAttempt.studentKey),
            preCheck: result,
            deviceFingerprintHash: currentAttempt.integrity.deviceFingerprintHash ?? undefined,
          },
          { retries: 0 },
        );
        const nextAttempt = mapBackendStudentAttempt(persisted);
        // The pre-check POST is authoritative in runtime-backed delivery. Any locally queued
        // mutations generated during the pre-check UI can be safely discarded to avoid replaying
        // overlapping mutation sequences during bootstrap/polling races.
        await studentAttemptRepository.clearPendingMutations(nextAttempt.id);
        await studentAttemptRepository.saveAttempt(nextAttempt);
        syncAttemptState(nextAttempt);
      } catch (error) {
        syncAttemptState(
          mergeAttempt(currentAttempt, {
            recovery: {
              syncState: 'error',
            },
          }),
        );
        throw error instanceof Error ? error : new Error('Failed to save system check.');
      }
    } else {
      await applyPatch(
        {
          integrity: {
            preCheck: result,
          },
        },
        'precheck',
        0,
        {
          completedAt: result.completedAt,
        },
      );
    }

    await saveStudentAuditEvent(resolvedScheduleId, 'PRECHECK_COMPLETED', {
      completedAt: result.completedAt,
      checks: result.checks,
      acknowledgedSafariLimitation: result.acknowledgedSafariLimitation,
    });

    if (result.acknowledgedSafariLimitation) {
      await saveStudentAuditEvent(resolvedScheduleId, 'PRECHECK_WARNING_ACKNOWLEDGED', {
        completedAt: result.completedAt,
      });
    }
  }, [applyPatch, scheduleId, syncAttemptState]);

  const recordNetworkStatus = useCallback(async (
    status: 'offline' | 'online',
    timestamp = new Date().toISOString(),
  ) => {
    await applyPatch(
      {
        integrity:
          status === 'offline'
            ? {
                lastDisconnectAt: timestamp,
              }
            : {
                lastReconnectAt: timestamp,
              },
        recovery: {
          syncState: status === 'offline' ? 'offline' : 'syncing_reconnect',
        },
      },
      'network',
      0,
      {
        status,
        timestamp,
      },
    );
  }, [applyPatch]);

  const recordHeartbeat = useCallback(async (
    type: HeartbeatEventType,
    payload?: Record<string, unknown>,
  ) => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    const heartbeatEvent = buildStudentHeartbeatEvent(
      currentAttempt.id,
      currentAttempt.scheduleId,
      type,
      payload,
    );
    await studentAttemptRepository.saveHeartbeatEvent(heartbeatEvent);

    await applyPatch(
      {
        integrity: {
          lastHeartbeatAt: heartbeatEvent.timestamp,
          lastHeartbeatStatus: type === 'lost' ? 'lost' : 'ok',
        },
      },
      'heartbeat',
      0,
      {
        type,
        ...(payload ?? {}),
      },
    );
  }, [applyPatch]);

  const acknowledgeProctorWarning = useCallback(async (warningId: string) => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt || currentAttempt.lastAcknowledgedWarningId === warningId) {
      return;
    }

    const nextAttempt = mergeAttempt(currentAttempt, {
      lastAcknowledgedWarningId: warningId,
      proctorStatus:
        currentAttempt.proctorStatus === 'warned' ? 'active' : currentAttempt.proctorStatus,
      proctorUpdatedAt: new Date().toISOString(),
      proctorUpdatedBy: 'Candidate',
    });

    await studentAttemptRepository.saveAttempt(nextAttempt);
    syncAttemptState(nextAttempt);
    await saveStudentAuditEvent(
      scheduleId,
      'ALERT_ACKNOWLEDGED',
      {
        warningId,
      },
      currentAttempt.id,
    );
  }, [scheduleId, syncAttemptState]);

  const submitAttempt = useCallback(async () => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    const submittedAttempt = await studentAttemptRepository.submitAttempt(currentAttempt);
    runtimeActions.setPhase('post-exam');
    syncAttemptState(submittedAttempt);
  }, [runtimeActions, syncAttemptState]);

  const setDeviceFingerprintHash = useCallback(async (hash: string) => {
    await applyPatch(
      {
        integrity: {
          deviceFingerprintHash: hash,
        },
      },
      'device_fingerprint',
      0,
      {
        hash,
      },
    );
  }, [applyPatch]);

  const value = useMemo<StudentAttemptContextValue>(() => ({
    state: {
      attempt,
      attemptId: attempt?.id ?? null,
      lastLocalMutationAt: attempt?.recovery.lastLocalMutationAt ?? null,
      lastPersistedAt: attempt?.recovery.lastPersistedAt ?? null,
      pendingMutationCount,
    },
    actions: {
      persistAnswer,
      persistWritingAnswer,
      persistFlag,
      persistViolation,
      persistPosition,
      recordPreCheckResult,
      recordNetworkStatus,
      recordHeartbeat,
      acknowledgeProctorWarning,
      submitAttempt,
      setDeviceFingerprintHash,
      flushPending,
    },
  }), [
    acknowledgeProctorWarning,
    attempt,
    flushPending,
    pendingMutationCount,
    persistAnswer,
    persistFlag,
    persistPosition,
    persistViolation,
    persistWritingAnswer,
    recordHeartbeat,
    recordNetworkStatus,
    recordPreCheckResult,
    submitAttempt,
    setDeviceFingerprintHash,
  ]);

  return (
    <StudentAttemptContext.Provider value={value}>
      {children}
    </StudentAttemptContext.Provider>
  );
}

export function useStudentAttempt() {
  const context = useContext(StudentAttemptContext);
  if (!context) {
    throw new Error('useStudentAttempt must be used within StudentAttemptProvider');
  }
  return context;
}
