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
import { backendPost } from '@services/backendBridge';
import { buildStudentHeartbeatEvent } from '@services/studentIntegrityService';
import {
  hasAttemptCredential,
  ensureClientSessionIdForAttempt,
  mapBackendStudentAttempt,
  refreshAttemptCredentialForAttempt,
  studentAttemptRepository,
} from '@services/studentAttemptRepository';
import { saveStudentAuditEvent } from '@services/studentAuditService';
import { queryClient } from '../../../app/data/queryClient';
import {
  emitStudentObservabilityMetric,
  withStudentObservabilityDimensions,
} from '../../../utils/studentObservability';
import type { ModuleType, Violation } from '../../../types';
import type {
  AttemptSyncState,
  HeartbeatEventType,
  StudentAnswerValue,
  StudentAnswerMutationMeta,
  StudentAttempt,
  StudentAttemptMutation,
  StudentAttemptMutationType,
  StudentPreCheckResult,
} from '../../../types/studentAttempt';
import { useStudentRuntime } from './StudentRuntimeProvider';
import { isVerifiedTerminalStudentState } from './verifiedTerminalState';

interface StudentAttemptState {
  attempt: StudentAttempt | null;
  attemptId: string | null;
  lastLocalMutationAt: string | null;
  lastPersistedAt: string | null;
  pendingMutationCount: number;
}

interface StudentAttemptActions {
  persistAnswer: (
    questionId: string,
    answer: StudentAnswerValue,
    meta?: StudentAnswerMutationMeta,
  ) => void;
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
  submitAttempt: () => Promise<boolean>;
  setDeviceFingerprintHash: (hash: string) => Promise<void>;
  flushPending: () => Promise<boolean>;
  flushAnswerDurabilityNow: () => void;
  flushHeartbeatEvents: () => Promise<void>;
  dismissDroppedMutationsBanner: () => Promise<void>;
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
const ANSWER_DURABLE_WRITE_DEBOUNCE_MS = 100;
const ANSWER_SYNC_CHECKPOINT_KEY_PREFIX = 'ielts_student_answer_checkpoint_v1';

type DurablePersistTriggerSource =
  | 'mutation'
  | 'debounce_timer'
  | 'focusout'
  | 'visibility_hidden'
  | 'pagehide'
  | 'beforeunload'
  | 'freeze'
  | 'window_blur'
  | 'hydrate_checkpoint'
  | 'dom_rescue_commit';

interface AnswerSyncCheckpointRecord {
  attemptId: string;
  savedAt: string;
  mutationVersion: number;
  mutations: StudentAttemptMutation[];
}

function checkpointStorageKey(attemptId: string): string {
  return `${ANSWER_SYNC_CHECKPOINT_KEY_PREFIX}:${attemptId}`;
}

function readCheckpointStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function isCheckpointEligibleMutationType(type: StudentAttemptMutationType): boolean {
  return type === 'answer' || type === 'writing_answer' || type === 'flag';
}

function isCheckpointRecord(candidate: unknown): candidate is AnswerSyncCheckpointRecord {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const parsed = candidate as Partial<AnswerSyncCheckpointRecord>;
  return (
    typeof parsed.attemptId === 'string' &&
    typeof parsed.savedAt === 'string' &&
    typeof parsed.mutationVersion === 'number' &&
    Number.isFinite(parsed.mutationVersion) &&
    Array.isArray(parsed.mutations)
  );
}

function writeAnswerSyncCheckpoint(
  attemptId: string,
  mutationVersion: number,
  mutations: StudentAttemptMutation[],
): boolean {
  const storage = readCheckpointStorage();
  if (!storage) {
    return false;
  }

  try {
    const eligibleMutations = mutations.filter((mutation) =>
      isCheckpointEligibleMutationType(mutation.type),
    );
    const key = checkpointStorageKey(attemptId);
    if (eligibleMutations.length === 0) {
      storage.removeItem(key);
      return true;
    }

    const payload: AnswerSyncCheckpointRecord = {
      attemptId,
      savedAt: new Date().toISOString(),
      mutationVersion,
      mutations: eligibleMutations,
    };
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function readAnswerSyncCheckpoint(attemptId: string): StudentAttemptMutation[] {
  const storage = readCheckpointStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(checkpointStorageKey(attemptId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isCheckpointRecord(parsed) || parsed.attemptId !== attemptId) {
      return [];
    }

    return parsed.mutations.filter((mutation) => isCheckpointEligibleMutationType(mutation.type));
  } catch {
    return [];
  }
}

function pendingMutationOldestAgeMs(mutations: StudentAttemptMutation[]): number | null {
  let oldest = Number.POSITIVE_INFINITY;
  for (const mutation of mutations) {
    const ts = Date.parse(mutation.timestamp);
    if (Number.isFinite(ts) && ts < oldest) {
      oldest = ts;
    }
  }

  if (!Number.isFinite(oldest)) {
    return null;
  }

  return Math.max(0, Date.now() - oldest);
}

function detectClientDeviceClass(): 'phone' | 'tablet' | 'desktop' | 'unknown' {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const ua = navigator.userAgent || '';
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(ua)) {
    return 'tablet';
  }
  if (/iPhone|iPod|Mobile|Android/i.test(ua)) {
    return 'phone';
  }
  if (ua.trim().length === 0) {
    return 'unknown';
  }
  return 'desktop';
}

function detectBrowserEngine(): 'webkit' | 'blink' | 'gecko' | 'unknown' {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const ua = navigator.userAgent || '';
  if (/AppleWebKit/i.test(ua)) {
    return 'webkit';
  }
  if (/Gecko\//i.test(ua) || /Firefox/i.test(ua)) {
    return 'gecko';
  }
  if (/Chrome|Chromium|Edg|OPR/i.test(ua)) {
    return 'blink';
  }
  return 'unknown';
}

function isAnswerMutationType(type: StudentAttemptMutationType): boolean {
  return type === 'answer' || type === 'writing_answer';
}

function isEditableDomTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.getAttribute('contenteditable') === 'true'
  );
}

