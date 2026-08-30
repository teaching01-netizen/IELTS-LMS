import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AssessmentDeliveryBootstrap,
  AssessmentResponseSnapshot,
} from '../contracts/assessmentDelivery';
import type { SatQuestionResponseDraft } from '../domain/satResponses';
import type { SatDeliveryGateway } from '../application/ports/SatDeliveryGateway';
import {
  checkpointSatResponseEntry,
  clearSatResponseCheckpoint,
  loadSatResponseRecoveryState,
  persistSatResponseOutbox,
  type SatResponseInteractionType,
  type SatResponseOutboxEntry,
  type SatResponseTombstone,
} from '../infrastructure/satResponseOutboxStore';

export interface SatResponsePersistenceOptions {
  scheduleId: string;
  attemptId: string;
  gateway: SatDeliveryGateway;
  onSavedRevision: (questionId: string, revision: number) => void;
}

export type SatResponseFailureKind = 'offline' | 'retryable' | 'terminal' | 'superseded';

export interface SatResponseSaveContext {
  moduleAttemptId: string;
  stageKey: string | null;
  runtimeRevision: number | null;
  remainingSeconds: number;
  interactionType: SatResponseInteractionType;
}

export interface SatResponsePersistence {
  pendingCount: number;
  pendingDrafts: Readonly<Record<string, SatQuestionResponseDraft>>;
  failure: string | null;
  failureKind: SatResponseFailureKind | null;
  tombstoneCount: number;
  hydrateRevisions: (responses: readonly AssessmentResponseSnapshot[]) => void;
  hydrateBootstrap: (payload: AssessmentDeliveryBootstrap) => void;
  save: (response: SatQuestionResponseDraft, context?: SatResponseSaveContext) => void;
  flush: () => Promise<void>;
  retryFailed: () => Promise<void>;
}

const TYPING_DEBOUNCE_MS = 350;
const URGENT_REMAINING_SECONDS = 20;
const MAX_TRANSIENT_ATTEMPTS = 4;
const MAX_TRANSIENT_RETRY_WINDOW_MS = 10_000;
const TERMINAL_STAGE_REASONS = new Set([
  'DEADLINE_EXPIRED',
  'MODULE_NOT_ACTIVE',
  'MODULE_MISMATCH',
  'TIMEOUT_RECOVERY_CLOSED',
]);

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Response save failed.';
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' ? status : null;
}

function errorReason(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as {
    backendCode?: unknown;
    backendDetails?: Record<string, unknown> | undefined;
  };
  const detailReason = candidate.backendDetails?.['reason'];
  if (typeof detailReason === 'string') return detailReason;
  return candidate.backendCode === 'ACTIVE_SESSION_SUPERSEDED'
    ? 'ACTIVE_SESSION_SUPERSEDED'
    : null;
}

function isTransientFailure(error: unknown): boolean {
  const status = errorStatus(error);
  return status === null || status === 429 || status >= 500;
}

