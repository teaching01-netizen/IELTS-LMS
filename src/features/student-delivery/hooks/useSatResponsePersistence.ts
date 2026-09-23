import { useCallback, useEffect, useRef, useState } from 'react';
import { DurableResponseEngine } from '@shared/durability/DurableResponseEngine';
import {
  blockedSubmitGateMessage,
  mapEngineStatus,
  type ReconcileBlockedResult,
} from '@shared/durability/useResponseDurabilityStatus';
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
import {
  normalizeSatAnnotations,
  normalizeSatResponseDraft,
  type SatQuestionResponseDraft,
} from '../domain/satResponses';
import type { SatDeliveryGateway } from '../application/ports/SatDeliveryGateway';
import type { StudentAttempt } from '../../../types/studentAttempt';
import {
  ensureBrowserClientSessionIdForAttempt,
  restoreClientSessionIdForAttempt,
  rotateClientSessionIdForAttempt,
} from '@student/api/studentAttemptGateway';
import { emitStudentObservabilityMetric, withStudentObservabilityDimensions } from "../../../utils/studentObservability";

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

export type SatResponseFailureKind = 'offline' | 'retryable' | 'terminal' | 'expired' | 'superseded';

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
  /** Question ids whose visible drafts need attention (blocked, never sent). Additive; defaults to []. */
  blockedDrafts?: ReadonlyArray<string>;
  /** Alias kept for the engine vocabulary; same ids as blockedDrafts. Additive; defaults to []. */
  blockedQuestionIds?: ReadonlyArray<string>;
  /** Count of blocked drafts; mirrors blockedDrafts.length. Additive; defaults to 0. */
  blockedCount?: number;
  /**
   * Best-effort reconcile of one blocked question (defensive engine call).
   * Returns a reason union: "reconciled" | "not-blocked" | "refusal" |
   * `error:${string}`. Awaiting callers treat "reconciled" as success.
   */
  reconcileBlocked?: (questionId: string) => Promise<ReconcileBlockedResult>;
  /**
   * SAT-004 boundary barrier: refuses while any visible answer is unsettled
   * (blocked, quarantined, queued, or awaiting a version). Module submission
   * and terminal submit share it; never infer safety from queue length.
   */
  assertBoundarySettled?: () => Promise<void>;
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
  // Audit finding 3: the durability boundary is the last place the invariant
  // can be enforced before a contradictory draft reaches storage. Normalizing
  // here means an already-persisted `answer ∈ eliminatedOptions` record cannot
  // be re-sent, whatever produced the draft object.
  const normalized = normalizeSatResponseDraft(draft);
  return {
    answer: normalized.answer || null,
    markedForReview: normalized.markedForReview,
    eliminatedOptions: [...normalized.eliminatedOptionIds],
    annotations: [{ id: 'sat-annotations', kind: 'sat_annotations', ...normalized.annotations }],
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
  // Heal on read: a server snapshot or outbox entry written before the fix may
  // still carry the impossible pair, and reloading it must not resurrect it.
  return normalizeSatResponseDraft({
    questionId,
    answer: typeof payload.answer === 'string' ? payload.answer : '',
    markedForReview: payload.markedForReview,
    eliminatedOptionIds: [...payload.eliminatedOptions],
    annotations: normalizeSatAnnotations(annotationRecord),
  });
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
  // Per-question "needs attention" ids. Refreshed from the engine on every
  // status/state publish; additive only (exposed as blockedDrafts, the
  // visibleDrafts path is untouched).
  const [blockedDrafts, setBlockedDrafts] = useState<string[]>([]);

  const publishV2EngineState = useCallback(
    (states: ReadonlyMap<string, import('@shared/durability/types').QuestionResponseState>) => {
      if (!mountedRef.current) return;
      const pendingDrafts: Record<string, SatQuestionResponseDraft> = {};
      const visibleDrafts: Record<string, SatQuestionResponseDraft> = {};
      // Blocked ids ride the existing publish (metadata only: ids + flags).
      // Blocked drafts stay in visibleDrafts (visible, never sent); the new
      // blockedDrafts field names them for banners/badges. visibleDrafts path
      // itself is unchanged.
      const blocked: string[] = [];
      for (const [questionId, state] of states) {
        if (state.pending?.blocked) blocked.push(questionId);
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
      setBlockedDrafts(blocked);
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
    setBlockedDrafts([]);
    setFailure(null);
    setFailureKind(null);
    setTombstoneCount(0);

    return () => {
      mountedRef.current = false;
    };
  }, [attemptId, scheduleId]);

  useEffect(() => {
    const attempt = credentialAttemptRef.current ?? undefined;
    const transport = createResponseDurabilityV2Transport(
      scheduleId,
      attempt,
      attempt ? ensureBrowserClientSessionIdForAttempt(attempt) : undefined,
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
      // WP7 reason-coded counters (telemetry only; never answer content).
      onDurabilityEvent: (name, fields) =>
        emitStudentObservabilityMetric(
          name,
          withStudentObservabilityDimensions({ scheduleId, attemptId, ...fields })
        ),
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
        // Shared WP4/WP5 vocabulary via the shared mapper (same as IELTS).
        // blocked_attention => retryable failure with exam-stress-safe copy,
        // explicitly NOT terminal/superseded: the draft is kept on this
        // device, visible, and recoverable via reconcile.
        let blockedIds: string[] = [];
        try {
          blockedIds = engine.getBlockedQuestionIds();
        } catch {
          blockedIds = [];
        }
        setBlockedDrafts(blockedIds);
        const display = mapEngineStatus(status, blockedIds.length);
        if (error?.includes('DEADLINE_EXPIRED')) {
          setFailure('A final answer was not confirmed before the save window ended. It remains on this device. Please contact your proctor.');
          setFailureKind('expired');
        } else if (status === 'durability_fault') {
          setFailure(error ?? 'Answer storage is unavailable.');
          setFailureKind('terminal');
        } else if (display === 'blocked_attention') {
          setFailure(
            error ??
              'Your latest answer is kept on this device. Re-checking with the exam\u2026'
          );
          setFailureKind('retryable');
        } else if (status === 'conflict_fenced') {
          setFailure(error ?? 'This attempt is active in a newer student session.');
          setFailureKind('superseded');
        } else if (status === 'conflict_terminal') {
          setFailure(error ?? 'This response can no longer be changed.');
          setFailureKind('terminal');
        } else if (status === 'saved_locally' && error) {
          setFailure(error);
          setFailureKind('retryable');
        } else if (status === 'synced' && display === 'saved') {
          setFailure(null);
          setFailureKind(null);
        }
      },
    });
    v2EngineRef.current = engine;
    const recovery = engine.recover().then(() => {
      if (
        mountedRef.current &&
        identityGenerationRef.current === generation &&
        v2EngineRef.current === engine
      ) {
        setTombstoneCount(engine.getQuarantined().length);
      }
    }).catch((error: unknown) => {
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
    (response: SatQuestionResponseDraft, context?: SatResponseSaveContext) => {
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
        await engine.acceptResponse(response.questionId, satDraftToDurablePayload(response), {
          drainImmediately:
            context?.interactionType !== 'typing' ||
            (context.remainingSeconds <= 5),
        });
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

  // SAT-004: one boundary barrier for module submission AND the terminal
  // submit. The engine owns the invariant (blocked / quarantined / queued /
  // unacknowledged visible intent); this wrapper maps its refusals to the
  // shared exam-stress-safe gate copy and publishes failure state for the
  // route banner. Queue length alone is never safety: a blocked draft can be
  // visible while the outbox is empty.
  const assertBoundarySettled = useCallback(async (): Promise<void> => {
    await waitForV2Acceptances();
    const ready = v2ReadyRef.current;
    if (ready) await ready;
    const engine = v2EngineRef.current;
    if (!engine) throw new Error('V2 response durability engine is not ready.');
    try {
      engine.assertBoundarySettled();
    } catch (error) {
      let blockedCount = 0;
      let quarantined = 0;
      try {
        blockedCount = engine.getBlockedCount();
      } catch {
        blockedCount = 0;
      }
      try {
        quarantined = engine.getQuarantined().length;
      } catch {
        quarantined = 0;
      }
      if (blockedCount > 0 || quarantined > 0) {
        try {
          setBlockedDrafts(engine.getBlockedQuestionIds());
        } catch {
          // Keep the last published ids; next publish refreshes them.
        }
        setTombstoneCount(quarantined);
        // Shared exam-stress-safe gate copy (same function IELTS uses).
        const message = blockedSubmitGateMessage(blockedCount, quarantined);
        setFailure(message);
        setFailureKind('retryable');
        throw new Error(message);
      }
      throw error;
    }
  }, [waitForV2Acceptances]);

  const submit = useCallback(async (): Promise<SubmitAttemptV2Response> => {
    await waitForV2Acceptances();
    const ready = v2ReadyRef.current;
    if (ready) await ready;
    const engine = v2EngineRef.current;
    if (!engine) throw new Error('V2 response durability engine is not ready.');
    // Blocked/quarantined drafts and unsettled visible intent must be resolved
    // or explicitly discarded before finalization; never silently exclude
    // drafts. Throwing blocks the
    // assessment-finalize path, which surfaces failure/failureKind in the
    // route banner + review page. engine.submit() keeps its own guard as the
    // provider-independent backstop below.
    await assertBoundarySettled();
    try {
      return await engine.submit(attemptId, engine.getAttemptRevision());
    } catch (error) {
      // Engine-gate backstop: if the provider-level gate above raced (a
      // control bump blocked a draft between the check and engine.submit),
      // the engine throws "Blocked drafts need attention before submit. ...".
      // Match that gate error and force the shared exam-stress-safe gate
      // copy — never a generic pending+retry failure — so the banner shows
      // the actionable "kept on this device / ask your proctor" message
      // with retryable kind. The engine guard stays the backstop.
      if (error instanceof Error && error.message.includes('Blocked drafts need attention')) {
        let backstopBlocked = 0;
        let backstopQuarantined = 0;
        try {
          backstopBlocked = engine.getBlockedCount();
        } catch {
          backstopBlocked = 0;
        }
        try {
          backstopQuarantined = engine.getQuarantined().length;
        } catch {
          backstopQuarantined = 0;
        }
        try {
          setBlockedDrafts(engine.getBlockedQuestionIds());
        } catch {
          // Keep the last published ids; next publish refreshes them.
        }
        setTombstoneCount(backstopQuarantined);
        const message = blockedSubmitGateMessage(backstopBlocked, backstopQuarantined);
        setFailure(message);
        setFailureKind('retryable');
        throw new Error(message);
      }
      throw error;
    }
  }, [assertBoundarySettled, attemptId, waitForV2Acceptances]);

  // Best-effort reconcile of one blocked question. Returns a reason union
  // ('reconciled' | 'not-blocked' | 'refusal' | `error:${string}`) so
  // callers can distinguish refusal (lease fence / terminal / server-newer /
  // superseded / in-progress) from a thrown exception. The engine provides
  // engine.reconcileBlocked(questionId): boolean; the recover() fallback is
  // kept only under a typeof check — the engine is expected to always
  // provide reconcileBlocked, so the fallback is defensive only. Never
  // crashes and never imports storage internals (type-only engine import at
  // the top; no runtime/storage imports).
  const reconcileBlocked = useCallback(
    async (questionId: string): Promise<ReconcileBlockedResult> => {
      const engine = v2EngineRef.current;
      if (!engine) return 'not-blocked';
      if (!questionId.trim()) return 'not-blocked';
      // Not blocked: nothing to do (covers already-reconciled/discarded).
      try {
        if (engine.getBlockedQuestionIds().includes(questionId) === false) return 'not-blocked';
      } catch {
        // Reader threw: fall through and let the reconcile attempt decide.
      }
      const candidate = engine as unknown as {
        reconcileBlocked?: (id: string) => Promise<boolean>;
      };
      let reconciled: boolean;
      try {
        if (typeof candidate.reconcileBlocked === 'function') {
          reconciled = await candidate.reconcileBlocked(questionId);
        } else {
          // Defensive fallback (engine always provides reconcileBlocked);
          // re-run recovery so a fresh snapshot re-seeds + re-publishes state.
          await engine.recover();
          reconciled = false;
        }
      } catch (error) {
        try {
          setBlockedDrafts(engine.getBlockedQuestionIds());
        } catch {
          // Keep the last published ids; next publish refreshes them.
        }
        const message = error instanceof Error ? error.message : String(error);
        return `error:${message}`;
      }
      // Refresh blocked ids on every outcome (including refusal) so the
      // banner cannot stick on stale ids.
      let remaining: string[] = [];
      try {
        remaining = engine.getBlockedQuestionIds();
        setBlockedDrafts(remaining);
      } catch {
        // Keep the last published ids; next publish refreshes them.
      }
      if (remaining.includes(questionId) === false) return 'reconciled';
      // Still blocked afterwards: engine refused (returned false) or the
      // recover() fallback could not clear it.
      void reconciled;
      return 'refusal';
    },
    []
  );

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
      const previousClientSessionId = ensureBrowserClientSessionIdForAttempt(attempt);
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

  // Engine recreation on epoch props serializes AFTER the new engine
  // recovers: the creation effect above awaits v2ReadyRef (engine.recover())
  // before any save() acceptance proceeds, and save() itself awaits the
  // ready promise when the engine is not yet installed. Sync intent
  // checkpoints make that window safe. Kept as-is; do not restructure.
  return {
    pendingCount: Object.keys(v2ModePendingDrafts).length,
    pendingDrafts: v2ModePendingDrafts,
    visibleDrafts: v2ModeVisibleDrafts,
    blockedDrafts,
    blockedQuestionIds: blockedDrafts,
    blockedCount: blockedDrafts.length,
    reconcileBlocked,
    assertBoundarySettled,
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