function getMutationCoalesceKey(mutation: StudentAttemptMutation): string | null {
  switch (mutation.type) {
    case 'answer': {
      const questionId = (mutation.payload as { questionId?: unknown } | undefined)?.questionId;
      if (!(typeof questionId === 'string' && questionId.trim())) {
        return null;
      }

      const slotIndex = (mutation.payload as { slotIndex?: unknown } | undefined)?.slotIndex;
      if (typeof slotIndex === 'number' && Number.isInteger(slotIndex) && slotIndex >= 0) {
        return `answer:${questionId}:slot:${slotIndex}`;
      }

      return `answer:${questionId}`;
    }
    case 'writing_answer': {
      const taskId = (mutation.payload as { taskId?: unknown } | undefined)?.taskId;
      return typeof taskId === 'string' && taskId.trim() ? `writing_answer:${taskId}` : null;
    }
    case 'flag': {
      const questionId = (mutation.payload as { questionId?: unknown } | undefined)?.questionId;
      return typeof questionId === 'string' && questionId.trim() ? `flag:${questionId}` : null;
    }
    case 'position':
    case 'network':
    case 'device_fingerprint':
      return mutation.type;
    case 'violation':
    case 'precheck':
    case 'heartbeat':
    case 'sync':
    default:
      return null;
  }
}

function coalescePendingMutations(
  pending: StudentAttemptMutation[],
  nextMutation: StudentAttemptMutation,
): StudentAttemptMutation[] {
  const coalesceKey = getMutationCoalesceKey(nextMutation);
  if (!coalesceKey) {
    return [...pending, nextMutation];
  }

  const filtered = pending.filter((existing) => getMutationCoalesceKey(existing) !== coalesceKey);
  return [...filtered, nextMutation];
}

