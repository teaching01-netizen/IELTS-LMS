import { useCallback, useEffect, useRef, useState } from 'react';
import { DurableResponseEngine, type ScopeManifestEntry } from '@shared/durability/DurableResponseEngine';
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
  type QuarantinedWrite,
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

export type SatResponseFailureKind = 'offline' | 'retryable' | 'terminal' | 'expired' | 'superseded' | 'module_closed';

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
   * Adopt an authoritative control epoch read off a transition ack (module
   * entry) ahead of the attempt projection that carries it. No-op when no
   * engine is installed yet — the entry ack's epoch is a latency optimization,
   * never a fence, so a missing engine falls back to the existing 409 -> heal
   * path. The engine re-checks every guard and refuses when work is
   * outstanding (a draft is never blocked in order to adopt).
   */
  adoptControlEpoch?: (epoch: number, source: string) => void;
  /**
   * SAT-004 boundary barrier: refuses while any visible answer is unsettled
   * (blocked, quarantined, queued, or awaiting a version). Module submission
   * and terminal submit share it; never infer safety from queue length.
   */
  assertBoundarySettled?: () => Promise<void>;
  /**
   * Module attempts the server closed while this device still held answers
   * for them. Those answers are kept here as evidence (uploaded once for
   * review) and never block the next module. Additive; defaults to [].
   */
  closedModuleAttemptIds?: ReadonlyArray<string>;
  /** The close manifest for one module attempt (see DurableResponseEngine.getScopeManifest). */
  closeManifest?: (moduleAttemptId: string) => ScopeManifestEntry[];
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
  gateway,
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
  // Write scope per question — the module attempt it belongs to — learned
  // from every committed payload. The engine sends one module per batch and
  // confines a closed-module refusal to that module's drafts.
  const questionScopeRef = useRef(new Map<string, string>());
  const moduleIdByAttemptRef = useRef(new Map<string, string>());
  const evidenceSentRef = useRef(new Set<string>());
  const [closedModuleAttemptIds, setClosedModuleAttemptIds] = useState<string[]>([]);
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
      // A closed module's drafts are evidence, not "needs attention" work.
      const closedScopes = v2EngineRef.current?.getClosedScopes();
      for (const [questionId, state] of states) {
        const scope = questionScopeRef.current.get(questionId);
        if (state.pending?.blocked && !(scope !== undefined && closedScopes?.has(scope))) blocked.push(questionId);
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
    questionScopeRef.current.clear();
    moduleIdByAttemptRef.current.clear();
    evidenceSentRef.current.clear();
    setClosedModuleAttemptIds([]);

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
      scopeOf: (questionId) => questionScopeRef.current.get(questionId) ?? null,
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
        const closedScopes = engine.getClosedScopes();
        setClosedModuleAttemptIds((previous) =>
          previous.length === closedScopes.size && previous.every((id) => closedScopes.has(id))
            ? previous
            : [...closedScopes.keys()]
        );
        let blockedIds: string[] = [];
        try {
          blockedIds = engine.getBlockedQuestionIds().filter((questionId) => {
            const scope = questionScopeRef.current.get(questionId);
            return !(scope !== undefined && closedScopes.has(scope));
          });
        } catch {
          blockedIds = [];
        }
        setBlockedDrafts(blockedIds);
        const display = mapEngineStatus(status, blockedIds.length);
        if (error?.startsWith('MODULE_CLOSED:')) {
          setFailure('An answer from an ended module remains on this device for proctor review.');
          setFailureKind('module_closed');
        } else if (error?.includes('DEADLINE_EXPIRED') || error?.includes('TIMEOUT_RECOVERY_CLOSED')) {
          setFailure('A final answer was not confirmed before the save window ended. It remains on this device. Please contact your proctor.');
          setFailureKind('expired');
        } else if (status === 'durability_fault') {
          setFailure(error ?? 'Answer storage is unavailable.');
          setFailureKind('terminal');
        } else if (status === 'conflict_fenced') {
          // Ownership moved (device transfer / lease fence). Drafts the fence
          // blocked are evidence kept on this device, not something to retry
          // here: the student must see that the exam continues elsewhere.
          setFailure(error ?? 'This attempt is active in a newer student session.');
          setFailureKind('superseded');
        } else if (display === 'blocked_attention') {
          setFailure(
            error ??
              'Your latest answer is kept on this device. Re-checking with the exam\u2026'
          );
          setFailureKind('retryable');
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

  // V2 engine state stays authoritative for answers; the payload only teaches
  // the engine which module attempt each question belongs to (write scope).
  const hydrateBootstrap = useCallback((payload: AssessmentDeliveryBootstrap) => {
    const attemptByModule = new Map(
      payload.attempt.moduleAttempts.map((moduleAttempt) => [moduleAttempt.moduleId, moduleAttempt.id])
    );
    for (const section of payload.sections) {
      for (const module of section.modules) {
        const moduleAttemptId = attemptByModule.get(module.id);
        if (!moduleAttemptId) continue;
        moduleIdByAttemptRef.current.set(moduleAttemptId, module.id);
        for (const question of module.questions) {
          questionScopeRef.current.set(question.examQuestionId, moduleAttemptId);
        }
      }
    }
    const engine = v2EngineRef.current;
    for (const module of payload.attempt.moduleAttempts) {
      if (module.state === 'locked' || module.state === 'submitted') engine?.sealScope(module.id);
    }
    engine?.refreshScopes();
  }, []);

  // Late-answer evidence (review only, never scored): once per closed module,
  // upload the latest answer this device still held for each of its
  // questions. Failed uploads retry while this attempt remains mounted.
  useEffect(() => {
    const engine = v2EngineRef.current;
    if (!engine || !gateway.recordLateEvidence) return;
    let cancelled = false;
    const retryTimers: number[] = [];
    for (const moduleAttemptId of closedModuleAttemptIds) {
      if (evidenceSentRef.current.has(moduleAttemptId)) continue;
      const moduleId = moduleIdByAttemptRef.current.get(moduleAttemptId);
      const reason = engine.getClosedScopes().get(moduleAttemptId);
      if (!moduleId || !reason) continue;
      const latest = new Map<string, QuarantinedWrite>();
      for (const entry of engine.getQuarantined()) {
        if (entry.reason !== reason || questionScopeRef.current.get(entry.questionId) !== moduleAttemptId) continue;
        const previous = latest.get(entry.questionId);
        if (!previous || entry.clientVersion >= previous.clientVersion) latest.set(entry.questionId, entry);
      }
      if (latest.size === 0) continue;
      const answers = [...latest.values()].map((entry) => ({
        questionId: entry.questionId,
        writeId: entry.writeId,
        response: entry.payload,
        clientReceivedAt: entry.quarantinedAt,
      }));
      const upload = async (retry: number): Promise<void> => {
        if (cancelled || evidenceSentRef.current.has(moduleAttemptId)) return;
        try {
          await gateway.recordLateEvidence!(scheduleId, attemptId, { moduleId, answers });
          if (!cancelled) evidenceSentRef.current.add(moduleAttemptId);
        } catch {
          if (!cancelled) retryTimers.push(window.setTimeout(() => void upload(retry + 1), Math.min(30_000, 1_000 * 2 ** Math.min(retry, 5))));
        }
      };
      void upload(0);
    }
    return () => { cancelled = true; retryTimers.forEach(window.clearTimeout); };
  }, [attemptId, closedModuleAttemptIds, gateway, scheduleId]);

  const closeManifest = useCallback(
    (moduleAttemptId: string): ScopeManifestEntry[] =>
      v2EngineRef.current?.getScopeManifest(moduleAttemptId) ?? [],
    []
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

  // Entry-ack control-epoch adoption. The controller reads the epoch off the
  // start/entry ack (the server bumps control_epoch in the same transaction
  // that opens the module, then answers with the post-commit value) and hands
  // it here BEFORE any answer can be accepted, so the first batch no longer
  // rides the pre-bump fence. The engine owns every guard; this wrapper owns
  // only the engine lookup, so a missing engine degrades to the existing
  // 409 -> heal path instead of throwing on the entry path.
  const adoptControlEpoch = useCallback(
    (epoch: number, source: string) => {
      const engine = v2EngineRef.current;
      if (!engine) {
        emitStudentObservabilityMetric(
          'control_epoch_adopt_skipped',
          withStudentObservabilityDimensions({
            scheduleId,
            attemptId,
            reason: 'engine_unavailable',
            source,
          })
        );
        return;
      }
      engine.adoptControlEpochIfIdle(epoch, source);
    },
    [attemptId, scheduleId]
  );

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
    adoptControlEpoch,
    assertBoundarySettled,
    closedModuleAttemptIds,
    closeManifest,
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
