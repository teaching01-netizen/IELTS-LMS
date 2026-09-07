import { useCallback, useEffect, useRef, useState } from 'react';
import { DurableResponseEngine } from '@shared/durability/DurableResponseEngine';
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

export interface SatResponsePersistenceOptions {
  scheduleId: string;
  attemptId: string;
  /** Retained for call-site compatibility; the V2 durability engine owns response transport. */
  gateway: SatDeliveryGateway;
  onSavedRevision: (questionId: string, revision: number) => void;
  leaseEpoch?: number | null | undefined;
  controlEpoch?: number | null | undefined;
  /** Used to refresh an expired attempt credential, including SAT's provider path. */
  credentialAttempt?: StudentAttempt | null | undefined;
}

export type SatResponseFailureKind = 'offline' | 'retryable' | 'terminal' | 'superseded';

export interface SatResponseSaveContext {
  moduleAttemptId: string;
  stageKey: string | null;
  runtimeRevision: number | null;
  remainingSeconds: number;
  interactionType: 'typing' | 'discrete';
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

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Response save failed.';
}

export function satDraftToDurablePayload(draft: SatQuestionResponseDraft): ResponsePayload {
  return {
    answer: draft.answer || null,
    markedForReview: draft.markedForReview,
    eliminatedOptions: [...draft.eliminatedOptionIds],
    annotations: [{ id: 'sat-annotations', kind: 'sat_annotations', ...draft.annotations }],
  };
}

export function durablePayloadToSatDraft(
  questionId: string,
  payload: ResponsePayload
): SatQuestionResponseDraft {
  const annotation = payload.annotations.find(
    (value) => typeof value === 'object' && value !== null && value.id === 'sat-annotations'
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

export function useSatResponsePersistence({
  scheduleId,
  attemptId,
  onSavedRevision,
  leaseEpoch = 1,
  controlEpoch = 1,
  credentialAttempt = null,
}: SatResponsePersistenceOptions): SatResponsePersistence {
  const onSavedRevisionRef = useRef(onSavedRevision);
  const mountedRef = useRef(true);
  const identityGenerationRef = useRef(0);
  const v2EngineRef = useRef<DurableResponseEngine | null>(null);
  const credentialAttemptRef = useRef<StudentAttempt | null>(credentialAttempt);
  credentialAttemptRef.current = credentialAttempt;
  const v2ReadyRef = useRef<Promise<void> | null>(null);
  const v2PendingAcceptancesRef = useRef(new Set<Promise<void>>());
  const v2RevisionRef = useRef(new Map<string, number>());
  const [v2ModePendingDrafts, setV2ModePendingDrafts] = useState<
    Record<string, SatQuestionResponseDraft>
  >({});
  const [v2ModeVisibleDrafts, setV2ModeVisibleDrafts] = useState<
    Record<string, SatQuestionResponseDraft>
  >({});
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
    v2RevisionRef.current.clear();
    v2PendingAcceptancesRef.current.clear();
    setV2ModePendingDrafts({});
    setV2ModeVisibleDrafts({});
    setFailure(null);
    setFailureKind(null);
    setTombstoneCount(0);

    return () => {
      mountedRef.current = false;
    };
  }, [attemptId, scheduleId]);

  useEffect(() => {
    const transport = createResponseDurabilityV2Transport(
      scheduleId,
      credentialAttemptRef.current ?? undefined
    );
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
      drainDebounceMs: 400,
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
    credentialAttempt?.id,
    credentialAttempt?.scheduleId,
    credentialAttempt?.candidateId,
  ]);

  useEffect(() => {
    onSavedRevisionRef.current = onSavedRevision;
  }, [onSavedRevision]);

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

  // V2-only delivery: the durability engine owns server snapshots, so these legacy
  // hydration entry points are intentional no-ops kept for call-site compatibility.
  const hydrateRevisions = useCallback((_responses: readonly AssessmentResponseSnapshot[]) => {
    // No-op: V2 engine state is authoritative.
  }, []);

  const hydrateBootstrap = useCallback((_payload: AssessmentDeliveryBootstrap) => {
    // No-op: V2 engine state is authoritative.
  }, []);

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
    (response: SatQuestionResponseDraft, _context?: SatResponseSaveContext) => {
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
    },
    []
  );

  const flush = useCallback(async () => {
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
  }, [waitForV2Acceptances]);

  const submit = useCallback(async (): Promise<SubmitAttemptV2Response> => {
    await waitForV2Acceptances();
    const ready = v2ReadyRef.current;
    if (ready) await ready;
    const engine = v2EngineRef.current;
    if (!engine) throw new Error('V2 response durability engine is not ready.');
    return engine.submit(attemptId, engine.getAttemptRevision());
  }, [attemptId, waitForV2Acceptances]);

  const retryFailed = useCallback(async () => {
    await flush();
  }, [flush]);

  const takeOverLease = useCallback(
    async (reason = 'student_explicit_takeover') => {
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
    [attemptId, controlEpoch, credentialAttempt, scheduleId]
  );

  return {
    pendingCount: Object.keys(v2ModePendingDrafts).length,
    pendingDrafts: v2ModePendingDrafts,
    visibleDrafts: v2ModeVisibleDrafts,
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