function mergeViolationsById(
  localViolations: Violation[],
  remoteViolations: Violation[],
): Violation[] {
  const merged = new Map<string, Violation>();
  for (const violation of localViolations) {
    merged.set(violation.id, violation);
  }
  for (const violation of remoteViolations) {
    merged.set(violation.id, violation);
  }

  return [...merged.values()].sort(
    (left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
  );
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

function shouldPreferLocalAttemptState(
  localAttempt: StudentAttempt,
  incomingAttempt: StudentAttempt,
): boolean {
  const localAcceptedSeq = localAttempt.recovery.serverAcceptedThroughSeq ?? 0;
  const incomingAcceptedSeq = incomingAttempt.recovery.serverAcceptedThroughSeq ?? 0;
  if (localAcceptedSeq > incomingAcceptedSeq) {
    return true;
  }
  if (localAcceptedSeq < incomingAcceptedSeq) {
    return false;
  }

  const localRevision =
    typeof localAttempt.revision === 'number' && Number.isFinite(localAttempt.revision)
      ? localAttempt.revision
      : null;
  const incomingRevision =
    typeof incomingAttempt.revision === 'number' && Number.isFinite(incomingAttempt.revision)
      ? incomingAttempt.revision
      : null;

  if (localRevision !== null || incomingRevision !== null) {
    if (localRevision !== null && incomingRevision === null) {
      return true;
    }
    if (localRevision === null && incomingRevision !== null) {
      return false;
    }
    if (localRevision !== null && incomingRevision !== null) {
      if (localRevision > incomingRevision) {
        return true;
      }
      if (localRevision < incomingRevision) {
        return false;
      }
    }
  }

  const hasLocalMutationSignal =
    Boolean(localAttempt.recovery.lastLocalMutationAt) ||
    localAttempt.recovery.pendingMutationCount > 0;
  if (hasLocalMutationSignal) {
    return true;
  }

  const localFingerprint = JSON.stringify({
    phase: localAttempt.phase,
    currentModule: localAttempt.currentModule,
    currentQuestionId: localAttempt.currentQuestionId,
    answers: localAttempt.answers,
    writingAnswers: localAttempt.writingAnswers,
    flags: localAttempt.flags,
  });
  const incomingFingerprint = JSON.stringify({
    phase: incomingAttempt.phase,
    currentModule: incomingAttempt.currentModule,
    currentQuestionId: incomingAttempt.currentQuestionId,
    answers: incomingAttempt.answers,
    writingAnswers: incomingAttempt.writingAnswers,
    flags: incomingAttempt.flags,
  });
  if (localFingerprint !== incomingFingerprint) {
    return true;
  }

  // When accepted sequence is tied and no authoritative revision breaks the tie,
  // keep local state to avoid regressing visible student answers.
  return false;
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
  const durablePendingWriteTimeoutRef = useRef<number | null>(null);
  const pendingMutationVersionRef = useRef(0);
  const durablePersistedMutationVersionRef = useRef(0);
  const latestAnswerMutationVersionRef = useRef(0);
  const durablePersistChainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const flushPendingRef = useRef<() => Promise<boolean>>(async () => true);
  const flushInFlightRef = useRef<Promise<boolean> | null>(null);
  const lastDurablePersistTriggerRef = useRef<DurablePersistTriggerSource>('mutation');

  const syncAttemptState = useCallback((nextAttempt: StudentAttempt) => {
    attemptRef.current = nextAttempt;
    setAttempt(nextAttempt);
    setRuntimeAttemptSyncState(nextAttempt.recovery.syncState);
  }, [setRuntimeAttemptSyncState]);

  const setStorageDurabilityBlocking = useCallback((active: boolean) => {
    if (active) {
      if (runtimeState.blockingReasonOverride !== 'storage_unavailable') {
        runtimeActions.setBlockingReason('storage_unavailable');
      }
      return;
    }

    if (runtimeState.blockingReasonOverride === 'storage_unavailable') {
      runtimeActions.setBlockingReason(null);
    }
  }, [runtimeActions, runtimeState.blockingReasonOverride]);

  const recordPendingMutationPersistenceError = useCallback((
    error: unknown,
    pendingMutationCountForError: number,
    fallbackAttempt: StudentAttempt,
    source: DurablePersistTriggerSource,
    durablePersistResult: 'failed' | 'checkpoint_failed' = 'failed',
  ) => {
    const erroredAttempt = mergeAttempt(attemptRef.current ?? fallbackAttempt, {
      recovery: {
        syncState: 'error',
        pendingMutationCount: pendingMutationCountForError,
      },
    });
    syncAttemptState(erroredAttempt);
    setStorageDurabilityBlocking(true);
    emitStudentObservabilityMetric(
      'student_pending_persist_failure_total',
      withStudentObservabilityDimensions({
        scheduleId: scheduleId ?? fallbackAttempt.scheduleId,
        attemptId: fallbackAttempt.id,
        endpoint: '/v1/student/sessions/:scheduleId/mutations:pending',
        statusCode: null,
        reason: error instanceof Error ? error.message : 'pending_mirror_persist_failed',
        syncState: 'error',
        lifecycleEventSource: source,
        durablePersistResult,
        browserEngine: detectBrowserEngine(),
        platform:
          typeof navigator !== 'undefined'
            ? (
                (navigator as Navigator & {
                  userAgentData?: {
                    platform?: string;
                  };
                }).userAgentData?.platform ?? navigator.platform
              )
            : 'unknown',
        deviceClass: detectClientDeviceClass(),
        pendingMutationAgeMs: pendingMutationOldestAgeMs(pendingMutationsRef.current),
        pendingMutationCount: pendingMutationCountForError,
      }),
    );
    void saveStudentAuditEvent(
      scheduleId ?? fallbackAttempt.scheduleId,
      'PERSISTENCE_STORAGE_ERROR',
      {
        message: error instanceof Error ? error.message : 'Failed to persist pending mutations',
        pendingMutationCount: pendingMutationCountForError,
        lifecycleEventSource: source,
        durablePersistResult,
      },
      fallbackAttempt.id,
    );
  }, [scheduleId, setStorageDurabilityBlocking, syncAttemptState]);

  const updatePendingMutationsRamState = useCallback((
    nextMutations: StudentAttemptMutation[],
    options?: {
      includesAnswerMutation?: boolean;
    },
  ) => {
    pendingMutationsRef.current = nextMutations;
    setPendingMutationCount(nextMutations.length);
    pendingMutationVersionRef.current += 1;

    if (options?.includesAnswerMutation) {
      latestAnswerMutationVersionRef.current = pendingMutationVersionRef.current;
    }
  }, []);

  const clearDurablePendingWriteTimeout = useCallback(() => {
    if (durablePendingWriteTimeoutRef.current) {
      window.clearTimeout(durablePendingWriteTimeoutRef.current);
      durablePendingWriteTimeoutRef.current = null;
    }
  }, []);

  const persistPendingMutationsMirrorNow = useCallback((
    source: DurablePersistTriggerSource = 'mutation',
  ): Promise<boolean> => {
    lastDurablePersistTriggerRef.current = source;
    const persistTask = durablePersistChainRef.current.then(async () => {
      const attempt = attemptRef.current;
      if (!attempt) {
        return true;
      }

      const mutationVersion = pendingMutationVersionRef.current;
      if (mutationVersion <= durablePersistedMutationVersionRef.current) {
        return true;
      }

      try {
        const pendingMutations = pendingMutationsRef.current;
        if (pendingMutations.length > 0) {
          await studentAttemptRepository.savePendingMutations(attempt.id, pendingMutations);
        } else {
          await studentAttemptRepository.clearPendingMutations(attempt.id);
        }
      } catch (error) {
        recordPendingMutationPersistenceError(
          error,
          pendingMutationsRef.current.length,
          attempt,
          lastDurablePersistTriggerRef.current,
        );
        return false;
      }

      durablePersistedMutationVersionRef.current = Math.max(
        durablePersistedMutationVersionRef.current,
        mutationVersion,
      );
      setStorageDurabilityBlocking(false);
      return true;
    });

    durablePersistChainRef.current = persistTask;
    return persistTask;
  }, [recordPendingMutationPersistenceError, setStorageDurabilityBlocking]);

  const scheduleDebouncedPendingMutationMirrorPersist = useCallback(() => {
    clearDurablePendingWriteTimeout();
    durablePendingWriteTimeoutRef.current = window.setTimeout(() => {
      void persistPendingMutationsMirrorNow('debounce_timer');
    }, ANSWER_DURABLE_WRITE_DEBOUNCE_MS);
  }, [clearDurablePendingWriteTimeout, persistPendingMutationsMirrorNow]);

  const flushAnswerDurableMirrorNow = useCallback((
    source: DurablePersistTriggerSource,
  ) => {
    if (durablePersistedMutationVersionRef.current >= latestAnswerMutationVersionRef.current) {
      return;
    }

    clearDurablePendingWriteTimeout();
    void persistPendingMutationsMirrorNow(source);
  }, [clearDurablePendingWriteTimeout, persistPendingMutationsMirrorNow]);

  const setPendingMutations = useCallback((
    nextMutations: StudentAttemptMutation[],
    options?: {
      durableWriteMode?: 'immediate' | 'debounced';
      includesAnswerMutation?: boolean;
      awaitPersistence?: boolean;
      source?: DurablePersistTriggerSource;
    },
  ): Promise<boolean> | void => {
    const ramStateOptions =
      options?.includesAnswerMutation === undefined
        ? undefined
        : { includesAnswerMutation: options.includesAnswerMutation };
    updatePendingMutationsRamState(nextMutations, ramStateOptions);

    const activeAttempt = attemptRef.current;
    if (activeAttempt && options?.includesAnswerMutation) {
      const checkpointOk = writeAnswerSyncCheckpoint(
        activeAttempt.id,
        pendingMutationVersionRef.current,
        nextMutations,
      );
      if (!checkpointOk) {
        recordPendingMutationPersistenceError(
          new Error('failed_to_write_sync_checkpoint'),
          nextMutations.length,
          activeAttempt,
          options?.source ?? 'mutation',
          'checkpoint_failed',
        );
      }
    }

    if (options?.durableWriteMode === 'debounced') {
      scheduleDebouncedPendingMutationMirrorPersist();
      if (options?.awaitPersistence) {
        clearDurablePendingWriteTimeout();
        return persistPendingMutationsMirrorNow(options?.source ?? 'mutation');
      }
      return;
    }

    clearDurablePendingWriteTimeout();
    const persistence = persistPendingMutationsMirrorNow(options?.source ?? 'mutation');
    if (options?.awaitPersistence) {
      return persistence;
    }
    void persistence;
  }, [
    clearDurablePendingWriteTimeout,
    recordPendingMutationPersistenceError,
    persistPendingMutationsMirrorNow,
    scheduleDebouncedPendingMutationMirrorPersist,
    updatePendingMutationsRamState,
  ]);

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
    const payloadWithModule =
      (mutationType === 'answer' || mutationType === 'flag' || mutationType === 'writing_answer') &&
      payload['module'] === undefined
        ? { ...payload, module: currentAttempt.currentModule }
        : payload;
    const mutation: StudentAttemptMutation = {
      id: generateId('mutation'),
      attemptId: currentAttempt.id,
      scheduleId: currentAttempt.scheduleId,
      timestamp,
      type: mutationType,
      payload: payloadWithModule,
    };
    const nextPendingMutations = coalescePendingMutations(pendingMutationsRef.current, mutation);
    const mutationIsAnswer = isAnswerMutationType(mutationType);
    const answerInteractionType = mutationType === 'answer' ? payloadWithModule['interactionType'] : null;
    const shouldDebounceAnswerDurability =
      mutationType === 'writing_answer' ||
      (mutationType === 'answer' && answerInteractionType !== 'discrete');
    setPendingMutations(nextPendingMutations, {
      durableWriteMode: mutationIsAnswer && shouldDebounceAnswerDurability ? 'debounced' : 'immediate',
      includesAnswerMutation: mutationIsAnswer,
      source: 'mutation',
    });

    const syncState: AttemptSyncState =
      patch.recovery?.syncState ?? (navigator.onLine ? 'saving' : 'offline');
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

      if (durablePersistedMutationVersionRef.current < pendingMutationVersionRef.current) {
        const persistedMirror = await persistPendingMutationsMirrorNow();
        if (!persistedMirror) {
          const erroredAttempt = mergeAttempt(currentAttempt, {
            recovery: {
              syncState: 'error',
              pendingMutationCount: pendingMutationsRef.current.length,
            },
          });
          syncAttemptState(erroredAttempt);
          return false;
        }
      }

      if (!hasAttemptCredential(currentAttempt.scheduleId, currentAttempt.id)) {
        const refreshed = await refreshAttemptCredentialForAttempt(currentAttempt).catch(() => false);
        if (!refreshed) {
          const erroredAttempt = mergeAttempt(currentAttempt, {
            recovery: {
              syncState: 'error',
              pendingMutationCount: pendingMutationsRef.current.length,
            },
          });
          syncAttemptState(erroredAttempt);
          return false;
        }
      }

      while (pendingMutationsRef.current.length > 0) {
        const attemptBeforeFlush = attemptRef.current ?? currentAttempt;
        const mutationsBeingFlushed = pendingMutationsRef.current;
        const flushedMutationIds = new Set(mutationsBeingFlushed.map((mutation) => mutation.id));
        const savingAttempt = mergeAttempt(attemptBeforeFlush, {
          recovery: {
            syncState: 'saving',
            pendingMutationCount: mutationsBeingFlushed.length,
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

          const remainingMutations = pendingMutationsRef.current.filter(
            (mutation) => !flushedMutationIds.has(mutation.id),
          );

          if (remainingMutations.length > 0) {
            const persistedMirror = await (
              setPendingMutations(remainingMutations, {
                durableWriteMode: 'immediate',
                includesAnswerMutation: remainingMutations.some(
                  (mutation) => mutation.type === 'answer' || mutation.type === 'writing_answer',
                ),
                awaitPersistence: true,
                source: 'mutation',
              }) ?? Promise.resolve(true)
            );
            if (!persistedMirror) {
              return false;
            }
            const stillSavingAttempt = mergeAttempt(attemptRef.current ?? persistedAttempt, {
              recovery: {
                lastPersistedAt: persistedAt,
                pendingMutationCount: remainingMutations.length,
                syncState: navigator.onLine ? 'saving' : 'offline',
              },
            });
            syncAttemptState(stillSavingAttempt);

            if (!navigator.onLine) {
              return false;
            }

            continue;
          }

          clearDurablePendingWriteTimeout();
          await studentAttemptRepository.clearPendingMutations(persistedAttempt.id);
          const postClearMutations = pendingMutationsRef.current.filter(
            (mutation) => !flushedMutationIds.has(mutation.id),
          );
          if (postClearMutations.length > 0) {
            const persistedMirror = await (
              setPendingMutations(postClearMutations, {
                durableWriteMode: 'immediate',
                includesAnswerMutation: postClearMutations.some(
                  (mutation) => mutation.type === 'answer' || mutation.type === 'writing_answer',
                ),
                awaitPersistence: true,
                source: 'mutation',
              }) ?? Promise.resolve(true)
            );
            if (!persistedMirror) {
              return false;
            }
            const stillSavingAttempt = mergeAttempt(attemptRef.current ?? persistedAttempt, {
              recovery: {
                lastPersistedAt: persistedAt,
                pendingMutationCount: postClearMutations.length,
                syncState: navigator.onLine ? 'saving' : 'offline',
              },
            });
            syncAttemptState(stillSavingAttempt);

            if (!navigator.onLine) {
              return false;
            }

            continue;
          }
          updatePendingMutationsRamState([]);
          void writeAnswerSyncCheckpoint(
            persistedAttempt.id,
            pendingMutationVersionRef.current,
            [],
          );
          durablePersistedMutationVersionRef.current = pendingMutationVersionRef.current;
          latestAnswerMutationVersionRef.current = pendingMutationVersionRef.current;
          setStorageDurabilityBlocking(false);
          const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId(
            persistedAttempt.scheduleId,
          );
          const refreshed =
            cachedAttempts.find((candidate) => candidate.id === persistedAttempt.id) ?? persistedAttempt;
          syncAttemptState(refreshed);
          return true;
        } catch {
          const erroredAttempt = mergeAttempt(attemptRef.current ?? savingAttempt, {
            recovery: {
              syncState: navigator.onLine ? 'error' : 'offline',
              pendingMutationCount: pendingMutationsRef.current.length,
            },
          });
          syncAttemptState(erroredAttempt);
          return false;
        }
      }

      setRuntimeAttemptSyncState((attemptRef.current ?? currentAttempt).recovery.syncState);
      return true;
    })();

    flushInFlightRef.current = promise;
    try {
      return await promise;
    } finally {
      if (flushInFlightRef.current === promise) {
        flushInFlightRef.current = null;
      }
    }
  }, [
    clearDurablePendingWriteTimeout,
    persistPendingMutationsMirrorNow,
    setPendingMutations,
    setRuntimeAttemptSyncState,
    syncAttemptState,
    updatePendingMutationsRamState,
  ]);

  useEffect(() => {
    flushPendingRef.current = flushPending;
  }, [flushPending]);

  useEffect(() => {
    const handleFocusOut = (event: FocusEvent) => {
      if (!isEditableDomTarget(event.target)) {
        return;
      }
      flushAnswerDurableMirrorNow('focusout');
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') {
        return;
      }
      flushAnswerDurableMirrorNow('visibility_hidden');
    };

    const handlePageHide = () => {
      flushAnswerDurableMirrorNow('pagehide');
    };

    const handleBeforeUnload = () => {
      flushAnswerDurableMirrorNow('beforeunload');
    };

    const handleFreeze = () => {
      flushAnswerDurableMirrorNow('freeze');
    };

    const handleWindowBlur = () => {
      flushAnswerDurableMirrorNow('window_blur');
    };

    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('freeze', handleFreeze as EventListener);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('freeze', handleFreeze as EventListener);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [flushAnswerDurableMirrorNow]);

  useEffect(() => {
    let cancelled = false;

    if (!attemptSnapshot) {
      attemptRef.current = null;
      observedRef.current = createObservedSnapshot(null);
      setRuntimeAttemptSyncState('idle');
      setAttempt(null);
      setPendingMutationCount(0);
      pendingMutationsRef.current = [];
      pendingMutationVersionRef.current = 0;
      durablePersistedMutationVersionRef.current = 0;
      latestAnswerMutationVersionRef.current = 0;
      durablePersistChainRef.current = Promise.resolve(true);
      clearDurablePendingWriteTimeout();
      return;
    }

    const currentAttempt = attemptRef.current;
    const sameAttempt = currentAttempt?.id === attemptSnapshot.id;
    const shouldKeepLocalAttempt =
      sameAttempt &&
      !!currentAttempt &&
      (
        pendingMutationsRef.current.length > 0 ||
        shouldPreferLocalAttemptState(currentAttempt, attemptSnapshot)
      );

    if (shouldKeepLocalAttempt && currentAttempt) {
      const mergedViolations = mergeViolationsById(
        currentAttempt.violations ?? [],
        attemptSnapshot.violations ?? [],
      );

      const mergedAttempt = mergeAttempt(currentAttempt, {
        phase:
          isVerifiedTerminalStudentState({
            attempt: attemptSnapshot,
            runtimeSnapshot: runtimeState.runtimeSnapshot,
          }) !== 'not_terminal'
            ? 'post-exam'
            : currentAttempt.phase,
        proctorStatus: attemptSnapshot.proctorStatus,
        proctorNote: attemptSnapshot.proctorNote,
        proctorUpdatedAt: attemptSnapshot.proctorUpdatedAt,
        proctorUpdatedBy: attemptSnapshot.proctorUpdatedBy,
        lastWarningId: attemptSnapshot.lastWarningId ?? currentAttempt.lastWarningId,
        lastAcknowledgedWarningId:
          currentAttempt.lastAcknowledgedWarningId ?? attemptSnapshot.lastAcknowledgedWarningId,
        violations: mergedViolations,
      });

      syncAttemptState(mergedAttempt);
      observedRef.current = createObservedSnapshot(mergedAttempt);
      return;
    }

    attemptRef.current = attemptSnapshot;
    setAttempt(attemptSnapshot);
    observedRef.current = createObservedSnapshot(attemptSnapshot);
    setRuntimeAttemptSyncState(attemptSnapshot.recovery.syncState);

    void (async () => {
      let pendingMutations = await studentAttemptRepository.getPendingMutations(
        attemptSnapshot.id,
      );
      if (cancelled) {
        return;
      }

      // Local edits that happen during mount hydration are authoritative for this tab.
      // Do not replace them with a stale durable snapshot that resolved later.
      if (pendingMutationsRef.current.length > 0) {
        return;
      }

      let recoveredFromCheckpoint = false;
      if (pendingMutations.length === 0) {
        const checkpointMutations = readAnswerSyncCheckpoint(attemptSnapshot.id);
        if (checkpointMutations.length > 0) {
          pendingMutations = checkpointMutations;
          recoveredFromCheckpoint = true;
          emitStudentObservabilityMetric(
            'student_pending_checkpoint_recovered_total',
            withStudentObservabilityDimensions({
              scheduleId: attemptSnapshot.scheduleId,
              attemptId: attemptSnapshot.id,
              endpoint: '/v1/student/sessions/:scheduleId/mutations:pending',
              statusCode: null,
              reason: 'sync_checkpoint_recovery',
              syncState: attemptSnapshot.recovery.syncState,
              lifecycleEventSource: 'hydrate_checkpoint',
              durablePersistResult: 'recovered',
              browserEngine: detectBrowserEngine(),
              platform:
                typeof navigator !== 'undefined'
                  ? (
                      (navigator as Navigator & {
                        userAgentData?: {
                          platform?: string;
                        };
                      }).userAgentData?.platform ?? navigator.platform
                    )
                  : 'unknown',
              deviceClass: detectClientDeviceClass(),
              pendingMutationAgeMs: pendingMutationOldestAgeMs(checkpointMutations),
              pendingMutationCount: checkpointMutations.length,
            }),
          );
        }
      }

      updatePendingMutationsRamState(pendingMutations, {
        includesAnswerMutation: pendingMutations.some(
          (mutation) => mutation.type === 'answer' || mutation.type === 'writing_answer',
        ),
      });
      if (recoveredFromCheckpoint && pendingMutations.length > 0) {
        durablePersistedMutationVersionRef.current = Math.max(
          0,
          pendingMutationVersionRef.current - 1,
        );
        void persistPendingMutationsMirrorNow('hydrate_checkpoint');
      } else {
        durablePersistedMutationVersionRef.current = pendingMutationVersionRef.current;
      }

      if (pendingMutations.length > 0) {
        const replayAnswers: Record<string, StudentAnswerValue> = {};
        const replayWritingAnswers: Record<string, string> = {};
        const replayFlags: Record<string, boolean> = {};

        for (const mutation of pendingMutations) {
          if (mutation.type === 'answer') {
            const questionId = mutation.payload['questionId'];
            if (typeof questionId !== 'string' || questionId.trim() === '') {
              continue;
            }
            replayAnswers[questionId] = mutation.payload['value'] as StudentAnswerValue;
            continue;
          }

          if (mutation.type === 'writing_answer') {
            const taskId = mutation.payload['taskId'];
            if (typeof taskId !== 'string' || taskId.trim() === '') {
              continue;
            }
            const value = mutation.payload['value'];
            if (typeof value !== 'string') {
              continue;
            }
            replayWritingAnswers[taskId] = value;
            continue;
          }

          if (mutation.type === 'flag') {
            const questionId = mutation.payload['questionId'];
            if (typeof questionId !== 'string' || questionId.trim() === '') {
              continue;
            }
            const value = mutation.payload['value'];
            if (typeof value !== 'boolean') {
              continue;
            }
            replayFlags[questionId] = value;
          }
        }

        for (const [questionId, value] of Object.entries(replayAnswers)) {
          runtimeActions.setAnswer(questionId, value as any);
        }

        for (const [taskId, value] of Object.entries(replayWritingAnswers)) {
          runtimeActions.setWritingAnswer(taskId, value);
        }

        for (const [questionId, flagged] of Object.entries(replayFlags)) {
          if (runtimeState.flags[questionId] === flagged) {
            continue;
          }
          runtimeActions.toggleFlag(questionId);
        }

        const currentAttempt = attemptRef.current ?? attemptSnapshot;
        const replayedAttempt = mergeAttempt(currentAttempt, {
          answers: replayAnswers,
          writingAnswers: replayWritingAnswers,
          flags: replayFlags,
          recovery: {
            pendingMutationCount: pendingMutations.length,
            syncState: navigator.onLine ? currentAttempt.recovery.syncState : 'offline',
          },
        });

        syncAttemptState(replayedAttempt);
        observedRef.current = createObservedSnapshot(replayedAttempt);
      }

      if (pendingMutations.length > 0 && navigator.onLine) {
        await flushPending();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    attemptSnapshot,
    clearDurablePendingWriteTimeout,
    flushPending,
    persistPendingMutationsMirrorNow,
    runtimeState.runtimeSnapshot,
    setRuntimeAttemptSyncState,
    updatePendingMutationsRamState,
  ]);

  useEffect(() => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    const verifiedTerminalState = isVerifiedTerminalStudentState({
      attempt: currentAttempt,
      runtimeSnapshot: runtimeState.runtimeSnapshot,
    });
    const effectivePhase =
      runtimeState.runtimeBacked &&
      runtimeState.phase === 'post-exam' &&
      verifiedTerminalState === 'not_terminal'
        ? 'exam'
        : runtimeState.phase;

    const nextObserved: ObservedSnapshot = {
      answers: JSON.stringify(runtimeState.answers),
      writingAnswers: JSON.stringify(runtimeState.writingAnswers),
      flags: JSON.stringify(runtimeState.flags),
      violations: JSON.stringify(runtimeState.violations),
      position: JSON.stringify({
        phase: effectivePhase,
        currentModule: runtimeState.currentModule,
        currentQuestionId: runtimeState.currentQuestionId,
      }),
    };

    const objectivePatch: AttemptPatch = {};

    if (
      nextObserved.violations !== observedRef.current.violations &&
      JSON.stringify(currentAttempt.violations) !== nextObserved.violations
    ) {
      objectivePatch.violations = runtimeState.violations;
    }

    if (nextObserved.position !== observedRef.current.position) {
      objectivePatch.phase = effectivePhase;
      objectivePatch.currentModule = runtimeState.currentModule;
      objectivePatch.currentQuestionId = runtimeState.currentQuestionId;
    }

    if (objectivePatch.violations) {
      void applyPatch(objectivePatch, 'violation', 400, {
        changedAreas: ['violation'],
        violations: runtimeState.violations,
      });
    }

    if (nextObserved.position !== observedRef.current.position) {
      void applyPatch(objectivePatch, 'position', 400, {
        changedAreas: ['position'],
        phase: effectivePhase,
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
    runtimeState.runtimeBacked,
    runtimeState.runtimeSnapshot,
  ]);

  useEffect(() => {
    return () => {
      if (objectiveFlushTimeoutRef.current) {
        window.clearTimeout(objectiveFlushTimeoutRef.current);
      }
      if (writingFlushTimeoutRef.current) {
        window.clearTimeout(writingFlushTimeoutRef.current);
      }
      if (durablePendingWriteTimeoutRef.current) {
        window.clearTimeout(durablePendingWriteTimeoutRef.current);
      }
    };
  }, []);

  const persistAnswer = useCallback((
    questionId: string,
    answer: StudentAnswerValue,
    meta?: StudentAnswerMutationMeta,
  ) => {
    const payload: Record<string, unknown> = { questionId, value: answer };
    if (meta?.interactionType === 'typing' || meta?.interactionType === 'discrete') {
      payload['interactionType'] = meta.interactionType;
    }
    if (typeof meta?.slotIndex === 'number' && Number.isInteger(meta.slotIndex) && meta.slotIndex >= 0) {
      payload['slotIndex'] = meta.slotIndex;
    }
    if (typeof meta?.slotId === 'string' && meta.slotId.trim()) {
      payload['slotId'] = meta.slotId;
    }
    if (typeof meta?.slotCount === 'number' && Number.isInteger(meta.slotCount) && meta.slotCount > 0) {
      payload['slotCount'] = meta.slotCount;
    }

    void applyPatch(
      {
        answers: {
          [questionId]: answer,
        },
      },
      'answer',
      400,
      payload,
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
        violations: nextViolations,
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

    try {
      const persisted = await backendPost<any>(
        `/v1/student/sessions/${resolvedScheduleId}/precheck`,
        {
          studentKey: currentAttempt.studentKey,
          candidateId: currentAttempt.candidateId,
          candidateName: currentAttempt.candidateName,
          candidateEmail: currentAttempt.candidateEmail,
          clientSessionId: ensureClientSessionIdForAttempt(currentAttempt),
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
  }, []);

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

  const submitAttempt = useCallback(async (): Promise<boolean> => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return false;
    }

    const flushed = await flushPending();
    if (!flushed) {
      return false;
    }

    const latestAttempt = attemptRef.current ?? currentAttempt;
    const submittedAttempt = await studentAttemptRepository.submitAttempt(latestAttempt);
    runtimeActions.setPhase('post-exam');
    syncAttemptState(submittedAttempt);
    void queryClient.invalidateQueries();
    return true;
  }, [flushPending, runtimeActions, syncAttemptState]);

  const flushAnswerDurabilityNow = useCallback(() => {
    flushAnswerDurableMirrorNow('dom_rescue_commit');
  }, [flushAnswerDurableMirrorNow]);

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

  const flushHeartbeatEvents = useCallback(async () => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    await studentAttemptRepository.flushHeartbeatEvents(currentAttempt.id);
  }, []);

  const dismissDroppedMutationsBanner = useCallback(async () => {
    const currentAttempt = attemptRef.current;
    if (!currentAttempt) {
      return;
    }

    if (!currentAttempt.recovery.lastDroppedMutations) {
      return;
    }

    const nextAttempt = mergeAttempt(currentAttempt, {
      recovery: {
        lastDroppedMutations: null,
      },
    });
    syncAttemptState(nextAttempt);
    await studentAttemptRepository.saveAttempt(nextAttempt).catch(() => {});
  }, [syncAttemptState]);

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
      flushAnswerDurabilityNow,
      flushHeartbeatEvents,
      dismissDroppedMutationsBanner,
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
    flushHeartbeatEvents,
    flushAnswerDurabilityNow,
    dismissDroppedMutationsBanner,
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

export function useOptionalStudentAttempt(): StudentAttemptContextValue | null {
  return useContext(StudentAttemptContext);
}
