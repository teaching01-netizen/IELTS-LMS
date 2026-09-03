import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DurableResponseEngine,
  type TransportClient,
} from '@shared/durability/DurableResponseEngine';
import {
  createResponseDurabilityV2Transport,
  takeOverResponseDurabilityLease,
} from '@student/api/responseDurabilityTransport';
import {
  getVisibleResponse,
  type ResponsePayload,
  type SubmitAttemptV2Response,
} from '@shared/durability/types';
import type {
  AssessmentDeliveryBootstrap,
  AssessmentResponseSnapshot,
} from '../contracts/assessmentDelivery';
import { normalizeSatAnnotations, type SatQuestionResponseDraft } from '../domain/satResponses';
import type { SatDeliveryGateway } from '../application/ports/SatDeliveryGateway';
import type { StudentAttempt } from '../../../types/studentAttempt';
import {
  ensureClientSessionIdForAttempt,
  restoreClientSessionIdForAttempt,
  rotateClientSessionIdForAttempt,
} from '@student/api/studentAttemptGateway';
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
  leaseEpoch?: number | null | undefined;
  controlEpoch?: number | null | undefined;
  /** Used to refresh an expired attempt credential, including SAT's provider path. */
  credentialAttempt?: StudentAttempt | null | undefined;
  /** Rollout gate. v1 remains the default until a deployment explicitly opts in. */
  useV2DurabilityEngine?: boolean | undefined;
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
  visibleDrafts: Readonly<Record<string, SatQuestionResponseDraft>>;
  failure: string | null;
  failureKind: SatResponseFailureKind | null;
  tombstoneCount: number;
  hydrateRevisions: (responses: readonly AssessmentResponseSnapshot[]) => void;
  hydrateBootstrap: (payload: AssessmentDeliveryBootstrap) => void;
  save: (response: SatQuestionResponseDraft, context?: SatResponseSaveContext) => void;
  flush: () => Promise<void>;
  submit: () => Promise<SubmitAttemptV2Response>;
  retryFailed: () => Promise<void>;
  takeOverLease: (reason?: string) => Promise<void>;
  isTakingOver: boolean;
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
  'LEASE_FENCED',
  'ATTEMPT_NOT_WRITABLE',
  'QUESTION_NOT_IN_ATTEMPT',
  'INVALID_RESPONSE',
  'VERSION_COLLISION',
  'IDEMPOTENCY_KEY_REUSED',
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
  return candidate.backendCode === 'ACTIVE_SESSION_SUPERSEDED' ? 'ACTIVE_SESSION_SUPERSEDED' : null;
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
  const base = Math.min(250 * 2 ** Math.max(0, attempt - 1), 2_500);
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
  return (
    globalThis.crypto?.randomUUID?.() ??
    `sat-write-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function satDraftToDurablePayload(draft: SatQuestionResponseDraft): ResponsePayload {
  return {
    answer: draft.answer || null,
    markedForReview: draft.markedForReview,
    eliminatedOptions: [...draft.eliminatedOptionIds],
    annotations: [{ id: 'sat-annotations', ...draft.annotations }],
  };
}

function durablePayloadToSatDraft(
  questionId: string,
  payload: ResponsePayload
): SatQuestionResponseDraft {
  const annotation = payload.annotations.find(
    (value) => typeof value === 'object' && value !== null && 'note' in value
  );
  const annotationRecord =
    annotation && typeof annotation === 'object' ? (annotation as Record<string, unknown>) : {};
  return {
    questionId,
    answer: typeof payload.answer === 'string' ? payload.answer : '',
    markedForReview: payload.markedForReview,
    eliminatedOptionIds: [...payload.eliminatedOptions],
    annotations: normalizeSatAnnotations(annotationRecord),
  };
}

function serverMatchesDraft(
  server: AssessmentResponseSnapshot,
  draft: SatQuestionResponseDraft
): boolean {
  const serverAnswer =
    server.response === null || server.response === undefined ? '' : String(server.response);
  const serverEliminated = [...server.eliminatedOptions].sort();
  const localEliminated = [...draft.eliminatedOptionIds].sort();
  return (
    serverAnswer === draft.answer &&
    server.markedForReview === draft.markedForReview &&
    JSON.stringify(serverEliminated) === JSON.stringify(localEliminated) &&
    JSON.stringify(server.annotations ?? {}) === JSON.stringify(draft.annotations ?? {})
  );
}

function entriesToDrafts(
  entries: ReadonlyMap<string, SatResponseOutboxEntry>
): Record<string, SatQuestionResponseDraft> {
  return Object.fromEntries(
    [...entries].map(([questionId, entry]) => [questionId, cloneDraft(entry.draft)])
  );
}

function canonicalModuleAttemptId(
  payload: AssessmentDeliveryBootstrap,
  questionId: string
): string | null {
  const moduleId = payload.sections
    .flatMap((section) => section.modules)
    .find((module) =>
      module.questions.some((question) => question.examQuestionId === questionId)
    )?.id;
  if (!moduleId) return null;
  return (
    payload.attempt.moduleAttempts.find((attempt) => attempt.moduleId === moduleId)?.id ?? null
  );
}

function entryIsObsolete(
  payload: AssessmentDeliveryBootstrap,
  entry: SatResponseOutboxEntry
): boolean {
  const moduleAttemptId =
    entry.moduleAttemptId ?? canonicalModuleAttemptId(payload, entry.draft.questionId);
  if (!moduleAttemptId) return true;
  const moduleAttempt = payload.attempt.moduleAttempts.find(
    (attempt) => attempt.id === moduleAttemptId
  );
  if (!moduleAttempt || !['active', 'review'].includes(moduleAttempt.state)) return true;
  if (
    entry.stageKey &&
    (payload.timing.timingModel === 'cohort_stage_v2' ||
      payload.timing.timingModel === 'cohort_section_v3') &&
    payload.timing.stageKey &&
    payload.timing.stageKey !== entry.stageKey
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
  leaseEpoch = 1,
  controlEpoch = 1,
  credentialAttempt = null,
  useV2DurabilityEngine = String(import.meta.env['VITE_USE_V2_DURABILITY_ENGINE'] ?? 'false') ===
    'true',
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
  const identityGenerationRef = useRef(0);
  const v2EngineRef = useRef<DurableResponseEngine | null>(null);
  const credentialAttemptRef = useRef<StudentAttempt | null>(credentialAttempt);
  credentialAttemptRef.current = credentialAttempt;
  const v2TransportRef = useRef<TransportClient | null>(null);
  const v2ReadyRef = useRef<Promise<void> | null>(null);
  const v2PendingAcceptancesRef = useRef(new Set<Promise<void>>());
  const v2RevisionRef = useRef(new Map<string, number>());
  const [v2ModePendingDrafts, setV2ModePendingDrafts] = useState<
    Record<string, SatQuestionResponseDraft>
  >({});
  const [v2ModeVisibleDrafts, setV2ModeVisibleDrafts] = useState<
    Record<string, SatQuestionResponseDraft>
  >({});
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, SatQuestionResponseDraft>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [failureKind, setFailureKind] = useState<SatResponseFailureKind | null>(null);
  const [isTakingOver, setIsTakingOver] = useState(false);
  const [tombstoneCount, setTombstoneCount] = useState(0);

  const publishV2EngineState = useCallback(
    (states: ReadonlyMap<string, import('@shared/durability/types').QuestionResponseState>) => {
      if (!mountedRef.current) return;
      const pendingDrafts: Record<string, SatQuestionResponseDraft> = {};
      const visibleDrafts: Record<string, SatQuestionResponseDraft> = {};
      for (const [questionId, state] of states) {
        const visible = getVisibleResponse(state);
        if (visible) visibleDrafts[questionId] = durablePayloadToSatDraft(questionId, visible);
        if (state.pending && visible) {
          pendingDrafts[questionId] = durablePayloadToSatDraft(questionId, visible);
        }
        if (state.confirmed) {
          const previousRevision = v2RevisionRef.current.get(questionId) ?? 0;
          if (state.confirmed.serverRevision > previousRevision) {
            v2RevisionRef.current.set(questionId, state.confirmed.serverRevision);
            onSavedRevisionRef.current(questionId, state.confirmed.serverRevision);
          }
        }
      }
      setV2ModePendingDrafts(pendingDrafts);
      setV2ModeVisibleDrafts(visibleDrafts);
    },
    []
  );

  useEffect(() => {
    identityGenerationRef.current += 1;
    mountedRef.current = true;
    supersededRef.current = false;
    revisionsRef.current.clear();
    serverResponsesRef.current.clear();
    outboxRef.current.clear();
    tombstonesRef.current = [];
    workersRef.current.clear();
    networkReadyAtRef.current.clear();
    canonicalRef.current = null;
    hydratedRef.current = false;
    v2RevisionRef.current.clear();
    v2PendingAcceptancesRef.current.clear();
    setPendingDrafts({});
    setV2ModePendingDrafts({});
    setV2ModeVisibleDrafts({});
    setFailure(null);
    setFailureKind(null);
    setTombstoneCount(0);

    return () => {
      mountedRef.current = false;
      supersededRef.current = true;
    };
  }, [attemptId, scheduleId, useV2DurabilityEngine]);

  useEffect(() => {
    if (!useV2DurabilityEngine) {
      v2EngineRef.current?.destroy();
      v2EngineRef.current = null;
      v2ReadyRef.current = null;
      return;
    }

    const transport = createResponseDurabilityV2Transport(
      scheduleId,
      credentialAttemptRef.current ?? undefined
    );
    v2TransportRef.current = transport;
    const initialLeaseEpoch =
      typeof leaseEpoch === 'number' && Number.isSafeInteger(leaseEpoch) && leaseEpoch > 0
        ? leaseEpoch
        : 1;
    const initialControlEpoch =
      typeof controlEpoch === 'number' && Number.isSafeInteger(controlEpoch) && controlEpoch > 0
        ? controlEpoch
        : 1;
    const generation = identityGenerationRef.current;
    const engine = new DurableResponseEngine({
      scheduleId,
      attemptId,
      leaseEpoch: initialLeaseEpoch,
      controlEpoch: initialControlEpoch,
      transport,
      onStateChange: (states) => {
        if (v2EngineRef.current !== engine) return;
        publishV2EngineState(states);
      },
      onStatusChange: (status, error) => {
        if (
          !mountedRef.current ||
          identityGenerationRef.current !== generation ||
          v2EngineRef.current !== engine
        )
          return;
        setTombstoneCount(engine.getQuarantined().length);
        if (status === 'durability_fault') {
          setFailure(error ?? 'Answer storage is unavailable.');
          setFailureKind('terminal');
        } else if (status === 'conflict_fenced') {
          setFailure(error ?? 'This attempt is active in a newer student session.');
          setFailureKind('superseded');
        } else if (status === 'conflict_terminal') {
          setFailure(error ?? 'This response can no longer be changed.');
          setFailureKind('terminal');
        } else if (status === 'synced') {
          setFailure(null);
          setFailureKind(null);
        }
      },
    });
    v2EngineRef.current = engine;
    const recovery = engine.recover().catch((error: unknown) => {
      if (
        !mountedRef.current ||
        identityGenerationRef.current !== generation ||
        v2EngineRef.current !== engine
      )
        return;
      setFailure(failureMessage(error));
      setFailureKind('retryable');
    });
    v2ReadyRef.current = recovery;

    return () => {
      engine.destroy();
      if (v2EngineRef.current === engine) v2EngineRef.current = null;
      if (v2ReadyRef.current === recovery) v2ReadyRef.current = null;
    };
  }, [
    attemptId,
    controlEpoch,
    leaseEpoch,
    publishV2EngineState,
    scheduleId,
    useV2DurabilityEngine,
    credentialAttempt?.id,
    credentialAttempt?.scheduleId,
    credentialAttempt?.candidateId,
  ]);

  useEffect(() => {
    gatewayRef.current = gateway;
    onSavedRevisionRef.current = onSavedRevision;
  }, [gateway, onSavedRevision]);

  useEffect(() => {
    const engine = v2EngineRef.current;
    if (!engine) return;
    const nextLeaseEpoch =
      typeof leaseEpoch === 'number' && Number.isSafeInteger(leaseEpoch) && leaseEpoch > 0
        ? leaseEpoch
        : 1;
    const nextControlEpoch =
      typeof controlEpoch === 'number' && Number.isSafeInteger(controlEpoch) && controlEpoch > 0
        ? controlEpoch
        : 1;
    engine.updateEpochs(nextLeaseEpoch, nextControlEpoch);
  }, [controlEpoch, leaseEpoch]);

  const publishPendingDrafts = useCallback(() => {
    if (!mountedRef.current) return;
    setPendingDrafts(entriesToDrafts(outboxRef.current));
  }, []);

  const persistCurrentOutbox = useCallback(async () => {
    await persistSatResponseOutbox(
      scheduleId,
      attemptId,
      [...outboxRef.current.values()],
      tombstonesRef.current
    );
  }, [attemptId, scheduleId]);

  const acknowledgeWrite = useCallback(
    async (questionId: string, acknowledgedWriteId: string) => {
      const current = outboxRef.current.get(questionId);
      if (current?.writeId !== acknowledgedWriteId) return;
      outboxRef.current.delete(questionId);
      networkReadyAtRef.current.delete(questionId);
      clearSatResponseCheckpoint(scheduleId, attemptId, questionId);
      publishPendingDrafts();
      try {
        await persistCurrentOutbox();
      } catch (error) {
        if (mountedRef.current) {
          setFailure(failureMessage(error));
          setFailureKind('retryable');
        }
      }
    },
    [attemptId, persistCurrentOutbox, publishPendingDrafts, scheduleId]
  );

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

  const tombstoneWrite = useCallback(
    async (questionId: string, entry: SatResponseOutboxEntry, reason: string) => {
      const current = outboxRef.current.get(questionId);
      if (current?.writeId !== entry.writeId) return;
      const now = new Date().toISOString();
      tombstonesRef.current = [
        ...tombstonesRef.current,
        {
          writeId: entry.writeId,
          questionId,
          moduleAttemptId: entry.moduleAttemptId ?? null,
          stageKey: entry.stageKey ?? null,
          runtimeRevision: entry.runtimeRevision ?? null,
          createdAt: entry.createdAt ?? now,
          rejectedAt: now,
          reason,
          payloadHash: payloadHash(entry),
        },
      ].slice(-200);
      outboxRef.current.delete(questionId);
      networkReadyAtRef.current.delete(questionId);
      clearSatResponseCheckpoint(scheduleId, attemptId, questionId);
      publishPendingDrafts();
      if (mountedRef.current) setTombstoneCount(tombstonesRef.current.length);
      await persistCurrentOutbox();
    },
    [attemptId, persistCurrentOutbox, publishPendingDrafts, scheduleId]
  );

  const startWorker = useCallback(
    (questionId: string): Promise<void> => {
      const existingWorker = workersRef.current.get(questionId);
      if (existingWorker) return existingWorker;
      const generation = identityGenerationRef.current;
      const isCurrent = () =>
        mountedRef.current &&
        !supersededRef.current &&
        identityGenerationRef.current === generation;

      const worker = (async () => {
        while (isCurrent()) {
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
            if (isCurrent()) {
              setFailure(failureMessage(error));
              setFailureKind('retryable');
            }
          }
          if (!isCurrent()) return;

          let transientAttempt = 0;
          let revisionRecoveryAttempted = false;
          const retryStartedAt = Date.now();
          while (isCurrent()) {
            if (outboxRef.current.get(questionId)?.writeId !== entry.writeId) break;
            try {
              const revision = revisionsRef.current.get(questionId) ?? 0;
              const saved = await gatewayRef.current.saveResponse(
                scheduleId,
                attemptId,
                questionId,
                {
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
                }
              );
              if (!isCurrent()) return;
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
                if (isCurrent()) {
                  setFailure('This attempt is active in a newer student session.');
                  setFailureKind('superseded');
                }
                return;
              }

              if (
                reason === 'RESPONSE_REVISION_MISMATCH' ||
                TERMINAL_STAGE_REASONS.has(reason ?? '') ||
                reason === 'RUNTIME_NOT_LIVE' ||
                reason === 'RUNTIME_PAUSED' ||
                reason === 'ATTEMPT_PROCTOR_BLOCKED'
              ) {
                try {
                  const canonical = await gatewayRef.current.bootstrap(scheduleId, attemptId);
                  if (!isCurrent()) return;
                  applyCanonicalPayload(canonical);
                  const server = serverResponsesRef.current.get(questionId);
                  if (server && serverMatchesDraft(server, entry.draft)) {
                    revisionsRef.current.set(questionId, server.revision);
                    onSavedRevisionRef.current(questionId, server.revision);
                    await acknowledgeWrite(questionId, entry.writeId);
                    break;
                  }

                  const obsolete = entryIsObsolete(canonical, entry);
                  const terminal =
                    reason === 'DEADLINE_EXPIRED' ||
                    reason === 'TIMEOUT_RECOVERY_CLOSED' ||
                    ((reason === 'MODULE_NOT_ACTIVE' || reason === 'MODULE_MISMATCH') &&
                      obsolete) ||
                    (reason === 'RUNTIME_NOT_LIVE' &&
                      (obsolete ||
                        ['completed', 'cancelled'].includes(canonical.scheduleRuntimeStatus))) ||
                    (reason === 'ATTEMPT_PROCTOR_BLOCKED' &&
                      canonical.proctorStatus === 'terminated');
                  if (terminal) {
                    await tombstoneWrite(questionId, entry, reason ?? 'TERMINAL_CONFLICT');
                    if (isCurrent()) {
                      setFailure(
                        reason === 'DEADLINE_EXPIRED'
                          ? 'A final response reached the server after the timed section ended.'
                          : 'A pending response belonged to a section that is no longer active.'
                      );
                      setFailureKind('terminal');
                    }
                    break;
                  }

                  if (
                    reason === 'RESPONSE_REVISION_MISMATCH' &&
                    !revisionRecoveryAttempted &&
                    !obsolete
                  ) {
                    revisionRecoveryAttempted = true;
                    continue;
                  }
                  if (reason === 'RUNTIME_PAUSED' || canonical.proctorStatus === 'paused') {
                    if (!isCurrent()) return;
                    setFailure('Saving is paused while the proctor has the exam paused.');
                    setFailureKind('retryable');
                    return;
                  }
                } catch (refreshError) {
                  if (!isCurrent()) return;
                  if (!isTransientFailure(refreshError)) {
                    setFailure(failureMessage(refreshError));
                    setFailureKind('terminal');
                    return;
                  }
                }
              }

              if (!isTransientFailure(error)) {
                if (!isCurrent()) return;
                setFailure(failureMessage(error));
                setFailureKind('terminal');
                return;
              }
              transientAttempt += 1;
              if (
                transientAttempt >= MAX_TRANSIENT_ATTEMPTS ||
                Date.now() - retryStartedAt >= MAX_TRANSIENT_RETRY_WINDOW_MS
              ) {
                if (!isCurrent()) return;
                setFailure(failureMessage(error));
                setFailureKind('retryable');
                return;
              }
              if (!isCurrent()) return;
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
    },
    [
      acknowledgeWrite,
      applyCanonicalPayload,
      attemptId,
      persistCurrentOutbox,
      scheduleId,
      tombstoneWrite,
    ]
  );

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

  const hydrateRevisions = useCallback(
    (responses: readonly AssessmentResponseSnapshot[]) => {
      if (useV2DurabilityEngine) return;
      serverResponsesRef.current.clear();
      for (const response of responses) {
        const current = revisionsRef.current.get(response.examQuestionId) ?? 0;
        if (response.revision >= current)
          revisionsRef.current.set(response.examQuestionId, response.revision);
        serverResponsesRef.current.set(response.examQuestionId, response);
      }
      hydratedRef.current = true;
      reconcileOutboxWithServer();
    },
    [reconcileOutboxWithServer, useV2DurabilityEngine]
  );

  const hydrateBootstrap = useCallback(
    (payload: AssessmentDeliveryBootstrap) => {
      if (useV2DurabilityEngine) return;
      applyCanonicalPayload(payload);
      hydratedRef.current = true;
      reconcileOutboxWithServer();
    },
    [applyCanonicalPayload, reconcileOutboxWithServer, useV2DurabilityEngine]
  );

  const waitForV2Acceptances = useCallback(async () => {
    let firstError: unknown;
    while (v2PendingAcceptancesRef.current.size > 0) {
      const settled = await Promise.allSettled([...v2PendingAcceptancesRef.current]);
      if (firstError === undefined) {
        const rejected = settled.find((entry) => entry.status === 'rejected');
        if (rejected?.status === 'rejected') firstError = rejected.reason;
      }
    }
    if (firstError !== undefined) throw firstError;
  }, []);

  const save = useCallback(
    (response: SatQuestionResponseDraft, context?: SatResponseSaveContext) => {
      if (useV2DurabilityEngine) {
        const generation = identityGenerationRef.current;
        const saveV2 = async () => {
          if (!v2EngineRef.current) {
            const ready = v2ReadyRef.current;
            if (ready) await ready;
          }
          const engine = v2EngineRef.current;
          if (
            !engine ||
            identityGenerationRef.current !== generation ||
            !mountedRef.current
          )
            return;
          await engine.acceptResponse(response.questionId, satDraftToDurablePayload(response));
        };
        const acceptance = saveV2();
        v2PendingAcceptancesRef.current.add(acceptance);
        void acceptance.then(
          () => v2PendingAcceptancesRef.current.delete(acceptance),
          () => v2PendingAcceptancesRef.current.delete(acceptance)
        );
        void acceptance.catch((error: unknown) => {
          if (!mountedRef.current || identityGenerationRef.current !== generation) return;
          setFailure(failureMessage(error));
          setFailureKind('terminal');
        });
        return;
      }

      const createdAt = new Date().toISOString();
      const entry: SatResponseOutboxEntry = {
        writeId: writeId(),
        draft: cloneDraft(response),
        createdAt,
        ...(context
          ? {
              moduleAttemptId: context.moduleAttemptId,
              stageKey: context.stageKey,
              runtimeRevision: context.runtimeRevision,
              interactionType: context.interactionType,
            }
          : {}),
      };
      outboxRef.current.set(response.questionId, entry);
      checkpointSatResponseEntry(scheduleId, attemptId, entry);
      const urgent =
        (context?.remainingSeconds ?? Number.POSITIVE_INFINITY) <= URGENT_REMAINING_SECONDS;
      const typing = context?.interactionType === 'typing';
      networkReadyAtRef.current.set(
        response.questionId,
        typing && !urgent ? Date.now() + TYPING_DEBOUNCE_MS : 0
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
    },
    [
      attemptId,
      persistCurrentOutbox,
      publishPendingDrafts,
      scheduleId,
      startWorker,
      useV2DurabilityEngine,
    ]
  );

  const flush = useCallback(async () => {
    if (useV2DurabilityEngine) {
      await waitForV2Acceptances();
      const ready = v2ReadyRef.current;
      if (ready) await ready;
      const engine = v2EngineRef.current;
      if (!engine) throw new Error('V2 response durability engine is not ready.');
      await engine.flush();
      if (engine.getPendingCount() > 0) {
        throw new Error(
          engine.getLastError() ?? 'One or more responses have not been durably saved.'
        );
      }
      return;
    }

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
  }, [failure, startWorker, useV2DurabilityEngine, waitForV2Acceptances]);

  const submit = useCallback(async (): Promise<SubmitAttemptV2Response> => {
    if (!useV2DurabilityEngine) {
      throw new Error('V2 submission is not enabled for this SAT attempt.');
    }
    await waitForV2Acceptances();
    const ready = v2ReadyRef.current;
    if (ready) await ready;
    const engine = v2EngineRef.current;
    if (!engine) throw new Error('V2 response durability engine is not ready.');
    return engine.submit(attemptId, engine.getAttemptRevision());
  }, [attemptId, useV2DurabilityEngine, waitForV2Acceptances]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const retryFailed = useCallback(async () => {
    if (useV2DurabilityEngine) {
      await flush();
      return;
    }
    if (supersededRef.current) {
      throw new Error('This attempt is active in a newer student session.');
    }
    setFailure(null);
    setFailureKind(null);
    await flush();
  }, [flush, useV2DurabilityEngine]);

  const takeOverLease = useCallback(
    async (reason = 'student_explicit_takeover') => {
      if (!useV2DurabilityEngine) {
        throw new Error('V2 response durability is not enabled for this SAT attempt.');
      }
      const generation = identityGenerationRef.current;
      const attempt = credentialAttempt;
      if (
        !attempt ||
        !mountedRef.current ||
        identityGenerationRef.current !== generation ||
        attempt.id !== attemptId
      ) {
        throw new Error('Missing SAT attempt identity for lease takeover.');
      }
      const previousClientSessionId = ensureClientSessionIdForAttempt(attempt);
      const nextClientSessionId = rotateClientSessionIdForAttempt(attempt);
      let takeoverAccepted = false;
      setIsTakingOver(true);
      try {
        const takeover = await takeOverResponseDurabilityLease(
          scheduleId,
          attemptId,
          { clientSessionId: nextClientSessionId, reason },
          attempt
        );
        takeoverAccepted = true;
        if (
          !mountedRef.current ||
          identityGenerationRef.current !== generation
        ) {
          throw new Error('The SAT attempt changed while lease takeover was in progress.');
        }
        const engine = v2EngineRef.current;
        if (!engine) throw new Error('V2 response durability engine is not ready.');
        const nextControlEpoch =
          typeof controlEpoch === 'number' && Number.isSafeInteger(controlEpoch) && controlEpoch > 0
            ? controlEpoch
            : 1;
        engine.updateEpochs(takeover.leaseEpoch, nextControlEpoch);
        await engine.recover();
        setFailure(null);
        setFailureKind(null);
      } catch (error) {
        if (!takeoverAccepted) {
          restoreClientSessionIdForAttempt(attempt, previousClientSessionId);
        }
        if (mountedRef.current && identityGenerationRef.current === generation) {
          setFailure(failureMessage(error));
          setFailureKind('superseded');
        }
        throw error;
      } finally {
        setIsTakingOver(false);
      }
    },
    [attemptId, controlEpoch, credentialAttempt, scheduleId, useV2DurabilityEngine]
  );

  useEffect(() => {
    mountedRef.current = true;
    supersededRef.current = false;
    if (useV2DurabilityEngine) {
      return () => {
        mountedRef.current = false;
      };
    }
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
    const handleLifecycleDrain = () => {
      if (!mountedRef.current || supersededRef.current) return;
      void flushRef.current().catch(() => undefined);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('visibilitychange', handleLifecycleDrain);
    window.addEventListener('pagehide', handleLifecycleDrain);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('visibilitychange', handleLifecycleDrain);
      window.removeEventListener('pagehide', handleLifecycleDrain);
    };
  }, [
    attemptId,
    publishPendingDrafts,
    reconcileOutboxWithServer,
    scheduleId,
    startWorker,
    useV2DurabilityEngine,
  ]);

  return {
    pendingCount: useV2DurabilityEngine
      ? Object.keys(v2ModePendingDrafts).length
      : Object.keys(pendingDrafts).length,
    pendingDrafts: useV2DurabilityEngine ? v2ModePendingDrafts : pendingDrafts,
    visibleDrafts: useV2DurabilityEngine ? v2ModeVisibleDrafts : pendingDrafts,
    failure,
    failureKind,
    tombstoneCount,
    hydrateRevisions,
    hydrateBootstrap,
    save,
    flush,
    submit,
    retryFailed,
    takeOverLease,
    isTakingOver,
  };
}