function payloadHash(entry: SatResponseOutboxEntry): string {
  const input = JSON.stringify({ questionId: entry.draft.questionId, draft: entry.draft });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(250 * (2 ** Math.max(0, attempt - 1)), 2_500);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function cloneDraft(draft: SatQuestionResponseDraft): SatQuestionResponseDraft {
  return {
    ...draft,
    eliminatedOptionIds: [...draft.eliminatedOptionIds],
    annotations: { ...draft.annotations },
  };
}

function writeId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `sat-write-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function serverMatchesDraft(
  server: AssessmentResponseSnapshot,
  draft: SatQuestionResponseDraft,
): boolean {
  const serverAnswer = server.response === null || server.response === undefined
    ? ''
    : String(server.response);
  const serverEliminated = [...server.eliminatedOptions].sort();
  const localEliminated = [...draft.eliminatedOptionIds].sort();
  return serverAnswer === draft.answer
    && server.markedForReview === draft.markedForReview
    && JSON.stringify(serverEliminated) === JSON.stringify(localEliminated)
    && JSON.stringify(server.annotations ?? {}) === JSON.stringify(draft.annotations ?? {});
}

function entriesToDrafts(
  entries: ReadonlyMap<string, SatResponseOutboxEntry>,
): Record<string, SatQuestionResponseDraft> {
  return Object.fromEntries([...entries].map(([questionId, entry]) => [questionId, cloneDraft(entry.draft)]));
}

function canonicalModuleAttemptId(
  payload: AssessmentDeliveryBootstrap,
  questionId: string,
): string | null {
  const moduleId = payload.sections
    .flatMap((section) => section.modules)
    .find((module) => module.questions.some((question) => question.examQuestionId === questionId))?.id;
  if (!moduleId) return null;
  return payload.attempt.moduleAttempts.find((attempt) => attempt.moduleId === moduleId)?.id ?? null;
}

function entryIsObsolete(
  payload: AssessmentDeliveryBootstrap,
  entry: SatResponseOutboxEntry,
): boolean {
  const moduleAttemptId = entry.moduleAttemptId
    ?? canonicalModuleAttemptId(payload, entry.draft.questionId);
  if (!moduleAttemptId) return true;
  const moduleAttempt = payload.attempt.moduleAttempts.find((attempt) => attempt.id === moduleAttemptId);
  if (!moduleAttempt || !['active', 'review'].includes(moduleAttempt.state)) return true;
  if (
    entry.stageKey
    && (payload.timing.timingModel === 'cohort_stage_v2'
      || payload.timing.timingModel === 'cohort_section_v3')
    && payload.timing.stageKey
    && payload.timing.stageKey !== entry.stageKey
  ) {
    return true;
  }
  return false;
}

export function useSatResponsePersistence({
  scheduleId,
  attemptId,
  gateway,
  onSavedRevision,
}: SatResponsePersistenceOptions): SatResponsePersistence {
  const gatewayRef = useRef(gateway);
  const onSavedRevisionRef = useRef(onSavedRevision);
  const revisionsRef = useRef(new Map<string, number>());
  const serverResponsesRef = useRef(new Map<string, AssessmentResponseSnapshot>());
  const outboxRef = useRef(new Map<string, SatResponseOutboxEntry>());
  const tombstonesRef = useRef<SatResponseTombstone[]>([]);
  const workersRef = useRef(new Map<string, Promise<void>>());
  const networkReadyAtRef = useRef(new Map<string, number>());
  const canonicalRef = useRef<AssessmentDeliveryBootstrap | null>(null);
  const hydratedRef = useRef(false);
  const mountedRef = useRef(true);
  const supersededRef = useRef(false);
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, SatQuestionResponseDraft>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [failureKind, setFailureKind] = useState<SatResponseFailureKind | null>(null);
  const [tombstoneCount, setTombstoneCount] = useState(0);

  useEffect(() => {
    gatewayRef.current = gateway;
    onSavedRevisionRef.current = onSavedRevision;
  }, [gateway, onSavedRevision]);

  const publishPendingDrafts = useCallback(() => {
    if (!mountedRef.current) return;
    setPendingDrafts(entriesToDrafts(outboxRef.current));
  }, []);

  const persistCurrentOutbox = useCallback(async () => {
    await persistSatResponseOutbox(
      scheduleId,
      attemptId,
      [...outboxRef.current.values()],
      tombstonesRef.current,
    );
  }, [attemptId, scheduleId]);

  const acknowledgeWrite = useCallback(async (questionId: string, acknowledgedWriteId: string) => {
    const current = outboxRef.current.get(questionId);
    if (current?.writeId !== acknowledgedWriteId) return;
    outboxRef.current.delete(questionId);
    networkReadyAtRef.current.delete(questionId);
    clearSatResponseCheckpoint(scheduleId, attemptId, questionId);
    publishPendingDrafts();
    try { await persistCurrentOutbox(); } catch (error) {
      if (mountedRef.current) {
        setFailure(failureMessage(error));
        setFailureKind('retryable');
      }
    }
  }, [attemptId, persistCurrentOutbox, publishPendingDrafts, scheduleId]);

  const applyCanonicalPayload = useCallback((payload: AssessmentDeliveryBootstrap) => {
    canonicalRef.current = payload;
    serverResponsesRef.current.clear();
    for (const response of payload.attempt.responses) {
      const current = revisionsRef.current.get(response.examQuestionId) ?? 0;
      if (response.revision >= current) {
        revisionsRef.current.set(response.examQuestionId, response.revision);
      }
      serverResponsesRef.current.set(response.examQuestionId, response);
    }
  }, []);

  const tombstoneWrite = useCallback(async (
    questionId: string,
    entry: SatResponseOutboxEntry,
    reason: string,
  ) => {
    const current = outboxRef.current.get(questionId);
    if (current?.writeId !== entry.writeId) return;
    const now = new Date().toISOString();
    tombstonesRef.current = [...tombstonesRef.current, {
      writeId: entry.writeId,
      questionId,
      moduleAttemptId: entry.moduleAttemptId ?? null,
      stageKey: entry.stageKey ?? null,
      runtimeRevision: entry.runtimeRevision ?? null,
      createdAt: entry.createdAt ?? now,
      rejectedAt: now,
      reason,
      payloadHash: payloadHash(entry),
    }].slice(-200);
    outboxRef.current.delete(questionId);
    networkReadyAtRef.current.delete(questionId);
    clearSatResponseCheckpoint(scheduleId, attemptId, questionId);
    publishPendingDrafts();
    if (mountedRef.current) setTombstoneCount(tombstonesRef.current.length);
    await persistCurrentOutbox();
  }, [attemptId, persistCurrentOutbox, publishPendingDrafts, scheduleId]);

  const startWorker = useCallback((questionId: string): Promise<void> => {
    const existingWorker = workersRef.current.get(questionId);
    if (existingWorker) return existingWorker;

    const worker = (async () => {
      while (mountedRef.current && !supersededRef.current) {
        const entry = outboxRef.current.get(questionId);
        if (!entry) return;

        const readyAt = networkReadyAtRef.current.get(questionId) ?? 0;
        const waitForDebounce = readyAt - Date.now();
        if (waitForDebounce > 0) {
          await delay(Math.min(waitForDebounce, 25));
          continue;
        }

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          setFailure('Offline — changes are kept on this device.');
          setFailureKind('offline');
          return;
        }

        try {
          await persistCurrentOutbox();
        } catch (error) {
          if (mountedRef.current) {
            setFailure(failureMessage(error));
            setFailureKind('retryable');
          }
        }

        let transientAttempt = 0;
        let revisionRecoveryAttempted = false;
        const retryStartedAt = Date.now();
        while (mountedRef.current && !supersededRef.current) {
          if (outboxRef.current.get(questionId)?.writeId !== entry.writeId) break;
          try {
            const revision = revisionsRef.current.get(questionId) ?? 0;
            const saved = await gatewayRef.current.saveResponse(scheduleId, attemptId, questionId, {
              revision,
              response: entry.draft.answer || null,
              markedForReview: entry.draft.markedForReview,
              eliminatedOptions: entry.draft.eliminatedOptionIds,
              annotations: entry.draft.annotations,
              clientWriteId: entry.writeId,
              ...(entry.moduleAttemptId ? { moduleAttemptId: entry.moduleAttemptId } : {}),
              ...(entry.stageKey !== undefined ? { stageKey: entry.stageKey } : {}),
              ...(entry.runtimeRevision !== undefined
                ? { runtimeRevision: entry.runtimeRevision }
                : {}),
            });
            if (!mountedRef.current) return;
            revisionsRef.current.set(questionId, saved.revision);
            serverResponsesRef.current.set(questionId, saved);
            onSavedRevisionRef.current(questionId, saved.revision);
            await acknowledgeWrite(questionId, entry.writeId);
            if (mountedRef.current && outboxRef.current.size === 0) {
              setFailure(null);
              setFailureKind(null);
            }
            break;
          } catch (error) {
            const reason = errorReason(error);
            if (reason === 'ACTIVE_SESSION_SUPERSEDED') {
              supersededRef.current = true;
              setFailure('This attempt is active in a newer student session.');
              setFailureKind('superseded');
              return;
            }

            if (
              reason === 'RESPONSE_REVISION_MISMATCH'
              || TERMINAL_STAGE_REASONS.has(reason ?? '')
              || reason === 'RUNTIME_NOT_LIVE'
              || reason === 'RUNTIME_PAUSED'
              || reason === 'ATTEMPT_PROCTOR_BLOCKED'
            ) {
              try {
                const canonical = await gatewayRef.current.bootstrap(scheduleId, attemptId);
                applyCanonicalPayload(canonical);
                const server = serverResponsesRef.current.get(questionId);
                if (server && serverMatchesDraft(server, entry.draft)) {
                  revisionsRef.current.set(questionId, server.revision);
                  onSavedRevisionRef.current(questionId, server.revision);
                  await acknowledgeWrite(questionId, entry.writeId);
                  break;
                }

                const obsolete = entryIsObsolete(canonical, entry);
                const terminal = reason === 'DEADLINE_EXPIRED'
                  || reason === 'TIMEOUT_RECOVERY_CLOSED'
                  || ((reason === 'MODULE_NOT_ACTIVE' || reason === 'MODULE_MISMATCH') && obsolete)
                  || (reason === 'RUNTIME_NOT_LIVE'
                    && (obsolete || ['completed', 'cancelled'].includes(canonical.scheduleRuntimeStatus)))
                  || (reason === 'ATTEMPT_PROCTOR_BLOCKED' && canonical.proctorStatus === 'terminated');
                if (terminal) {
                  await tombstoneWrite(questionId, entry, reason ?? 'TERMINAL_CONFLICT');
                  if (mountedRef.current) {
                    setFailure(reason === 'DEADLINE_EXPIRED'
                      ? 'A final response reached the server after the timed section ended.'
                      : 'A pending response belonged to a section that is no longer active.');
                    setFailureKind('terminal');
                  }
                  break;
                }

                if (reason === 'RESPONSE_REVISION_MISMATCH' && !revisionRecoveryAttempted && !obsolete) {
                  revisionRecoveryAttempted = true;
                  continue;
                }
                if (reason === 'RUNTIME_PAUSED' || canonical.proctorStatus === 'paused') {
                  setFailure('Saving is paused while the proctor has the exam paused.');
                  setFailureKind('retryable');
                  return;
                }
              } catch (refreshError) {
                if (!isTransientFailure(refreshError)) {
                  setFailure(failureMessage(refreshError));
                  setFailureKind('terminal');
                  return;
                }
              }
            }

            if (!isTransientFailure(error)) {
              setFailure(failureMessage(error));
              setFailureKind('terminal');
              return;
            }
            transientAttempt += 1;
            if (
              transientAttempt >= MAX_TRANSIENT_ATTEMPTS
              || Date.now() - retryStartedAt >= MAX_TRANSIENT_RETRY_WINDOW_MS
            ) {
              setFailure(failureMessage(error));
              setFailureKind('retryable');
              return;
            }
            setFailure('Saving is retrying after a temporary connection problem.');
            setFailureKind('retryable');
            await delay(retryDelayMs(transientAttempt));
          }
        }
      }
    })();

    workersRef.current.set(questionId, worker);
    void worker.finally(() => {
      if (workersRef.current.get(questionId) === worker) workersRef.current.delete(questionId);
    });
    return worker;
  }, [
    acknowledgeWrite,
    applyCanonicalPayload,
    attemptId,
    persistCurrentOutbox,
    scheduleId,
    tombstoneWrite,
  ]);

  const reconcileOutboxWithServer = useCallback(() => {
    if (!hydratedRef.current) return;
    for (const [questionId, entry] of outboxRef.current) {
      const server = serverResponsesRef.current.get(questionId);
      if (server && serverMatchesDraft(server, entry.draft)) {
        revisionsRef.current.set(questionId, server.revision);
        onSavedRevisionRef.current(questionId, server.revision);
        void acknowledgeWrite(questionId, entry.writeId);
        continue;
      }
      networkReadyAtRef.current.set(questionId, 0);
      void startWorker(questionId);
    }
  }, [acknowledgeWrite, startWorker]);

  const hydrateRevisions = useCallback((responses: readonly AssessmentResponseSnapshot[]) => {
    serverResponsesRef.current.clear();
    for (const response of responses) {
      const current = revisionsRef.current.get(response.examQuestionId) ?? 0;
      if (response.revision >= current) revisionsRef.current.set(response.examQuestionId, response.revision);
      serverResponsesRef.current.set(response.examQuestionId, response);
    }
    hydratedRef.current = true;
    reconcileOutboxWithServer();
  }, [reconcileOutboxWithServer]);

  const hydrateBootstrap = useCallback((payload: AssessmentDeliveryBootstrap) => {
    applyCanonicalPayload(payload);
    hydratedRef.current = true;
    reconcileOutboxWithServer();
  }, [applyCanonicalPayload, reconcileOutboxWithServer]);
  const save = useCallback((
    response: SatQuestionResponseDraft,
    context?: SatResponseSaveContext,
  ) => {
    const createdAt = new Date().toISOString();
    const entry: SatResponseOutboxEntry = {
      writeId: writeId(),
      draft: cloneDraft(response),
      createdAt,
      ...(context ? {
        moduleAttemptId: context.moduleAttemptId,
        stageKey: context.stageKey,
        runtimeRevision: context.runtimeRevision,
        interactionType: context.interactionType,
      } : {}),
    };
    outboxRef.current.set(response.questionId, entry);
    checkpointSatResponseEntry(scheduleId, attemptId, entry);
    const urgent = (context?.remainingSeconds ?? Number.POSITIVE_INFINITY) <= URGENT_REMAINING_SECONDS;
    const typing = context?.interactionType === 'typing';
    networkReadyAtRef.current.set(
      response.questionId,
      typing && !urgent ? Date.now() + TYPING_DEBOUNCE_MS : 0,
    );
    publishPendingDrafts();

    void persistCurrentOutbox().catch((error) => {
      if (mountedRef.current) {
        setFailure(failureMessage(error));
        setFailureKind('retryable');
      }
    });
    if (supersededRef.current) {
      setFailure('This attempt is active in a newer student session.');
      setFailureKind('superseded');
      return;
    }
    if (hydratedRef.current) void startWorker(response.questionId);
  }, [attemptId, persistCurrentOutbox, publishPendingDrafts, scheduleId, startWorker]);

  const flush = useCallback(async () => {
    if (!hydratedRef.current && outboxRef.current.size > 0) {
      throw new Error('SAT response recovery is waiting for the server snapshot.');
    }
    if (supersededRef.current) {
      throw new Error('This attempt is active in a newer student session.');
    }
    for (const questionId of outboxRef.current.keys()) {
      networkReadyAtRef.current.set(questionId, 0);
    }
    const workers = [...outboxRef.current.keys()].map((questionId) => startWorker(questionId));
    if (workers.length > 0) await Promise.all(workers);
    if (outboxRef.current.size > 0) {
      throw new Error(failure ?? 'One or more SAT responses have not been saved.');
    }
  }, [failure, startWorker]);

  const retryFailed = useCallback(async () => {
    if (supersededRef.current) {
      throw new Error('This attempt is active in a newer student session.');
    }
    setFailure(null);
    setFailureKind(null);
    await flush();
  }, [flush]);
  useEffect(() => {
    mountedRef.current = true;
    supersededRef.current = false;
    let cancelled = false;
    void loadSatResponseRecoveryState(scheduleId, attemptId)
      .then((state) => {
        if (cancelled) return;
        tombstonesRef.current = state.tombstones;
        setTombstoneCount(state.tombstones.length);
        for (const entry of state.entries) {
          if (!outboxRef.current.has(entry.draft.questionId)) {
            outboxRef.current.set(entry.draft.questionId, entry);
          }
        }
        publishPendingDrafts();
        reconcileOutboxWithServer();
      })
      .catch((error) => {
        if (!cancelled) {
          setFailure(failureMessage(error));
          setFailureKind('retryable');
        }
      });

    const handleOnline = () => {
      if (!mountedRef.current || supersededRef.current) return;
      setFailure(null);
      setFailureKind(null);
      for (const questionId of outboxRef.current.keys()) {
        networkReadyAtRef.current.set(questionId, 0);
        void startWorker(questionId);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener('online', handleOnline);
    };
  }, [attemptId, publishPendingDrafts, reconcileOutboxWithServer, scheduleId, startWorker]);

  return {
    pendingCount: Object.keys(pendingDrafts).length,
    pendingDrafts,
    failure,
    failureKind,
    tombstoneCount,
    hydrateRevisions,
    hydrateBootstrap,
    save,
    flush,
    retryFailed,
  };
}
