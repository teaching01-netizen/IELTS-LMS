import { useSatSectionEntry } from "./useSatSectionEntry";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { resolveAuthoritativeRemainingSeconds } from "@shared/hooks/useAuthoritativeDeadlineClock";
import { emitStudentObservabilityMetric } from "../../../utils/studentObservability";
import {
  isCohortTimingModel,
  isSatPersonalTimingModel,
  type ExamSessionRuntime,
} from "../../../types/domain";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentModuleEntryStateAck,
  AssessmentModuleCloseIntentRequest,
  AssessmentResult,
  AssessmentTimingSnapshot,
  SATRecoveryResolutionReceipt,
  SATRecoveryResolutionRequest,
} from "../contracts/assessmentDelivery";
import type { StudentAttempt } from "../../../types/studentAttempt";
import {
  applySatResponseDraftChange,
  normalizeSatAnnotations,
  responseForQuestion,
  type SatQuestionAnnotations,
  type SatQuestionResponseDraft,
  type SatResponseDraftChange,
} from "../domain/satResponses";
import {
  breakRemainingSeconds,
  mergeAuthoritativeTiming,
  personalModuleRemainingSeconds as personalModuleCountdown,
} from "../domain/satTiming";
import { resolveSatExamToolPolicy } from "../domain/satToolPolicy";
import {
  configureSatDeliveryAttempt,
  satDeliveryGateway,
} from "../infrastructure/satDeliveryGateway";
import {
  calculatorWorkspaceKey,
  clearCalculatorWorkspace,
  clearCalculatorWorkspacesForAttempt,
} from "../infrastructure/satCalculatorWorkspace";
import { clearSatReadingPreferences } from "../infrastructure/satReadingPreferencesStore";
import { clearSatEliminatorMode } from "../infrastructure/satEliminatorModeStore";
import { clearSatNotesColumn } from "../infrastructure/satNotesColumnStore";
import { createSatRunnerState, satRunnerReducer } from "../application/satRunnerReducer";
// SAT-005/007: commit-to-phase routing and conflict policy live in application/
// (pure); the hook only wires them to state and the gateway.
import {
  decideSatCommitRoute,
  startModuleRouteAction,
  type SatCommitHint,
} from "../application/satCommitRouting";
import { createSatFinalizationGate } from "../application/satFinalizationGate";
import { applyCloseAck, applyEntryAck, isEntryAck } from "../application/satEntryAck";
import { adoptEntryControlEpochFromAck } from "../application/satEntryControlEpoch";
import {
  classifyStartCodeError,
  normalizeStartCodeInput,
  type SatStartCodeRefusal,
} from "../application/satStartCode";
// Clock + cadence policy (pure): display allotment vs expiry authority, stage
// readiness, break/wait countdowns, and the recovery-poll cadence.
import {
  satBreakCountdownSeconds,
  satBreakWindow,
  satOpenPersonalBreak,
  satClockOffsetMs,
  satCountdown,
  satExpectedStageKey,
  satModuleWindow,
  satPersonalClockRunning,
  satSectionWaitSeconds,
  satSharedClockRunning,
  satStageReady,
} from "../application/satTimingPolicy";
import { satPollDelayMs } from "../application/satPollCadence";
import type { PreparedScopeClose } from "@shared/durability/DurableResponseEngine";
import {
  classifySatCloseRejection,
  isSatEntryWindowExpiredRejection,
  isSectionClosingRejection,
  isControlEpochStaleRejection,
  isStaleConflictRejection,
  isWriterSupersededRejection,
} from "../application/satSubmitConflicts";
import type { SatToolId } from "../domain/satTools";
import {
  findActiveAttempt,
  findAttemptForModule,
  findCurrentModule,
  findPendingAttempt,
  matchesFinalModuleState,
  moduleForAttempt,
  sectionForModule,
} from "../application/satRuntimeSelectors";
import {
  deriveSatEntryDecision,
  isSatStartCodePending,
  previousTimedOutModuleDeadlineAt,
  previousModuleTimedOut as previousModuleEndedByClock,
  type SatEntryOutcome,
} from "../application/satEntry";
import { seedMatchesIdentity, type SatBootstrapSeed } from "../bootstrap/satBootstrapSeed";
import {
  isEquivalentBootstrap,
  regressesAttemptState,
  SERVER_NOW_SKIP_TOLERANCE_MS,
} from "../application/satBootstrapEquality";
import { useSatIntegrityControl } from "./useSatIntegrityControl";
import { useSatModuleEntry } from "./useSatModuleEntry";
import { useSatBreakEntry } from "./useSatBreakEntry";
import { useSatResponsePersistence } from "./useSatResponsePersistence";
import { deriveSatTemporalSnapshot, type SatTemporalModel } from "../timing/satTemporalModel";

/**
 * Break-end pull window (Phase 3): at most one forced refresh per runtime
 * revision, and never faster than this. The section advance is system-driven,
 * so it does not ride the parent poll's control-command fast lane, and the
 * student would otherwise sit at 0:00 until that poll's steady cadence fires.
 * The same break surface stays mounted for the tiny propagation window and is
 * replaced directly by the next active module when state arrives.
 */
const SAT_BREAK_END_PULL_WINDOW_MS = 2_000;
/**
 * Personal break end: refresh at once, then sequentially at the pull window's
 * cadence for at most this many reads or this long. Afterward ordinary
 * recovery polling continues and the break screen reports the retry state.
 */
const SAT_BREAK_END_MAX_READS = 8;
const SAT_BREAK_END_MAX_MS = 20_000;

/**
 * Module close at expiry (docs/sat-m1-m2-handoff-plan.md, Phase 3): how long
 * the browser keeps confirming its final answers before it leaves routing to
 * the server's close window, and how many short reads then look for the
 * routed module before the steady recovery poll takes over.
 */
const SAT_CLOSE_BUDGET_MS = 20_000;
const SAT_RECOVERY_CLOSE_MAX_BACKOFF_MS = 15_000;
const SAT_CLOSE_CHUNK_BODY_BUDGET_BYTES = 192 << 10;
const SAT_RECOVERY_CLOSE_OFFLINE_WAIT_MS = 30_000;
const SAT_CLOSE_FALLBACK_READS = 8;
/**
 * How long the timeout overlay may wait for the server to report the expired
 * module closed before it offers a retry and points the student to the
 * proctor. Longer than the close budget plus the fallback reads (~45 s), so a
 * close that is merely slow never shows it.
 */
const SAT_TIMEOUT_STALL_MS = 60_000;

type SatRefreshOutcomeCallback = (ok: boolean, retryAfterMs?: number) => void;

interface SatRefreshBatch {
  surfaceError: boolean;
  outcomeCallbacks: SatRefreshOutcomeCallback[];
}

interface SatRefreshFlight {
  key: string;
  first: SatRefreshBatch;
  followUp: SatRefreshBatch | null;
  followUpStarted: boolean;
  promise: Promise<AssessmentDeliveryBootstrap | null>;
}

function waitForCloseRetry(milliseconds: number, wakeOnOnline: boolean): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, Math.max(0, milliseconds));
    if (wakeOnOnline) window.addEventListener("online", finish, { once: true });
  });
}

function splitFrozenCloseCommands(
  prepared: PreparedScopeClose,
): Array<typeof prepared.finalCommands> {
  const moduleClose = { moduleAttemptId: prepared.scopeId, manifestHash: prepared.manifestHash };
  const chunks: Array<typeof prepared.finalCommands> = [];
  let current: typeof prepared.finalCommands = [];
  for (const command of prepared.finalCommands) {
    const candidate = [...current, command];
    const bytes = new TextEncoder().encode(JSON.stringify({
      leaseEpoch: prepared.leaseEpoch,
      controlEpoch: prepared.controlEpoch,
      moduleClose,
      commands: candidate,
    })).byteLength;
    if (bytes > SAT_CLOSE_CHUNK_BODY_BUDGET_BYTES) {
      if (current.length === 0) {
        throw new Error("One answer is too large to recover safely. Keep this screen open and contact your proctor.");
      }
      chunks.push(current);
      current = [command];
      const singleBytes = new TextEncoder().encode(JSON.stringify({
        leaseEpoch: prepared.leaseEpoch,
        controlEpoch: prepared.controlEpoch,
        moduleClose,
        commands: current,
      })).byteLength;
      if (singleBytes > SAT_CLOSE_CHUNK_BODY_BUDGET_BYTES) {
        throw new Error("One answer is too large to recover safely. Keep this screen open and contact your proctor.");
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * The control-epoch fence is optional on the wire: with
 * exactOptionalPropertyTypes an explicit `undefined` is not assignable, and an
 * absent key is what tells the server "this client opted out". Spread this
 * rather than writing `controlEpoch: value ?? undefined`.
 */
function controlEpochField(epoch: number | null | undefined): { controlEpoch?: number } {
  return epoch == null ? {} : { controlEpoch: epoch };
}

function currentControlEpochFromConflict(error: unknown): number | null {
  if (!isControlEpochStaleRejection(error) || typeof error !== "object" || error === null) return null;
  const record = error as { details?: unknown; backendDetails?: unknown };
  const details = record.details ?? record.backendDetails;
  if (typeof details !== "object" || details === null) return null;
  const epoch = (details as { currentControlEpoch?: unknown }).currentControlEpoch;
  return typeof epoch === "number" && Number.isSafeInteger(epoch) && epoch > 0 ? epoch : null;
}

function retryAfterMsFromError(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { details?: unknown; backendDetails?: unknown };
  const details = record.details ?? record.backendDetails;
  if (typeof details !== "object" || details === null) return undefined;
  const rawSeconds = (details as { retryAfterSeconds?: unknown; retryAfterSecs?: unknown })
    .retryAfterSeconds ?? (details as { retryAfterSecs?: unknown }).retryAfterSecs;
  const seconds = typeof rawSeconds === "number" ? rawSeconds : Number(rawSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : undefined;
}

export interface UseSatExamControllerOptions {
  scheduleId: string;
  attemptId: string;
  candidateId: string;
  attemptSnapshot?: StudentAttempt | null;
  runtimeSnapshot?: ExamSessionRuntime | null;
  liveSocketConnected?: boolean;
  attemptUpdateToken?: number;
  leaseEpoch?: number | null | undefined;
  controlEpoch?: number | null | undefined;
  // Phase 02 bootstrap seed (frontend-only handoff from the parent route).
  // Optional + backwards-compatible; initialIsLoading is forwarded for
  // Phase 04 (unused here — kept out of the bootstrap effect deps).
  bootstrapSeed?: SatBootstrapSeed | null;
  initialIsLoading?: boolean;
}

/** The code form's answer: started, or the one refusal to show (null = no change). */
export interface SatStartCodeOutcome {
  ok: boolean;
  refusal: SatStartCodeRefusal | null;
}

export function useSatExamController({
  scheduleId,
  attemptId,
  candidateId,
  attemptSnapshot = null,
  runtimeSnapshot = null,
  liveSocketConnected = false,
  attemptUpdateToken = 0,
  leaseEpoch,
  controlEpoch,
  bootstrapSeed = null,
  initialIsLoading = false,
}: UseSatExamControllerOptions) {
  void initialIsLoading;
  const [state, dispatch] = useReducer(
    satRunnerReducer,
    // Phase 04 identity fix: candidateId is the route candidate prop, never
    // the attempt id (carried into newWorkingState via state.candidateId).
    createSatRunnerState(scheduleId, candidateId)
  );
  const [data, setData] = useState<AssessmentDeliveryBootstrap | null>(null);
  const [snapshotReceivedAt, setSnapshotReceivedAt] = useState(() => Date.now());
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [expiredEntryModuleId, setExpiredEntryModuleId] = useState<string | null>(null);
  const entryAuthorizedAtRef = useRef<{ moduleId: string; at: number; transitionDeadlineAt?: number } | null>(null);
  const uncertainCodeStartGenerationRef = useRef<number | null>(null);
  const reportedAnswerableModulesRef = useRef(new Set<string>());
  const now = Date.now();
  const [, wakeAtTemporalBoundary] = useState(0);
  const timeoutTransitionKeyRef = useRef<string | null>(null);
  const [timeoutTransitionKey, setTimeoutTransitionKey] = useState<string | null>(null);
  const [timeoutTransitionStarted, setTimeoutTransitionStarted] = useState(false);
  // SAT-002: one owner for "which revision may finalize, and is one already
  // running" — the claim / single-flight / release rules live in
  // application/satFinalizationGate.ts and protect the automatic result path.
  const finalizationGateRef = useRef(
    createSatFinalizationGate<AssessmentResult | null>()
  );
  const identityGenerationRef = useRef(0);
  const entryControlEpochRef = useRef<number | null | undefined>(controlEpoch);
  const identityKey = `${scheduleId}:${attemptId}:${candidateId}`;
  const previousIdentityKeyRef = useRef<string | null>(null);
  if (previousIdentityKeyRef.current !== identityKey) {
    previousIdentityKeyRef.current = identityKey;
    identityGenerationRef.current += 1;
    entryControlEpochRef.current = controlEpoch;
  }
  const renderIdentityGeneration = identityGenerationRef.current;
  if (typeof controlEpoch === "number" && controlEpoch > (entryControlEpochRef.current ?? 0)) {
    entryControlEpochRef.current = controlEpoch;
  }
  const withEntryControlEpoch = useCallback(async <T,>(
    request: (epoch: number | null | undefined) => Promise<T>,
  ): Promise<T> => {
    const identityGeneration = identityGenerationRef.current;
    const requested = entryControlEpochRef.current;
    try {
      return await request(requested);
    } catch (error) {
      const current = currentControlEpochFromConflict(error);
      if (current === null || identityGenerationRef.current !== identityGeneration) throw error;
      const next = Math.max(current, entryControlEpochRef.current ?? 0);
      if (next <= (requested ?? 0)) throw error;
      entryControlEpochRef.current = next;
      return request(next);
    }
  }, []);

  // Phase 04 commit layer refs (declared before the identity-reset effect
  // so the reset can clear them). dataRef mirrors committed data and
  // stateRef mirrors runner state, letting post-await commits compute the
  // route decision from the pre-commit snapshot without adding state/data
  // to callback deps. phaseRef mirrors state.phase for the stable poll
  // loop; the key refs dedupe idempotent reconciler dispatches (StrictMode
  // double-invoke + in-flight poll races).
  const dataRef = useRef<AssessmentDeliveryBootstrap | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const phaseRef = useRef(state.phase);
  phaseRef.current = state.phase;
  const pollReconcileKeyRef = useRef<string | null>(null);
  const safetyReconcileKeyRef = useRef<string | null>(null);
  const reconcileGuardKeyRef = useRef<string | null>(null);
  // SAT-005: module-response hydration for a startModule commit. Stored in a
  // ref because hydrateModuleResponses changes with visibleDrafts/state and
  // must not destabilize the commit layer's identity (bootstrap/poll deps).
  const refreshFlightRef = useRef<SatRefreshFlight | null>(null);
  const hydrateModuleResponsesRef = useRef<
    ((payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => void) | null
  >(null);

  useEffect(() => {
    setData(null);
    setResult(null);
    setError(null);
    setIsSubmitting(false);
    setIsStarting(false);
    setExpiredEntryModuleId(null);
    setTimeoutTransitionStarted(false);
    setTimeoutTransitionKey(null);
    setAnswersRecorded(false);
    timeoutTransitionKeyRef.current = null;
    dataRef.current = null;
    entryAuthorizedAtRef.current = null;
    reportedAnswerableModulesRef.current.clear();
    // A rotated identity must not inherit the previous attempt's finalization
    // claim (the revision key already scopes by attempt, this keeps the
    // in-flight slot clean too).
    finalizationGateRef.current.reset();
    dispatch({ type: "recover", state: createSatRunnerState(scheduleId, candidateId) });
    // Phase 04: clear the commit-layer dedupe refs on identity rotation so a
    // new identity never inherits the previous identity's skip/reconciler keys.
    pollReconcileKeyRef.current = null;
    safetyReconcileKeyRef.current = null;
    reconcileGuardKeyRef.current = null;
  }, [attemptId, candidateId, identityKey, scheduleId]);

  useEffect(() => {
    // Writer identity is browser-owned. A server attempt projection can carry
    // the active writer's id, but using it as a fallback here would let a
    // fresh device impersonate that writer before lease checks run.
    configureSatDeliveryAttempt(
      scheduleId,
      attemptId,
      candidateId,
    );
  }, [attemptId, attemptSnapshot?.integrity?.clientSessionId, attemptSnapshot?.recovery?.clientSessionId, candidateId, scheduleId]);

  const handleSavedRevision = useCallback((questionId: string, revision: number) => {
    dispatch({ type: "responseSaved", questionId, revision });
  }, []);

  const persistence = useSatResponsePersistence({
    scheduleId,
    attemptId,
    gateway: satDeliveryGateway,
    onSavedRevision: handleSavedRevision,
    leaseEpoch,
    controlEpoch,
    credentialAttempt: attemptSnapshot,
  });
  const persistenceRef = useRef(persistence);
  persistenceRef.current = persistence;
  const flushBeforeNavigation = useCallback(() => {
    void persistenceRef.current.flush().catch(() => undefined);
  }, []);
  const hydrateBootstrap = persistence.hydrateBootstrap;

  // Identity the pure route table needs for a result-carrying payload;
  // memoized so the commit layer's identity does not churn with renders.
  const commitIdentity = useMemo(
    () => ({ scheduleId, candidateId }),
    [candidateId, scheduleId]
  );

  // Phase 04 commit layer (C1 atomic data+phase rule): the single entry
  // point every post-await payload funnels through. It returns whether the
  // payload was accepted (boolean; 304 stays null at the refresh layer) and
  // runs setData + the at-most-one phase dispatch in the same synchronous
  // tick so React 18+ batches them into one render. The hint selects the
  // route decision; startModule hints commit data here and dispatch the route
  // in the same tick (see startPendingModule below).
  const acceptPayloadAndRoute = useCallback(
    (
      payload: AssessmentDeliveryBootstrap,
      hint: SatCommitHint = { kind: "poll" },
    ): boolean => {
      if (
        identityGenerationRef.current !== renderIdentityGeneration ||
        payload.scheduleId !== scheduleId ||
        payload.attempt.id !== attemptId
      ) {
        return false;
      }
      // Stale-bootstrap guard: never let an older payload clobber newer
      // state — compare the timing runtime revision and drop regressions.
      const current = dataRef.current;
      const incomingRevision = payload.timing?.runtimeRevision ?? 0;
      const currentRevision = current?.timing?.runtimeRevision ?? 0;
      if (incomingRevision < currentRevision) return false;
      // Stale-bootstrap guard, attempt scope: the runtime revision is
      // schedule-wide, so it cannot order two payloads that differ only in
      // module-attempt / break rows (the personal-timing handoff). Per-row
      // revisions can, and do, order them.
      if (current && regressesAttemptState(current, payload)) return false;
      // Phase 04 C3 poll-skip: identical polls are no-ops — zero state
      // writes (no setData, no snapshotReceivedAt, no clock recompute).
      // Clock-only drift past tolerance skips routing and result work, but the
      // new server timestamp must keep its own receipt timestamp.
      if (current && isEquivalentBootstrap(current, payload)) {
        // SAT-005: an unchanged projection still needs the route decision for
        // mutation responses — a poll may have committed the server's advance
        // first, and skipping the decision would strand the runner. Data
        // writes stay skipped; only the phase action and hydration run.
        if (hint.kind === "startModule") {
          const action = decideSatCommitRoute(stateRef.current, current, hint, commitIdentity);
          if (action) dispatch(action);
          if (action?.type === "routeToModule") {
            const activeModule = moduleForAttempt(current, findActiveAttempt(current));
            if (activeModule) hydrateModuleResponsesRef.current?.(current, activeModule);
          }
          hydrateBootstrap(current);
          return true;
        }
        return false;
      }
      if (
        current &&
        current.versionId === payload.versionId &&
        current.timing.runtimeRevision === payload.timing?.runtimeRevision &&
        current.attempt.id === payload.attempt.id &&
        payload.serverNow !== current.serverNow
      ) {
        const prevNow = Date.parse(current.serverNow);
        const nextNow = Date.parse(payload.serverNow);
        const clockOnly =
          Number.isFinite(prevNow) &&
          Number.isFinite(nextNow) &&
          Math.abs(nextNow - prevNow) > SERVER_NOW_SKIP_TOLERANCE_MS &&
          isEquivalentBootstrap(
            { ...current, serverNow: payload.serverNow },
            payload,
          );
        if (clockOnly) {
          const timing = mergeAuthoritativeTiming(current.timing, payload.timing);
          const merged =
            timing === payload.timing ? payload : { ...payload, timing };
          dataRef.current = merged;
          setData(merged);
          setSnapshotReceivedAt(Date.now());
          return true;
        }
      }
      const timing = mergeAuthoritativeTiming(current?.timing ?? null, payload.timing);
      const merged = timing === payload.timing ? payload : { ...payload, timing };
      const preState = stateRef.current;
      dataRef.current = merged;
      setData(merged);
      // The timestamp and its receipt always advance together on accepted
      // payloads; equivalent polls above preserve both.
      setSnapshotReceivedAt(Date.now());
      setResult(payload.result);
      setError(null);
      hydrateBootstrap(merged);
      const action = decideSatCommitRoute(preState, merged, hint, commitIdentity);
      if (action) dispatch(action);
      if (hint.kind === "startModule" && action?.type === "routeToModule") {
        const activeModule = moduleForAttempt(merged, findActiveAttempt(merged));
        if (activeModule) hydrateModuleResponsesRef.current?.(merged, activeModule);
      }
      return true;
    },
    [
      attemptId,
      commitIdentity,
      hydrateBootstrap,
      renderIdentityGeneration,
      scheduleId,
    ]
  );

  // Phase 04 test seam (no prod callers): exposes the atomic commit path so
  // convergence tests can drive poll-hint commits deterministically without
  // waiting on the wall-clock poll loop.
  const commitForTest = useCallback(
    (payload: AssessmentDeliveryBootstrap): boolean =>
      acceptPayloadAndRoute(payload, { kind: "poll" }),
    [acceptPayloadAndRoute]
  );

  const refresh = useCallback(
    (
      surfaceError = false,
      /**
       * Transport-outcome probe. `refresh` resolves for a failed fetch (every
       * other caller, including `void refresh(...)`, depends on that), so the
       * recovery loop cannot infer success from the resolution: poll failures
       * have to be reported out of band or the backoff never engages.
       */
      onTransportOutcome?: SatRefreshOutcomeCallback,
    ): Promise<AssessmentDeliveryBootstrap | null> => {
      const flightKey = `${identityKey}:${renderIdentityGeneration}`;
      const existing = refreshFlightRef.current;
      if (existing?.key === flightKey) {
        const batch = existing.followUp ?? {
          surfaceError: false,
          outcomeCallbacks: [],
        };
        if (!existing.followUp) existing.followUp = batch;
        batch.surfaceError ||= surfaceError;
        if (onTransportOutcome) batch.outcomeCallbacks.push(onTransportOutcome);
        emitStudentObservabilityMetric("sat_lifecycle_refresh_coalesced", {
          reason: existing.followUpStarted ? "active_follow_up" : "queued_follow_up",
        });
        return existing.promise;
      }

      const flight: SatRefreshFlight = {
        key: flightKey,
        first: {
          surfaceError,
          outcomeCallbacks: onTransportOutcome ? [onTransportOutcome] : [],
        },
        followUp: null,
        followUpStarted: false,
        promise: Promise.resolve(null),
      };
      refreshFlightRef.current = flight;

      const runBatch = async (batch: SatRefreshBatch): Promise<AssessmentDeliveryBootstrap | null> => {
        const reportTransportOutcome = (ok: boolean, retryAfterMs?: number) => {
          for (const callback of batch.outcomeCallbacks) callback(ok, retryAfterMs);
        };
        try {
        // Unconditional read: the bootstrap payload is LIVE attempt state
        // (module attempts, the adaptive route, responses, timers, result), so
        // there is no attempt-state validator to send. A version-scoped
        // If-None-Match answered 304 soon after Module 1 ended — the published
        // exam version had not moved even though the server had just routed the
        // candidate to a different Module 2 — and the runner kept the stale
        // module. Equivalent-payload skipping stays client-side
        // (isEquivalentBootstrap), where it cannot hide a server-side routing
        // decision.
        //
        // Recovery polling prefers the mutable-only state endpoint (no
        // immutable question tree or answer projection retransmit). When state reveals a module
        // attempt for a module absent from the retained sections (adaptive
        // routing just seeded a branch), fall back to a full bootstrap to
        // learn its sections/content. The state endpoint remains the cheap
        // entry-state recovery read as well.
        const current = dataRef.current;
        let payload: AssessmentDeliveryBootstrap;
        if (current && satDeliveryGateway.state) {
          const state = await satDeliveryGateway.state(scheduleId, attemptId);
          const known = new Map(current.sections.flatMap((section) => section.modules.map((module) => [module.id, module] as const)));
          // Full bootstrap only when the retained tree cannot render the
          // attempt: a routed module new to this browser, or a module retained
          // as a content-withheld stub whose clock has since started (the
          // server's auto-start backstop fired before this browser started it).
          const needsSections = state.attempt.moduleAttempts.some((item) => {
            const module = known.get(item.moduleId);
            return !module || (module.contentWithheld === true && item.state !== "not_started");
          });
          payload = needsSections
            ? await satDeliveryGateway.bootstrap(scheduleId, attemptId)
            : (() => {
                // Lifecycle reads intentionally omit response rows. Keep the
                // latest in-memory answer projection while replacing mutable
                // module/timer facts; a slow poll must not erase newer local UI
                // state that was committed while the request was in flight.
                const retained = dataRef.current ?? current;
                return {
                  ...state,
                  sections: retained.sections,
                  attempt: {
                    ...state.attempt,
                    responses: retained.attempt.responses,
                  },
                };
              })();
        } else {
          payload = await satDeliveryGateway.bootstrap(scheduleId, attemptId);
        }
        reportTransportOutcome(true);
        // Phase 04: poll-hint commit — stale and equivalent payloads surface
        // as null (no-change).
        return acceptPayloadAndRoute(payload, { kind: "poll" }) ? payload : null;
      } catch (loadError) {
        reportTransportOutcome(false, retryAfterMsFromError(loadError));
        if (batch.surfaceError && identityGenerationRef.current === renderIdentityGeneration) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load the SAT attempt."
          );
        }
        return null;
        }
      };

      flight.promise = Promise.resolve()
        .then(async () => {
          let latest = await runBatch(flight.first);
          if (flight.followUp) {
            flight.followUpStarted = true;
            const followUpResult = await runBatch(flight.followUp);
            latest = followUpResult ?? latest;
          }
          return latest;
        })
        .finally(() => {
          if (refreshFlightRef.current === flight) refreshFlightRef.current = null;
        });

      return flight.promise;
    },
    [acceptPayloadAndRoute, attemptId, identityKey, renderIdentityGeneration, scheduleId]
  );

  /**
   * Module close at expiry (docs/sat-m1-m2-handoff-plan.md, Phase 3). Send the
   * module's remaining answers, then confirm the final set so the server
   * scores and routes now instead of waiting out its close window; the close
   * answer carries the routed follow-up module, so no state/bootstrap read is
   * needed. Every refusal has a bounded answer (classifySatCloseRejection).
   * When closing cannot succeed, the server's close window routes the module
   * and the short, jittered reads below discover it before the steady poll.
   */
  const closeTimedOutModule = useCallback(
    async (generation: number, moduleId: string, moduleAttemptId: string): Promise<void> => {
      const live = () => identityGenerationRef.current === generation;
      const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
      const closeModule = satDeliveryGateway.closeModule;
      const closeId = globalThis.crypto?.randomUUID?.() ?? `close-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const initialSnapshot = dataRef.current;
      const recoveryPolicy = initialSnapshot?.satDeliveryPolicy?.version === "sat_recovery_v1"
        ? initialSnapshot.satDeliveryPolicy
        : null;
      const recoveryClose = recoveryPolicy !== null;
      const recoveryWindowMs = recoveryPolicy ? recoveryPolicy.recoverySeconds * 1_000 : 0;
      const workDeadlineAt = initialSnapshot?.attempt.moduleAttempts.find((item) => item.id === moduleAttemptId)?.deadlineAt;
      const workDeadlineMs = workDeadlineAt ? Date.parse(workDeadlineAt) : Number.NaN;
      const serverClockOffsetMs = satClockOffsetMs(
        initialSnapshot?.serverNow ?? initialSnapshot?.timing.serverNow ?? null,
        snapshotReceivedAt,
      );
      // The browser uses the same deadline anchor as the server for its retry
      // bound; the server still makes the final admission decision with DB time.
      const recoveryDeadline = Number.isFinite(workDeadlineMs)
        ? workDeadlineMs + recoveryWindowMs - serverClockOffsetMs
        : Date.now() + recoveryWindowMs;
      const giveUpAt = recoveryClose ? recoveryDeadline : Date.now() + SAT_CLOSE_BUDGET_MS;
      let retries = 0;
      let preparedClose: Awaited<ReturnType<NonNullable<typeof persistenceRef.current.prepareScopeClose>>> | null = null;
      if (recoveryClose) {
        persistenceRef.current.freezeScope?.(moduleAttemptId);
        try {
          preparedClose = await persistenceRef.current.prepareScopeClose?.(moduleAttemptId, closeId) ?? null;
        } catch {
          // Keep the answer scope frozen even when this device cannot safely
          // prepare its recovery envelope. A retry can reuse the local draft.
        }
      } else {
        await persistenceRef.current.flush().catch(() => undefined);
      }
      if (recoveryClose && live()) {
        // Spread synchronized classroom deadlines so every browser does not
        // contend for the close path in the same instant.
        await waitForCloseRetry(Math.floor(Math.random() * 2_000), false);
      }
      while (closeModule && live() && Date.now() < giveUpAt) {
        if (recoveryClose && window.navigator.onLine === false) {
          await waitForCloseRetry(
            Math.min(SAT_RECOVERY_CLOSE_OFFLINE_WAIT_MS, Math.max(0, giveUpAt - Date.now())),
            true,
          );
          if (!live() || Date.now() >= giveUpAt) break;
        }
        try {
          if (recoveryClose && preparedClose === null) {
            preparedClose = await persistenceRef.current.prepareScopeClose?.(moduleAttemptId, closeId) ?? null;
            if (preparedClose === null) throw new Error("SAT recovery envelope is unavailable.");
          }
          let ack: Awaited<ReturnType<NonNullable<typeof closeModule>>> | null = null;
          if (!preparedClose) {
            ack = await closeModule(scheduleId, attemptId, {
              moduleId,
              moduleAttemptId,
              closeId,
              answers: await persistenceRef.current.closeManifest?.(moduleAttemptId) ?? [],
            });
          } else {
            const closeIdentity = {
              moduleId,
              moduleAttemptId,
              closeId: preparedClose.closeId,
              answers: preparedClose.manifest,
              protocol: "sat_recovery_v1" as const,
              leaseEpoch: preparedClose.leaseEpoch,
              controlEpoch: preparedClose.controlEpoch,
            };
            const atomicRequest = {
              ...closeIdentity,
              finalCommands: preparedClose.finalCommands,
            };
            const atomicBytes = new TextEncoder().encode(JSON.stringify(atomicRequest)).byteLength;
            if (atomicBytes <= SAT_CLOSE_CHUNK_BODY_BUDGET_BYTES) {
              ack = await closeModule(scheduleId, attemptId, atomicRequest);
            } else {
              const settledRequest = { ...closeIdentity, finalCommands: [] };
              let alreadySettled = false;
              try {
                // A lost close reply is discovered before chunk replay; a settled
                // boundary no longer accepts chunks.
                ack = await closeModule(scheduleId, attemptId, settledRequest);
                alreadySettled = true;
              } catch (probeError) {
                if (classifySatCloseRejection(probeError).kind !== "flush") throw probeError;
              }
              if (!alreadySettled) {
                const registerCloseIntent = satDeliveryGateway.registerCloseIntent;
                if (!registerCloseIntent) throw new Error("This session cannot safely recover a large frozen answer set.");
                const intentRequest: AssessmentModuleCloseIntentRequest = {
                  protocol: "sat_recovery_v1",
                  moduleId,
                  moduleAttemptId,
                  registrationId: preparedClose.closeId,
                  leaseEpoch: preparedClose.leaseEpoch,
                  controlEpoch: preparedClose.controlEpoch,
                  answers: preparedClose.manifest,
                };
                const registration = await registerCloseIntent(scheduleId, attemptId, intentRequest);
                if (registration.manifestHash !== preparedClose.manifestHash ||
                    registration.registrationId !== preparedClose.closeId ||
                    registration.moduleAttemptId !== moduleAttemptId) {
                  throw new Error("The server registered a different SAT answer frontier.");
                }
                const chunks = splitFrozenCloseCommands(preparedClose);
                const uploadChunk = persistenceRef.current.uploadScopeCloseChunk;
                if (chunks.length > 0 && !uploadChunk) {
                  throw new Error("This device cannot safely upload the registered SAT answer frontier.");
                }
                for (const chunk of chunks) {
                  await uploadChunk!(moduleAttemptId, preparedClose.closeId, preparedClose.manifestHash, chunk);
                }
                ack = await closeModule(scheduleId, attemptId, settledRequest);
              }
            }
          }
          if (!ack) throw new Error("The SAT close did not return a completion receipt.");
          if (!live()) return;
          if (preparedClose) {
            await persistenceRef.current.acknowledgeScopeClose?.(
              moduleAttemptId,
              preparedClose.closeId,
              ack.finalAcks ?? [],
            );
          }
          const base = dataRef.current;
          const merged = base ? applyCloseAck(base, ack) : null;
          if (!merged) break;
          acceptPayloadAndRoute(merged, { kind: "poll" });
          emitStudentObservabilityMetric("sat_module_close", {
            scheduleId,
            attemptId,
            moduleId,
            routeBasis: ack.routeBasis ?? null,
            alreadyClosed: ack.alreadyClosed,
            retries,
          });
          return;
        } catch (closeError) {
          if (!live()) return;
          const next = classifySatCloseRejection(closeError);
          if (next.kind === "stop") break;
          retries += 1;
          if (recoveryClose) {
            const exponent = Math.min(Math.max(0, retries - 1), 4);
            const backoffCap = Math.min(SAT_RECOVERY_CLOSE_MAX_BACKOFF_MS, 1_000 * 2 ** exponent);
            const jitteredBackoff = Math.floor(backoffCap * (0.75 + Math.random() * 0.5));
            const retryAfterMs = next.kind === "backoff" ? next.retryAfterMs : undefined;
            const retryDelay = next.kind === "wait"
              ? next.delayMs
              : Math.max(jitteredBackoff, retryAfterMs ?? 0);
            await waitForCloseRetry(retryDelay, retryAfterMs === undefined);
          } else {
            await pause(
              next.kind === "wait"
                ? next.delayMs
                : next.kind === "flush"
                  ? 300
                  : 500 + Math.floor(Math.random() * 500),
            );
          }
          if (!live()) return;
          if (!recoveryClose) await persistenceRef.current.flush().catch(() => undefined);
        }
      }
      for (let read = 0; read < SAT_CLOSE_FALLBACK_READS && live(); read += 1) {
        await refresh(read === 0);
        const moduleAttempt = dataRef.current?.attempt.moduleAttempts.find((item) => item.id === moduleAttemptId);
        if (!moduleAttempt || matchesFinalModuleState(moduleAttempt.state)) return;
        await pause(Math.min(3_000, 1_000 * (read + 1)) + Math.floor(Math.random() * 500));
      }
    },
    [acceptPayloadAndRoute, attemptId, refresh, scheduleId, snapshotReceivedAt],
  );

  const resolveRecovery = useCallback(
    async (request: SATRecoveryResolutionRequest): Promise<SATRecoveryResolutionReceipt> => {
      const receipt = await satDeliveryGateway.resolveRecovery(scheduleId, attemptId, request);
      await refresh(false);
      return receipt;
    },
    [attemptId, refresh, scheduleId],
  );

  // Phase 02 bootstrap effect (singleflight per identity+version): the only
  // new-import is the pure seed matcher (no React, no fetch). Rules: one
  // network call per (identityKey, staticVersionId); superseded-generation
  // failures silent; initial failure still setError so error && !data stays
  // reachable; success path identical to before (acceptPayloadAndRoute
  // bootstrap-hint + its internal bootstrapLoaded dispatch, committed
  // atomically).
  // StrictMode note: React mounts, unmounts (cleanup sets cancelled = true
  // for that run only), then re-runs the effect. The second run JOINS the
  // still-in-flight shared promise (same map key) instead of firing a second
  // gateway call — so StrictMode double-effects cost one network call. Parent
  // re-renders without dep changes do not re-run the effect at all; only an
  // identity rotation or a seed staticVersionId change starts a new request.
  const bootstrapSeedRef = useRef(bootstrapSeed);
  bootstrapSeedRef.current = bootstrapSeed;
  // Singleflight per (identity, version): StrictMode double-invoke + parent
  // re-render collapse here. Keyed on identityKey + seed staticVersionId so a
  // republish refires exactly once while churn at equal revision does not.
  // NOTE: the promise is stored WITHOUT a .then tap attached at set time —
  // taps attach per-effect-run below — so the map never triggers
  // unhandledrejection on failure paths.
  const bootstrapInflightRef = useRef(
    new Map<string, Promise<AssessmentDeliveryBootstrap>>(),
  );

  useEffect(() => {
    const generationAtCall = identityGenerationRef.current;
    // Validate the seed belongs to THIS identity; a stale seed (identity
    // rotated while the parent re-rendered) must never scope the fetch.
    const seed = bootstrapSeedRef.current;
    const seedOk = seedMatchesIdentity(seed, { scheduleId, attemptId, candidateId });
    const requestKey = identityKey + "::" + (seedOk ? (seed?.staticVersionId ?? "") : "");

    let cancelled = false;
    const run = bootstrapInflightRef.current.get(requestKey)
      ?? satDeliveryGateway.bootstrap(scheduleId, attemptId);
    bootstrapInflightRef.current.set(requestKey, run);

    void run.then(
      (payload) => {
        if (bootstrapInflightRef.current.get(requestKey) === run) {
          bootstrapInflightRef.current.delete(requestKey);
        }
        if (cancelled || identityGenerationRef.current !== generationAtCall) return; // superseded: silent
        // Phase 04 atomic bootstrap: data + bootstrapLoaded commit in one
        // tick (no intermediate new-data/old-phase frame); the commit
        // dispatches bootstrapLoaded itself when pre-state is loading.
        acceptPayloadAndRoute(payload, { kind: "bootstrap" });
      },
      (loadError: unknown) => {
        if (bootstrapInflightRef.current.get(requestKey) === run) {
          bootstrapInflightRef.current.delete(requestKey);
        }
        if (cancelled || identityGenerationRef.current !== generationAtCall) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load the SAT attempt.");
      },
    );
    return () => {
      cancelled = true;
    };
    // Deps: identityKey (covers schedule/attempt/candidate rotation) + seed
    // staticVersionId (republish rebootstrap) — NOT the whole seed object (it
    // churns with runtimeSnapshot). candidateId is read via identityKey/
    // seed-match only (kept out of deps to avoid refire on unrelated prop
    // churn). acceptPayloadAndRoute stays: stable per identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptPayloadAndRoute, identityKey, scheduleId, attemptId, bootstrapSeed?.staticVersionId]);

  // Recovery cadence now uses the mutable-only state endpoint. The immutable
  // question tree is retained from cold start and never retransmitted here.
  const pollFailuresRef = useRef(0);
  const retryAfterMsRef = useRef<number | null>(null);
  useEffect(() => {
    if (phaseRef.current === "complete") return;
    let stopped = false;
    let timer = 0;
    let onOnline: (() => void) | null = null;
    const recordTransportOutcome = (ok: boolean, retryAfterMs?: number) => {
      pollFailuresRef.current = ok ? 0 : pollFailuresRef.current + 1;
      retryAfterMsRef.current = ok ? null : retryAfterMs ?? null;
    };
    const schedule = () => {
      if (!stopped) timer = window.setTimeout(tick, satPollDelayMs({
        liveSocketConnected,
        failures: pollFailuresRef.current,
        random: Math.random(),
        ...(retryAfterMsRef.current !== null ? { retryAfterMs: retryAfterMsRef.current } : {}),
      }));
    };
    const tick = () => {
      if (stopped || phaseRef.current === "complete") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        onOnline = () => {
          pollFailuresRef.current = 0;
          retryAfterMsRef.current = null;
          void refresh(false, recordTransportOutcome).finally(schedule);
        };
        window.addEventListener("online", onOnline, { once: true });
        return;
      }
      void refresh(false, recordTransportOutcome)
        .catch(() => recordTransportOutcome(false))
        .finally(() => { if (!stopped) schedule(); });
    };
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (onOnline) window.removeEventListener("online", onOnline);
    };
  }, [liveSocketConnected, refresh]);

  // A SAT personal-timing attempt still needs this refresh to observe the
  // proctor's room start; its module clock remains attempt-owned in the payload.
  useEffect(() => {
    if (
      !runtimeSnapshot?.revision ||
      (!isCohortTimingModel(data?.timing.timingModel) &&
        !isSatPersonalTimingModel(data?.timing.timingModel))
    ) {
      return;
    }
    void refresh(false);
  }, [data?.timing.timingModel, refresh, runtimeSnapshot?.revision]);

  useEffect(() => {
    if (attemptUpdateToken <= 0) return;
    void refresh(false);
  }, [attemptUpdateToken, refresh]);

  // Integrity is active only while the student may actually answer: waiting on
  // directions, a break, or a completed attempt is not a tab switch.
  const satIntegrity = useSatIntegrityControl({
    scheduleId,
    attemptId,
    expectedDeviceFingerprintHash: data?.deviceFingerprintHash ?? null,
    enforceInteractionGuards: state.phase === "module" || state.phase === "review",
  });

  const hydrateModuleResponses = useCallback(
    (payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => {
      const questionIds = new Set(module.questions.map((question) => question.examQuestionId));
      for (const response of payload.attempt.responses) {
        if (!questionIds.has(response.examQuestionId)) continue;
        const durableDraft = persistence.visibleDrafts[response.examQuestionId];
        if (durableDraft) {
          dispatch({
            type: "hydrateResponse",
            revision: response.revision,
            response: durableDraft,
          });
          continue;
        }
        const currentRev =
          state.phase === "module" || state.phase === "review"
            ? state.responseRevisions[response.examQuestionId]
            : undefined;
        if (currentRev !== undefined && currentRev >= response.revision) continue;
        const answer =
          typeof response.response === "string" || typeof response.response === "number"
            ? String(response.response)
            : "";
        dispatch({
          type: "hydrateResponse",
          revision: response.revision,
          response: {
            questionId: response.examQuestionId,
            answer,
            markedForReview: response.markedForReview,
            // Optional-field defaults (hydration contract): a missing or null
            // projections field must hydrate as empty, never throw.
            eliminatedOptionIds: Array.isArray(response.eliminatedOptions) ? [...response.eliminatedOptions] : [],
            annotations: normalizeSatAnnotations(response.annotations),
          },
        });
      }
    },
    [persistence.visibleDrafts, state]
  );

  hydrateModuleResponsesRef.current = hydrateModuleResponses;

  const startModuleFrom = useCallback(
    (payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => {
      // SAT-005: the same pure action the unified commit layer dispatches.
      const action = startModuleRouteAction(payload, module);
      if (!action) return;
      dispatch(action);
      hydrateModuleResponses(payload, module);
    },
    [hydrateModuleResponses]
  );

  // Phase 04 commit-first / reconciler-second: the primary paths commit
  // data+phase atomically, so this route reconciliation is a safety net for
  // externally-driven data changes (e.g. a resumed page whose server module
  // already started, or a break whose next module opened in another tab). Dedupe-keyed
  // so StrictMode double-invoke cannot double-dispatch; at most one action
  // per (versionId, runtimeRevision, phase, active module id).
  useEffect(() => {
    if (!data || (state.phase !== "directions" && state.phase !== "break")) return;
    const activeAttempt = findActiveAttempt(data);
    const activeModule = moduleForAttempt(data, activeAttempt);
    if (!activeAttempt?.startedAt || !activeModule) return;
    // A withheld stub has no questions yet; the refresh that observed the
    // start fetches the content first.
    if (activeModule.contentWithheld) return;
    const key = `${data.versionId}:${data.timing.runtimeRevision}:${state.phase}:${activeModule.id}`;
    if (safetyReconcileKeyRef.current === key) return;
    safetyReconcileKeyRef.current = key;
    startModuleFrom(data, activeModule);
  }, [data, startModuleFrom, state.phase]);

  /**
   * Everything this attempt kept on THIS device, released when the attempt
   * ends: reading preferences (which carry its automatic zoom decision and the
   * display choices that go with them), cached calculator workspaces, the
   * eliminator switch, and the Notes column's open pane.
   *
   * One helper, because the end of an attempt arrives down more than one path
   * (termination, a committed result, a successful finalization retry) and a
   * client-side record that only some of them release is a record that comes
   * back on the one that did not.
   */
  const clearAttemptClientState = useCallback(() => {
    clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
    clearSatReadingPreferences(scheduleId, attemptId);
    clearSatEliminatorMode(scheduleId, attemptId);
    clearSatNotesColumn(scheduleId, attemptId);
  }, [attemptId, scheduleId]);

  useEffect(() => {
    if (!data) return;
    const terminalWithoutResult =
      data.proctorStatus === "terminated" ||
      data.scheduleRuntimeStatus === "completed" ||
      data.scheduleRuntimeStatus === "cancelled";
    if (!terminalWithoutResult) return;
    clearAttemptClientState();
  }, [clearAttemptClientState, data]);

  // Phase 04: terminal-result commit path. Poll commits carrying `result`
  // recover to complete synchronously; this effect stays as the safety net
  // for externally-driven data changes, dedupe-keyed on (versionId, result).
  useEffect(() => {
    if (!data?.result || state.phase === "complete") return;
    const key = `terminal:${data.versionId}:${data.result.id}`;
    if (reconcileGuardKeyRef.current === key) return;
    reconcileGuardKeyRef.current = key;
    clearAttemptClientState();
    setResult(data.result);
    dispatch({
      type: "recover",
      state: {
        phase: "complete",
        scheduleId,
        candidateId,
        assessmentId: data.versionId,
        resultId: data.result.id,
      },
    });
  }, [clearAttemptClientState, data, scheduleId, state.phase]);

  const runtimeTiming = useMemo<AssessmentTimingSnapshot | null>(() => {
    if (!data || !runtimeSnapshot) return null;
    const timingModel = data.timing.timingModel;
    if (!isCohortTimingModel(timingModel)) return null;
    if (runtimeSnapshot.timingModel !== timingModel) return null;
    const stageKey = runtimeSnapshot.currentSectionKey as string | null;
    const stageStatus =
      runtimeSnapshot.sections.find(
        (section) => section.sectionKey === runtimeSnapshot.currentSectionKey
      )?.status ?? null;
    return {
      authority: "cohort_runtime",
      timingModel,
      stageKey,
      stageStatus,
      serverNow: runtimeSnapshot.serverNow ?? data.timing.serverNow,
      deadlineAt: runtimeSnapshot.currentSectionDeadlineAt ?? null,
      remainingSeconds: runtimeSnapshot.currentSectionRemainingSeconds,
      // The between-sections window is authoritative on both projections;
      // fall back to the bootstrap values when the runtime snapshot omits them.
      nextSectionStartAt:
        runtimeSnapshot.nextSectionStartAt !== undefined
          ? runtimeSnapshot.nextSectionStartAt
          : data.timing.nextSectionStartAt ?? null,
      waitingForNextSection:
        runtimeSnapshot.waitingForNextSection ?? data.timing.waitingForNextSection ?? false,
      runtimeRevision: runtimeSnapshot.revision ?? data.timing.runtimeRevision,
    };
  }, [data, runtimeSnapshot]);
  const effectiveTiming = useMemo(
    () => (data ? mergeAuthoritativeTiming(data.timing, runtimeTiming ?? data.timing) : null),
    [data, runtimeTiming]
  );
  const runtimeServerNow = runtimeTiming?.serverNow ?? null;
  const runtimeTimingReceiptRef = useRef<{ serverNow: string | null; receivedAt: number }>({
    serverNow: null,
    receivedAt: 0,
  });
  if (runtimeServerNow !== null && runtimeServerNow !== runtimeTimingReceiptRef.current.serverNow) {
    runtimeTimingReceiptRef.current = { serverNow: runtimeServerNow, receivedAt: now };
  }
  const effectiveTimingReceivedAt =
    runtimeServerNow !== null && effectiveTiming?.serverNow === runtimeServerNow
      ? runtimeTimingReceiptRef.current.receivedAt || snapshotReceivedAt
      : snapshotReceivedAt;
  const serverClockOffsetMs = satClockOffsetMs(effectiveTiming?.serverNow ?? null, effectiveTimingReceivedAt);
  const authoritativeRemainingSeconds = resolveAuthoritativeRemainingSeconds({
    deadlineAt: effectiveTiming?.deadlineAt ?? null,
    clockOffsetMs: serverClockOffsetMs,
    fallbackSeconds: effectiveTiming?.remainingSeconds ?? 0,
    running: satSharedClockRunning({
      runtimeStatus: data?.scheduleRuntimeStatus,
      stageStatus: effectiveTiming?.stageStatus,
    }),
    nowMs: now,
  });

  const pendingModule = useMemo(() => (data ? findCurrentModule(data) : null), [data]);
  const pendingAttempt = useMemo(
    () => (data && pendingModule ? findAttemptForModule(data, pendingModule.id) : undefined),
    [data, pendingModule]
  );
  // Authored between-sections window (cohort models). The server's runtime
  // flag is the single gate — the window is open only while the active section
  // is complete and the next is not yet live — and nextSectionStartAt is its
  // countdown instant, so the break counts down to that instead of the
  // finished section's frozen 0:00.
  const waitingForNextSection = effectiveTiming?.waitingForNextSection ?? false;
  const nextSectionStartAt = waitingForNextSection
    ? effectiveTiming?.nextSectionStartAt ?? null
    : null;
  const nextSectionStartSeconds = resolveAuthoritativeRemainingSeconds({
    deadlineAt: nextSectionStartAt,
    clockOffsetMs: serverClockOffsetMs,
    fallbackSeconds: 0,
    running: Boolean(nextSectionStartAt) && data?.scheduleRuntimeStatus === "live",
    nowMs: now,
  });
  const personalBreak = satOpenPersonalBreak(effectiveTiming?.timingModel, data?.attempt.personalBreaks);
  const breakWindow = satBreakWindow({
    timingModel: effectiveTiming?.timingModel,
    personalBreak,
    serverNowMs: now + serverClockOffsetMs,
    sharedSeconds: data
      ? satBreakCountdownSeconds({
          timingModel: effectiveTiming?.timingModel,
          nextSectionStartAt,
          nextSectionStartSeconds,
          legacyBreakSeconds: breakRemainingSeconds(data, pendingAttempt, snapshotReceivedAt, now),
        })
      : 0,
  });
  const pendingBreakSeconds = breakWindow.seconds ?? 0;
  const pendingSection = data && pendingModule ? sectionForModule(data, pendingModule.id) : null;
  const sectionEntry = useSatSectionEntry(scheduleId, attemptId, pendingModule?.id ?? null,
    pendingSection?.sectionKey === "math" || pendingSection?.sectionKey === "reading-writing" ? pendingSection.sectionKey : null,
    satDeliveryGateway.sectionEntry);
  const pendingExpectedStageKey = satExpectedStageKey({
    timingModel: effectiveTiming?.timingModel,
    sectionKey: pendingSection?.sectionKey ?? null,
    adaptiveRole: pendingModule?.adaptiveRole ?? null,
  });
  const pendingStageReady = satStageReady({
    timingModel: effectiveTiming?.timingModel,
    stageKey: effectiveTiming?.stageKey ?? null,
    stageStatus: effectiveTiming?.stageStatus ?? null,
    runtimeStatus: data?.scheduleRuntimeStatus,
    expectedStageKey: pendingExpectedStageKey,
  });
  // Waiting for the scheduled end of the current section (the student finished
  // their module early while the shared clock is still running). Once the
  // server names the next section's start this window is over and the break
  // countdown above takes over.
  const pendingSectionWaitSeconds =
    data && effectiveTiming
      ? satSectionWaitSeconds({
          timingModel: effectiveTiming.timingModel,
          stageKey: effectiveTiming.stageKey,
          sectionKey: pendingSection?.sectionKey ?? null,
          runtimeStatus: data.scheduleRuntimeStatus,
          waitingForNextSection,          authoritativeSeconds: authoritativeRemainingSeconds,
        })
      : 0;

  // Keep the predecessor's timeout attribution for the module-advance metric.
  // Routing and automatic entry follow the server's selected next module.
  const previousModuleTimedOut = useMemo(
    () => (data && pendingModule ? previousModuleEndedByClock(data, pendingModule) : false),
    [data, pendingModule],
  );

  /**
   * Adopt the control epoch the server reported on a transition ack before the
   * payload is committed.
   *
   * The server bumps `student_attempts.control_epoch` inside the same
   * transaction that opens the module (`markProviderAttemptExamPhaseInTx`) and
   * then answers with the post-commit epoch read back by `entryStateBound`. The
   * client used to drop it: `applyEntryAck` merges the ack into a bootstrap
   * object that has no epoch field, and the parent's attempt projection only
   * catches up on its own poll cadence. The first answer sent in between rode
   * the pre-bump fence and was refused 409 CONTROL_EPOCH_STALE — a
   * fail-then-heal round trip on the one path every student takes.
   *
   * The decision table lives in `application/satEntryControlEpoch` and serves
   * the current single-operation startModule path for every timing model.
   * The legacy `enterModule` and `entry-state` endpoints have no client caller;
   * a future caller must pass its raw ack through this resolver. The engine
   * re-checks every guard (idle, monotonic, recovery,
   * conflict posture) and refuses while work is outstanding, so this can only
   * ever skip, never strand a draft.
   */
  const adoptEntryControlEpoch = useCallback(
    (
      response: AssessmentDeliveryBootstrap | AssessmentModuleEntryStateAck,
      source: string,
    ): void => {
      adoptEntryControlEpochFromAck(
        response,
        {
          scheduleId,
          attemptId,
          currentControlEpoch: entryControlEpochRef.current,
          adopt: (epoch, adoptionSource) => {
            entryControlEpochRef.current = epoch;
            persistenceRef.current.adoptControlEpoch?.(epoch, adoptionSource);
          },
          onSkipped: (reason, skippedSource) =>
            emitStudentObservabilityMetric("control_epoch_adopt_skipped", {
              reason,
              source: skippedSource,
              scheduleId,
              attemptId,
            }),
        },
        source,
      );
    },
    [attemptId, scheduleId],
  );

  const resolveEntryPayload = useCallback(
    async (
      base: AssessmentDeliveryBootstrap,
      response: AssessmentDeliveryBootstrap | AssessmentModuleEntryStateAck,
      /** Telemetry label for the entry path that produced this ack. */
      source: string,
    ): Promise<AssessmentDeliveryBootstrap> => {
      // Offer the startModule ack's post-commit control epoch to the engine
      // BEFORE the payload is merged or committed, so no answer can be accepted
      // under the pre-bump fence.
      adoptEntryControlEpoch(response, source);
      if (!isEntryAck(response)) return response;
      const merged = applyEntryAck(base, response);
      if (merged) return merged;
      return satDeliveryGateway.bootstrap(scheduleId, attemptId);
    },
    [adoptEntryControlEpoch, attemptId, scheduleId],
  );

  /**
   * Single-operation StartModule: one idempotent mutation that activates
   * immediately at DB time. The browser renders the exam on this response.
   * A lost response is safe to retry: already-active returns the same
   * authoritative state. Under the personal model it runs for the initial
   * Module 1 and for a routed module the server left waiting for this
   * browser (client_start handoff); other progression is server-driven.
   */
  const startPendingModule = useCallback(async (): Promise<SatEntryOutcome> => {
    if (!data || !pendingModule || isStarting || !sectionEntry.ready) return "noop";
    const generation = identityGenerationRef.current;
    if (entryAuthorizedAtRef.current?.moduleId !== pendingModule.id) {
      const previousDeadline = previousTimedOutModuleDeadlineAt(data, pendingModule);
      const transitionDeadlineAt = previousDeadline
        ? Date.parse(previousDeadline) - serverClockOffsetMs
        : Number.NaN;
      entryAuthorizedAtRef.current = {
        moduleId: pendingModule.id,
        at: Date.now(),
        ...(Number.isFinite(transitionDeadlineAt) ? { transitionDeadlineAt } : {}),
      };
    }
    setIsStarting(true);
    setError(null);
    try {
      // Capture the RAW start response before resolveEntryPayload merges it
      // into the bootstrap: the ack's control epoch is dropped by the merge.
      const startResponse = await withEntryControlEpoch((epoch) => satDeliveryGateway.startModule(scheduleId, attemptId, {
        moduleId: pendingModule.id,
        // Content travels with the start when this browser does not hold it:
        // the module is absent, or retained only as a withheld stub (its clock
        // starts in this same request).
        ...(data.sections.some((section) => section.modules.some((module) => module.id === pendingModule.id && !module.contentWithheld)) ? {} : { needContent: true as const }),
        ...controlEpochField(epoch),
      }));
      if (identityGenerationRef.current !== generation) return "noop";
      // Ordering is the guarantee: resolveEntryPayload offers the ack's epoch
      // before the payload is merged/committed, so no answer can be accepted
      // under the old fence.
      const payload = await resolveEntryPayload(data, startResponse, "module_start");
      if (identityGenerationRef.current !== generation) return "noop";
      if (payload.scheduleId !== scheduleId || payload.attempt.id !== attemptId) return "noop";
      // SAT-005: one monotonic commit path. The startModule hint commits the
      // data and dispatches the routeToModule action atomically; a stale or
      // otherwise rejected payload reports "noop" and stays retryable.
      if (!acceptPayloadAndRoute(payload, { kind: "startModule", moduleId: pendingModule.id })) {
        return "noop";
      }
      const committed = dataRef.current;
      const activeModule = committed
        ? moduleForAttempt(committed, findActiveAttempt(committed))
        : null;
      // A resolved call that did not open a module is not a completed entry:
      // report it retryable instead of burning the entry attempt.
      if (!activeModule) return "noop";
      // Module-advance fix (observability): this bug was invisible in
      // telemetry — a student stranded before Module 2 looked exactly like one
      // mid-module. One event per confirmed open makes "Module 1 timed out,
      // Module 2 never opened" a queryable funnel step.
      emitStudentObservabilityMetric("sat_module_advance", {
        reason: previousModuleTimedOut ? "timeout" : "server",
        sectionKey: pendingSection?.sectionKey ?? null,
        adaptiveRole: pendingModule.adaptiveRole,
      });
      return "opened";
    } catch (startError) {
      if (identityGenerationRef.current === generation) {
        if (isSatEntryWindowExpiredRejection(startError)) {
          setExpiredEntryModuleId(pendingModule.id);
          // The server commits the blocked boundary with this conflict. Read
          // its authoritative state now instead of waiting for steady polling.
          await refresh(false);
          return "expired";
        }
        // Phase 3: a conflict on entry means the server is still advancing the
        // section this module belongs to (SECTION_NOT_ACTIVE / RUNTIME_NOT_LIVE
        // at a transition). The attempt stays retryable, so say nothing and let
        // the next one land — a transition race is never a student error.
        //
        // SAT-007: entry must also tell writer supersession apart. A stale
        // control epoch or a durable-state disagreement is not a transition
        // either — the entry loop retries it — while losing the writer slot
        // needs the ownership instruction, not a silent retry forever.
        if (isWriterSupersededRejection(startError)) {
          setError(
            "This attempt is now active on another device. Your saved answers are safe — continue there, or choose \u201cContinue on this device\u201d to request a device change."
          );
        } else if (!isSectionClosingRejection(startError) && !isStaleConflictRejection(startError)) {
          setError(
            startError instanceof Error ? startError.message : "The SAT module could not be started."
          );
        }
      }
      return "failed";
    } finally {
      if (identityGenerationRef.current === generation) setIsStarting(false);
    }
  }, [
    acceptPayloadAndRoute,
    attemptId,
    data,
    isStarting,
    pendingModule,
    sectionEntry.ready,
    pendingSection,
    previousModuleTimedOut,
    refresh,
    resolveEntryPayload,
    scheduleId,
    serverClockOffsetMs,
    withEntryControlEpoch,
  ]);

  /**
   * SAT access-code start: one explicit submission redeems the session code
   * for THIS attempt and opens its first module at server time. Never retried
   * blindly — a refusal that does not prove "not started" is followed by an
   * authoritative read, and only that read decides what the form shows next.
   */
  const startWithCode = useCallback(async (rawCode: string): Promise<SatStartCodeOutcome> => {
    const code = normalizeStartCodeInput(rawCode);
    if (!code) {
      return { ok: false, refusal: classifyStartCodeError({ details: { reason: "START_CODE_FORMAT_INVALID" } }) };
    }
    if (!data || isStarting || !sectionEntry.ready) return { ok: false, refusal: null };
    const generation = identityGenerationRef.current;
    setIsStarting(true);
    setError(null);
    try {
      // A failed recovery read is not proof that the previous POST rolled
      // back. Before another explicit submission, recover state successfully.
      if (uncertainCodeStartGenerationRef.current === generation) {
        let recovered = false;
        const latest = await refresh(false, (ok) => { recovered = ok; });
        if (identityGenerationRef.current !== generation) return { ok: false, refusal: null };
        if (!recovered) return { ok: false, refusal: classifyStartCodeError(null) };
        uncertainCodeStartGenerationRef.current = null;
        const policy = (latest ?? dataRef.current)?.satStartPolicy;
        if (policy?.mode === "access_code" && policy.state === "started") return { ok: true, refusal: null };
        if (policy?.mode !== "access_code" || policy.state !== "code_required") {
          return { ok: false, refusal: classifyStartCodeError({ details: { reason: "START_WINDOW_CLOSED" } }) };
        }
      }
      const response = await withEntryControlEpoch((epoch) =>
        satDeliveryGateway.startWithCode(scheduleId, attemptId, { code, controlEpoch: epoch ?? 0 }));
      if (identityGenerationRef.current !== generation) return { ok: false, refusal: null };
      if (response.kind === "resume") {
        // Already started (another tab, or a lost response): resume the
        // authoritative current module/break, never the first module.
        acceptPayloadAndRoute(response.bootstrap, { kind: "poll" });
        return { ok: true, refusal: null };
      }
      const merged = await resolveEntryPayload(data, response.entry, "code_start");
      if (identityGenerationRef.current !== generation) return { ok: false, refusal: null };
      const startedPolicy = merged.satStartPolicy?.mode === "access_code"
        ? { ...merged.satStartPolicy, state: "started" as const }
        : merged.satStartPolicy ?? null;
      entryAuthorizedAtRef.current = { moduleId: response.entry.moduleId, at: Date.now() };
      acceptPayloadAndRoute({ ...merged, satStartPolicy: startedPolicy }, { kind: "startModule", moduleId: response.entry.moduleId });
      emitStudentObservabilityMetric("sat_code_start", { outcome: "started" });
      return { ok: true, refusal: null };
    } catch (startError) {
      if (identityGenerationRef.current !== generation) return { ok: false, refusal: null };
      const refusal = classifyStartCodeError(startError);
      emitStudentObservabilityMetric("sat_code_start", { outcome: refusal.kind });
      if (refusal.readStateFirst) {
        // The start may have committed: the authoritative read decides.
        let recovered = false;
        const latest = await refresh(false, (ok) => { recovered = ok; });
        if (identityGenerationRef.current !== generation) return { ok: false, refusal: null };
        uncertainCodeStartGenerationRef.current = recovered ? null : generation;
        const policy = (latest ?? dataRef.current)?.satStartPolicy;
        if (policy?.mode === "access_code" && policy.state === "started") {
          return { ok: true, refusal: null };
        }
      }
      return { ok: false, refusal };
    } finally {
      if (identityGenerationRef.current === generation) setIsStarting(false);
    }
  }, [acceptPayloadAndRoute, attemptId, data, isStarting, sectionEntry.ready, refresh, resolveEntryPayload, scheduleId, withEntryControlEpoch]);

  // Break lifecycle: the server creates the scheduled break pending at section
  // finalization; once the break surface is mounted and visible this browser
  // arms and confirms a server-issued future start (useSatBreakEntry), so the
  // student receives the full authored break. Break expiry then activates the
  // next-section Module 1 server-side.
  const [breakSurfaceMounted, setBreakSurfaceMounted] = useState(false);
  const [breakEndStalledKey, setBreakEndStalledKey] = useState<string | null>(null);
  const commitBreakPayload = useCallback(
    (payload: AssessmentDeliveryBootstrap) => {
      acceptPayloadAndRoute(payload, { kind: "poll" });
    },
    [acceptPayloadAndRoute],
  );
  const refreshBreakState = useCallback(() => refresh(false), [refresh]);
  const breakEntry = useSatBreakEntry({
    identity: identityKey,
    // A paused attempt or room never prepares: the server would refuse, and
    // resume brings a fresh projection.
    enabled:
      breakSurfaceMounted &&
      data?.scheduleRuntimeStatus === "live" &&
      data.proctorStatus !== "paused" &&
      !personalBreak?.pausedAt,
    personalBreak,
    serverClockOffsetMs,
    scheduleId,
    attemptId,
    gateway: satDeliveryGateway,
    withControlEpoch: withEntryControlEpoch,
    commit: commitBreakPayload,
    refresh: refreshBreakState,
  });

  // Phase 3 (client-forced break end): once the authoritative break has run
  // out, pull the advanced projection ourselves instead of waiting out the
  // parent's steady cadence. Throttled to the window above and to one pull per
  // revision, so a late advance cannot become a request storm.
  const breakEndPullRef = useRef<{ key: string; firedAt: number } | null>(null);
  const personalBreakEndPullRef = useRef<{ key: string; firedAt: number } | null>(null);
  // One owner for entry (Phase 2): the pure decision from
  // application/satEntry.ts plus the dedupe/retry/start in useSatModuleEntry.
  // The first module (the proctor's Start) and every later section (the end of
  // the authoritative break) run through this single path.
  const entryDecision = deriveSatEntryDecision({
    data,
    module: pendingModule,
    stageReady: pendingStageReady,
    breakSeconds: breakWindow.blocksEntry ? Math.max(1, pendingBreakSeconds) : 0,
    sectionWaitSeconds: pendingSectionWaitSeconds,
    phase: state.phase,
    explicitEntryRequired: data?.satDeliveryPolicy?.version === "sat_recovery_v1" &&
      Boolean(pendingModule) &&
      data.attempt.moduleAttempts.some((attempt) =>
        attempt.moduleId !== pendingModule?.id && matchesFinalModuleState(attempt.state),
      ),
  });
  const entryRequiresConfirmation = entryDecision.reason === "explicit-module-entry";

  // Client-started entry: the proctor's Start, cohort/legacy later modules,
  // and a personal routed module waiting for this browser (deriveSatEntryDecision
  // owns the rule). Transient failures keep the waiting room mounted and retry
  // with jitter behind it.
  useSatModuleEntry({
    identity: identityKey,
    enabled: sectionEntry.ready && (entryDecision.shouldStart || (
      sectionEntry.state?.state === "submitted" && sectionEntry.state.canStart && !isSatStartCodePending(data) &&
      sectionEntry.state.moduleId === pendingModule?.id && !breakWindow.blocksEntry && pendingSectionWaitSeconds <= 0
    )),
    entryKey: pendingModule ? `${attemptId}:${pendingModule.id}` : null,
    startModule: startPendingModule,
  });

  const finalizeAssessment = useCallback(
    (generation: number, assessmentId: string): Promise<AssessmentResult | null> =>
      finalizationGateRef.current.begin(async () => {
        emitStudentObservabilityMetric('sat_finalize_attempt', { scheduleId, attemptId });
        // Module timeout/close owns answer draining and server sealing. Once
        // every module is terminal, response submission may only be rejected
        // as closed; the idempotent completion endpoint returns the result.
        const finalResult = await satDeliveryGateway.submitAssessment(scheduleId, attemptId, {
          submissionId: attemptId,
        });
        if (identityGenerationRef.current !== generation) return null;
        setAnswersRecorded(true);
        setResult(finalResult);
        dispatch({
          type: "recover",
          state: {
            phase: "complete",
            scheduleId,
            candidateId,
            assessmentId,
            resultId: finalResult.id,
          },
        });
        return finalResult;
      }),
    [attemptId, scheduleId]
  );

  useEffect(() => {
    if (
      !data ||
      data.result ||
      // SAT-002: eligibility is derived from authoritative data (all modules
      // terminal, no pending attempt, no result) — never from the UI phase.
      // Only genuinely terminal runner phases are excluded; a timeout on the
      // last module must finalize even though it fired from `module`.
      state.phase === "complete" ||
      state.phase === "loading" ||
      data.proctorStatus === "terminated" ||
      data.scheduleRuntimeStatus === "cancelled" ||
      // Classroom staff_selects: the server refuses to complete until staff pick a route.
      data.awaitingStaffRoute ||
      findPendingAttempt(data) ||
      data.attempt.moduleAttempts.length === 0 ||
      !data.attempt.moduleAttempts.every((moduleAttempt) =>
        matchesFinalModuleState(moduleAttempt.state)
      )
    ) {
      return;
    }
    const recoveryKey = finalizationGateRef.current.revisionKey(attemptId, data);
    if (!finalizationGateRef.current.claim(recoveryKey)) return;
    // SAT-002: make the terminal transition visible even when this effect is
    // what discovered it (module/review still mounted). `submit` is legal
    // from both phases, so a failed finalization lands on the retry panel
    // instead of stranding the module UI.
    if (state.phase === "module" || state.phase === "review") {
      dispatch({ type: "submit" });
    }
    const generation = identityGenerationRef.current;
    void finalizeAssessment(generation, data.versionId).catch((finalizationError: unknown) => {
      if (identityGenerationRef.current !== generation) return;
      // Exam-day re-audit defect 2: release the claim so a manual retry (or a
      // later data change) can re-attempt finalization instead of being
      // suppressed forever by the consumed key.
      finalizationGateRef.current.release(recoveryKey);
      setError(
        finalizationError instanceof Error
          ? finalizationError.message
          : "The SAT result could not be finalized."
      );
    });
  }, [attemptId, data, finalizeAssessment, state.phase]);

  // All modules are finalized but no result exists: the finalize call failed
  // and polling alone cannot create a result. Eligibility is derived from
  // authoritative data, never from the UI phase (SAT-002), so a timeout that
  // fired from the question screen is retryable exactly like a Review submit.
  const finalizationRequired =
    Boolean(data) &&
    !data?.result &&
    data?.proctorStatus !== "terminated" &&
    data?.scheduleRuntimeStatus !== "cancelled" &&
    !findPendingAttempt(data as AssessmentDeliveryBootstrap) &&
    (data as AssessmentDeliveryBootstrap).attempt.moduleAttempts.length > 0 &&
    (data as AssessmentDeliveryBootstrap).attempt.moduleAttempts.every((moduleAttempt) =>
      matchesFinalModuleState(moduleAttempt.state),
    );
  const recoveryNeedsRetry =
    finalizationRequired && !isSubmitting && Boolean(error);
  // Exam-day P1: manual recovery for a failed finalization. Idempotent —
  // finalizeAssessment singleflights in memory and the server replays the
  // stable submissionId=attemptId instead of scoring twice. Valid while the
  // runner waits for the result (phase submitting) or sits on a failed
  // terminal recovery (directions with all modules final + error).
  const retryFinalization = useCallback(async () => {
    if ((state.phase !== "submitting" && !recoveryNeedsRetry) || isSubmitting) return;
    const generation = identityGenerationRef.current;
    emitStudentObservabilityMetric('sat_finalize_retry', { scheduleId, attemptId });
    setIsSubmitting(true);
    setError(null);
    try {
      const finalResult = await finalizeAssessment(generation, data?.versionId ?? "");
      if (!finalResult || identityGenerationRef.current !== generation) return;
      clearAttemptClientState();
    } catch (retryError) {
      if (identityGenerationRef.current !== generation) return;
      // A bootstrap that already carries the result rescues without error.
      const rescued = await refresh(false);
      if (identityGenerationRef.current !== generation) return;
      if (!rescued?.result) {
        setError(retryError instanceof Error ? retryError.message : "The SAT result could not be finalized.");
      }
    } finally {
      if (identityGenerationRef.current === generation) setIsSubmitting(false);
    }
  }, [attemptId, clearAttemptClientState, data?.versionId, finalizeAssessment, isSubmitting, recoveryNeedsRetry, refresh, scheduleId, state.phase]);

  // Identity lookup, never a key lookup: the module the runner is sitting is
  // the id the server selected (route decision -> module attempt -> bootstrap).
  // A moduleKey match could resolve the other adaptive branch, a same-key
  // module in another section, or a stale duplicate — and an empty moduleId
  // (recovered legacy snapshot) resolves nothing rather than guessing.
  const stateModule = useMemo(() => {
    if (!data || (state.phase !== "module" && state.phase !== "review")) return null;
    if (!state.moduleId) return null;
    return (
      data.sections
        .flatMap((section) => section.modules)
        .find((candidate) => candidate.id === state.moduleId) ?? null
    );
  }, [data, state]);

  const stateModuleAttempt = useMemo(
    () => (data && stateModule ? findAttemptForModule(data, stateModule.id) : undefined),
    [data, stateModule]
  );

  // Single-op entry needs no paint acknowledgment: started_at = DB NOW is the
  // authoritative deadline the moment StartModule commits. Reloads resume it
  // via bootstrap/state; no enter/visible handshake remains.

  const stateSection = useMemo(() => {
    if (!data || !stateModule) return null;
    return sectionForModule(data, stateModule.id) ?? null;
  }, [data, stateModule]);

  const stateResponses =
    state.phase === "module" || state.phase === "review" ? state.responses : null;
  const stateResponseRevisions =
    state.phase === "module" || state.phase === "review" ? state.responseRevisions : null;

  useEffect(() => {
    if (
      !data ||
      (state.phase !== "module" && state.phase !== "review") ||
      !stateModule ||
      !stateResponses ||
      !stateResponseRevisions
    )
      return;
    for (const question of stateModule.questions) {
      const pending = persistence.visibleDrafts[question.examQuestionId];
      if (!pending) continue;
      const current = stateResponses[question.examQuestionId];
      const sameDraft =
        current &&
        current.answer === pending.answer &&
        current.markedForReview === pending.markedForReview &&
        JSON.stringify(current.eliminatedOptionIds) ===
          JSON.stringify(pending.eliminatedOptionIds) &&
        JSON.stringify(current.annotations) === JSON.stringify(pending.annotations);
      const serverRevision =
        data.attempt.responses.find(
          (response) => response.examQuestionId === question.examQuestionId
        )?.revision ?? 0;
      const revision = Math.max(
        stateResponseRevisions[question.examQuestionId] ?? 0,
        serverRevision
      );
      if (sameDraft && stateResponseRevisions[question.examQuestionId] === revision) continue;
      dispatch({ type: "hydrateResponse", revision, response: pending });
    }
  }, [
    data,
    persistence.visibleDrafts,
    state.phase,
    stateResponseRevisions,
    stateResponses,
    stateModule,
  ]);

  // Server clock offset shared by both countdowns so personal and section
  // deadlines advance together (same skew correction). cohortRunning mirrors
  // the authoritative clock's `running` gate: a paused cohort stage freezes
  // both clocks (defect 9), never just the section one.
  //
  //
  // One accepted timing snapshot = one correction, and the correction is
  // (serverNow - the instant THAT serverNow was received). Pairing one
  // snapshot's serverNow with another snapshot's receipt instant invents skew
  // out of the delta between two reads, so the pair follows whichever leg won
  // the merge above: the runtime snapshot stamps its own receipt here, and the
  // bootstrap leg's stamp is snapshotReceivedAt (set exactly when this
  // controller accepted the payload carrying its serverNow).
  const cohortStageRunning = satPersonalClockRunning({
    timingModel: effectiveTiming?.timingModel,
    runtimeStatus: data?.scheduleRuntimeStatus,
    stageStatus: effectiveTiming?.stageStatus,
  });
  // Null (never 0) when this frame carries no module attempt: a missing row is
  // "no module identity yet", and a 0 would both display 0:00 for a module that
  // has not hydrated and arm the expiry on it. The countdown rule reads an
  // absent personal clock as "use the section clock alone".
  const personalModuleRemainingSeconds = stateModuleAttempt
    ? personalModuleCountdown(
        stateModuleAttempt,
        snapshotReceivedAt,
        now,
        serverClockOffsetMs,
        cohortStageRunning,
        effectiveTiming?.timingModel,
      )
    : null;
  // Clock contract: the student reads the MODULE's own allotment, capped by the
  // shared section clock (min of the two). A candidate sits Module 1 plus
  // exactly one Module 2, so the section length is M1 + one branch and the two
  // anchors meet in a normal run; the section clock is what stops a late
  // arrival or a stalled device from outliving the section. Expiry is the same
  // pair, and the server backstop closes on it too
  // (delivery.reconcileCohortSectionExpiredTx). The legacy model has no shared
  // clock, so its personal clock is both. SAT-003 policy lives in
  // application/satTimingPolicy.ts: display is what the student reads, expiry is
  // the only clock allowed to close the module.
  // The claim the directions screen may make about the module the student is
  // about to open, resolved once here: the server's own clamp published ahead of
  // entry, drained on the same clock convention the module clock uses, or the
  // authored length when the server published nothing. Null only while no module
  // is pending, so the screen never has to decide what the promise is.
  const pendingModuleWindow = pendingModule
    ? satModuleWindow({
        attempt: pendingAttempt,
        authoredSeconds: pendingModule.durationSeconds,
        snapshotReceivedAt,
        now,
        running: cohortStageRunning,
      })
    : null;
  const { displaySeconds: remainingSeconds, expirySeconds: expiryRemainingSeconds } = satCountdown({
    timingModel: effectiveTiming?.timingModel,
    stageKey: effectiveTiming?.stageKey ?? null,
    sectionKey: stateSection?.sectionKey ?? null,
    personalSeconds: personalModuleRemainingSeconds,
    authoritativeSeconds: authoritativeRemainingSeconds,
  });
  const activeModuleAttemptKey =
    stateModule && stateModuleAttempt
      ? `${stateModule.id}:${stateModuleAttempt.id}`
      : null;
  const stateSectionKey = stateSection?.sectionKey ?? null;
  const pendingSectionKey = pendingSection?.sectionKey ?? null;
  // Stable across renders: the model changes only when authoritative facts
  // change, never because a parent re-rendered. The context value feeds every
  // per-second temporal consumer, so an unmemoized literal would re-render
  // them all on each controller render and silently erode the P0 no-tick
  // invariant for the question subtree's siblings.
  const temporalModel = useMemo<SatTemporalModel>(
    () => ({
      data,
      effectiveTiming,
      snapshotReceivedAt,
      effectiveTimingReceivedAt,
      stateModuleAttempt,
      stateSectionKey,
      pendingAttempt,
      pendingSectionKey,
    }),
    [
      data,
      effectiveTiming,
      snapshotReceivedAt,
      effectiveTimingReceivedAt,
      stateModuleAttempt,
      stateSectionKey,
      pendingAttempt,
      pendingSectionKey,
    ],
  );
  const temporalModelRef = useRef(temporalModel);
  temporalModelRef.current = temporalModel;
  const timeoutTransitionPending =
    activeModuleAttemptKey !== null && timeoutTransitionKey === activeModuleAttemptKey;
  const answerInteractionBlocked =
    timeoutTransitionPending ||
    (activeModuleAttemptKey !== null &&
      expiryRemainingSeconds !== null &&
      expiryRemainingSeconds <= 0);
  useEffect(() => {
    if (state.phase !== "module" || !stateModule || !stateModuleAttempt || answerInteractionBlocked ||
        data?.proctorStatus === "paused" || data?.scheduleRuntimeStatus === "paused") return;
    const key = `${attemptId}:${stateModuleAttempt.id}`;
    const authorized = entryAuthorizedAtRef.current;
    if (reportedAnswerableModulesRef.current.has(key) || authorized?.moduleId !== stateModule.id) return;
    let cancelled = false;
    let frame = 0;
    const report = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          if (cancelled || document.visibilityState === "hidden") return;
          reportedAnswerableModulesRef.current.add(key);
          const at = Date.now();
          emitStudentObservabilityMetric("sat_first_answerable_frame_at", {
            scheduleId, attemptId, moduleId: stateModule.id,
            at, authorizedAt: authorized.at, latencyMs: at - authorized.at,
            ...(authorized.transitionDeadlineAt !== undefined ? {
              transitionDeadlineAt: authorized.transitionDeadlineAt,
              deadlineToAnswerableMs: at - authorized.transitionDeadlineAt,
            } : {}),
            ...(stateModule.adaptiveRole !== "base" && stateModuleAttempt.startedAt ? {
              m2AllotmentDeltaSeconds: Math.max(0, (at + serverClockOffsetMs - Date.parse(stateModuleAttempt.startedAt)) / 1000 - stateModuleAttempt.accumulatedPausedSeconds),
            } : {}),
          });
        });
      });
    };
    report();
    document.addEventListener("visibilitychange", report);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", report);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [answerInteractionBlocked, attemptId, data?.proctorStatus, data?.scheduleRuntimeStatus, scheduleId, serverClockOffsetMs, state.phase, stateModule, stateModuleAttempt]);

  const saveContext = useCallback(
    (interactionType: "typing" | "discrete") => {
      if (!stateModuleAttempt) return undefined;
      return {
        moduleAttemptId: stateModuleAttempt.id,
        stageKey: effectiveTiming?.stageKey ?? null,
        runtimeRevision: effectiveTiming?.runtimeRevision ?? null,
        remainingSeconds: deriveSatTemporalSnapshot(temporalModelRef.current, Date.now()).displaySeconds,
        interactionType,
      };
    },
    [
      effectiveTiming?.runtimeRevision,
      effectiveTiming?.stageKey,
      stateModuleAttempt,
    ]
  );

  // Wake the controller only when a timing boundary can change an exam action
  // or stage. Ordinary seconds are read by the small temporal UI consumers.
  useEffect(() => {
    const targets: number[] = [];
    const addDeadline = (value: string | null | undefined, offset: number) => {
      if (!value) return;
      const target = Date.parse(value) - offset;
      if (Number.isFinite(target) && target > now) targets.push(target);
    };
    if (data?.scheduleRuntimeStatus === "live") {
      addDeadline(effectiveTiming?.deadlineAt, serverClockOffsetMs);
      addDeadline(nextSectionStartAt, serverClockOffsetMs);
      if (state.phase === "module" || state.phase === "review") {
        addDeadline(stateModuleAttempt?.deadlineAt, serverClockOffsetMs);
        const activeDeadline = [effectiveTiming?.deadlineAt, stateModuleAttempt?.deadlineAt]
          .filter((value): value is string => Boolean(value))
          .map((value) => Date.parse(value) - serverClockOffsetMs - 60_000)
          .filter((value) => Number.isFinite(value) && value > now);
        targets.push(...activeDeadline);
      }
    }
    if (personalBreak && !personalBreak.pausedAt) {
      // The same server-time/receipt pair as the break countdown, so the wake
      // lands on the boundary the window derivation sees.
      addDeadline(personalBreak.startsAt, serverClockOffsetMs);
      addDeadline(personalBreak.deadlineAt, serverClockOffsetMs);
    }
    if (pendingAttempt?.availableAt && data) {
      addDeadline(pendingAttempt.availableAt, satClockOffsetMs(data.serverNow, snapshotReceivedAt));
    }
    if (pendingAttempt?.entryWindowSeconds && !pendingAttempt.startedAt) {
      targets.push(snapshotReceivedAt + pendingAttempt.entryWindowSeconds * 1_000);
    }
    if (stateModuleAttempt?.startedAt && !stateModuleAttempt.deadlineAt && stateModuleAttempt.remainingSeconds) {
      targets.push(snapshotReceivedAt + stateModuleAttempt.remainingSeconds * 1_000);
      if (stateModuleAttempt.remainingSeconds > 60) {
        targets.push(snapshotReceivedAt + (stateModuleAttempt.remainingSeconds - 60) * 1_000);
      }
    }
    const next = targets.filter((target) => target > now).sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = window.setTimeout(() => wakeAtTemporalBoundary((revision) => revision + 1), Math.max(1, next - now));
    return () => window.clearTimeout(timer);
  }, [data, effectiveTiming, nextSectionStartAt, now, pendingAttempt, personalBreak, serverClockOffsetMs, snapshotReceivedAt, state.phase, stateModuleAttempt]);

  const onTemporalBoundary = useCallback((boundary: "expiry" | "expiry-reset" | "break-end", key: string) => {
    if (boundary === "break-end") {
      const firedAt = Date.now();
      const personal = key.startsWith("personal-break-end:");
      if (personal) {
        // Keyed by attempt, break, generation and deadline: one sequential
        // read loop per expired break, never a request storm.
        if (personalBreakEndPullRef.current?.key === key || data?.scheduleRuntimeStatus !== "live") return;
        personalBreakEndPullRef.current = { key, firedAt };
        const breakId = personalBreak?.id;
        const generation = identityGenerationRef.current;
        const breakStillOpen = () =>
          dataRef.current?.attempt.personalBreaks?.some(
            (candidate) => candidate.id === breakId && candidate.state !== "completed",
          ) ?? false;
        void (async () => {
          for (let read = 1; ; read += 1) {
            await refresh(false);
            if (identityGenerationRef.current !== generation || !breakStillOpen()) return;
            if (read >= SAT_BREAK_END_MAX_READS || Date.now() + SAT_BREAK_END_PULL_WINDOW_MS - firedAt > SAT_BREAK_END_MAX_MS) break;
            await new Promise((resolve) => window.setTimeout(resolve, SAT_BREAK_END_PULL_WINDOW_MS));
            if (identityGenerationRef.current !== generation) return;
          }
          setBreakEndStalledKey(key);
        })();
        return;
      }
      const last = breakEndPullRef.current;
      if (last?.key === key || (last && firedAt - last.firedAt < SAT_BREAK_END_PULL_WINDOW_MS)) return;
      breakEndPullRef.current = { key, firedAt };
      if (data?.scheduleRuntimeStatus === "live") void refresh(false);
      return;
    }

    if (boundary === "expiry-reset") {
      if (timeoutTransitionKeyRef.current === key) {
        timeoutTransitionKeyRef.current = null;
        setTimeoutTransitionKey((current) => current === key ? null : current);
      }
      return;
    }
    if (
      (state.phase !== "module" && state.phase !== "review") ||
      !stateModule ||
      !stateModuleAttempt ||
      !data ||
      !findAttemptForModule(data, stateModule.id) ||
      stateModuleAttempt.pausedAt ||
      timeoutTransitionKeyRef.current === key
    ) return;
    timeoutTransitionKeyRef.current = key;
    setTimeoutTransitionKey(key);
    setTimeoutTransitionStarted(true);
    const generation = identityGenerationRef.current;
    if (isSatPersonalTimingModel(data.timing.timingModel)) {
      void closeTimedOutModule(generation, stateModule.id, stateModuleAttempt.id);
      return;
    }
    // Cohort/legacy clocks close on the shared section boundary: flush, then
    // one recovery read. Server reconciliation finalizes the module.
    void persistenceRef.current.flush().catch(() => undefined).then(() => {
      if (identityGenerationRef.current !== generation) return;
      void refresh(true);
    });
  }, [closeTimedOutModule, data, personalBreak?.id, refresh, state.phase, stateModule, stateModuleAttempt]);

  // The controller also owns the local expiry safety net. The route's
  // SatTemporalRuntime reports the same boundary for UI clocks, but hooks and
  // recovery surfaces can run without that presentation component mounted.
  useEffect(() => {
    if (!stateModule || !stateModuleAttempt || stateModuleAttempt.pausedAt) return;
    const expiry = deriveSatTemporalSnapshot(temporalModelRef.current, Date.now()).expirySeconds;
    if (expiry !== null && expiry <= 0) {
      onTemporalBoundary("expiry", `${stateModule.id}:${stateModuleAttempt.id}`);
    }
  }, [onTemporalBoundary, stateModule, stateModuleAttempt, now]);

  // The overlay clears only when the server reports the module closed. If that
  // never arrives (close refused, reconciler behind, connection lost), stop
  // presenting an endless spinner: offer a retry and point to the proctor.
  // Keyed by module attempt so a routed next module never inherits it.
  const [timeoutStalledKey, setTimeoutStalledKey] = useState<string | null>(null);
  useEffect(() => {
    if (!answerInteractionBlocked || activeModuleAttemptKey === null || timeoutStalledKey === activeModuleAttemptKey) return;
    const key = activeModuleAttemptKey;
    const timer = window.setTimeout(() => setTimeoutStalledKey(key), SAT_TIMEOUT_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [activeModuleAttemptKey, answerInteractionBlocked, timeoutStalledKey]);
  const timeoutCloseStalled = answerInteractionBlocked && activeModuleAttemptKey !== null && timeoutStalledKey === activeModuleAttemptKey;
  const retryTimeoutClose = useCallback(() => {
    if (activeModuleAttemptKey === null) return;
    setTimeoutStalledKey(null);
    // Re-run the same expiry path (close, or flush + recovery read) from the top.
    timeoutTransitionKeyRef.current = null;
    onTemporalBoundary("expiry", activeModuleAttemptKey);
  }, [activeModuleAttemptKey, onTemporalBoundary]);

  // Phase 04 commit-first / reconciler-second: the poll commit dispatches
  // showDirections synchronously when it carries the finalized predicate;
  // this stays as the idempotent safety net for externally-driven data
  // changes, dedupe-keyed on (versionId, runtimeRevision, moduleId,
  // moduleAttemptId) — never the business moduleKey, which the Lower and
  // Higher branch of one section can share.
  useEffect(() => {
    if (!data || (state.phase !== "module" && state.phase !== "review") || !stateModule) return;
    const attempt = findAttemptForModule(data, stateModule.id);
    if (attempt && matchesFinalModuleState(attempt.state)) {
      const nextAttempt = findPendingAttempt(data);
      const nextModule = moduleForAttempt(data, nextAttempt);
      if (nextModule && nextModule.id !== stateModule.id) {
        const key = `${data.versionId}:${data.timing.runtimeRevision}:${stateModule.id}:${attempt.id}`;
        if (pollReconcileKeyRef.current === key) return;
        pollReconcileKeyRef.current = key;
        dispatch({ type: "showDirections" });
      }
    }
  }, [data, state, state.phase, stateModule]);

  const currentResponse = useCallback(
    (questionId: string) => {
      if (state.phase !== "module" && state.phase !== "review") return null;
      return responseForQuestion(state.responses, questionId);
    },
    [state]
  );

  // Audit finding 3: every response mutation runs through the domain mutator,
  // and the reducer receives EXACTLY the object that is handed to persistence.
  // Deriving the persisted draft separately let `answer` stay inside
  // `eliminatedOptionIds` on the wire while the screen showed it restored.
  const commitResponseChange = useCallback(
    (
      questionId: string,
      change: SatResponseDraftChange,
      interactionType: "typing" | "discrete"
    ): SatQuestionResponseDraft | null => {
      if (answerInteractionBlocked) return null;
      const current = currentResponse(questionId);
      if (!current) return null;
      const next = applySatResponseDraftChange(current, change);
      dispatch({ type: "replaceResponse", response: next });
      persistence.save(next, saveContext(interactionType));
      return next;
    },
    [answerInteractionBlocked, currentResponse, persistence, saveContext]
  );

  const setAnswer = useCallback(
    (questionId: string, answer: string) => {
      const question = stateModule?.questions.find(
        (candidate) => candidate.examQuestionId === questionId
      );
      const interactionType =
        question?.questionType === "student_produced_response" ? "typing" : "discrete";
      commitResponseChange(questionId, { kind: "setAnswer", answer }, interactionType);
    },
    [commitResponseChange, stateModule]
  );

  const toggleReview = useCallback(
    (questionId: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      commitResponseChange(
        questionId,
        { kind: "setReviewFlag", markedForReview: !current.markedForReview },
        "discrete"
      );
    },
    [commitResponseChange, currentResponse]
  );

  const toggleEliminatedOption = useCallback(
    (questionId: string, optionId: string) => {
      commitResponseChange(questionId, { kind: "toggleEliminatedOption", optionId }, "discrete");
    },
    [commitResponseChange]
  );

  const setAnnotationNote = useCallback(
    (questionId: string, note: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      commitResponseChange(
        questionId,
        {
          kind: "setAnnotations",
          annotations: { ...current.annotations, legacyQuestionNote: note.slice(0, 2_000) },
        },
        "typing"
      );
    },
    [commitResponseChange, currentResponse]
  );

  const setAnnotations = useCallback((questionId: string, annotations: SatQuestionAnnotations) => {
    if (answerInteractionBlocked) return;
    const current = currentResponse(questionId);
    if (!current || (state.phase !== 'module' && state.phase !== 'review') || !resolveSatExamToolPolicy(state.sectionKey, []).highlight) return;
    dispatch({ type: 'setAnnotations', questionId, annotations });
    persistence.save({ ...current, annotations }, saveContext('discrete'));
  }, [answerInteractionBlocked, currentResponse, persistence, saveContext, state]);

  const returnToQuestion = useCallback((questionIndex: number) => {
    if (answerInteractionBlocked) return;
    flushBeforeNavigation();
    dispatch({ type: "selectQuestion", questionIndex });
    dispatch({ type: "returnToModule" });
  }, [answerInteractionBlocked, flushBeforeNavigation]);

  const blocked = Boolean(
    data && (data.proctorStatus === "paused" || data.scheduleRuntimeStatus === "paused")
  );
  const warning = data?.proctorStatus === "warned" ? data.proctorNote : null;
  // Set only after confirmed completion; failed completion cannot claim that
  // answers were recorded. Cleared on identity change.
  const [answersRecorded, setAnswersRecorded] = useState(false);

  return {
    state,
    data,
    result,
    error,
    setError,
    isSubmitting,
    isStarting,
    sectionEntry,
    pendingModule,
    pendingModuleWindow,
    pendingBreakSeconds,
    breakWindow,
    breakEntry,
    /** The expired break's completion did not arrive within the read loop. */
    breakEndStalled:
      breakEndStalledKey !== null && breakWindow.phase === "ending" &&
      personalBreakEndPullRef.current?.key === breakEndStalledKey,
    setBreakSurfaceMounted,
    pendingSectionWaitSeconds,
    pendingStageReady,
    entryReason: entryDecision.reason,
    entryAutoStartPending: entryDecision.autoStartPending,
    entryRequiresConfirmation,
    entryWindowExpired: expiredEntryModuleId === pendingModule?.id,
    /** SAT access-code start entry object (null for non-SAT / older servers). */
    startPolicy: data?.satStartPolicy ?? null,
    effectiveTiming,
    temporalModel,
    onTemporalBoundary,
    stateModule,
    stateModuleAttempt,
    stateSection,
    remainingSeconds,
    blocked,
    warning,
    answerInteractionBlocked,
    timeoutTransitionPending,
    timeoutTransitionStarted,
    timeoutCloseStalled,
    answersRecorded,
    // Exam-screen integrity hold: present once the student returns from a
    // visibility excursion, cleared only by acknowledging it.
    pendingTabSwitchWarning: satIntegrity.pendingTabSwitchWarning,
    acknowledgeTabSwitchWarning: satIntegrity.acknowledgeTabSwitchWarning,
    showAlmostUp: remainingSeconds <= 60 && remainingSeconds > 0 && (state.phase === "module" || state.phase === "review"),
    persistence,
    /** Phase 04 test seam: atomic poll-hint commit (see commitForTest). */
    commitForTest,
    commands: {
      startPendingModule,
      startWithCode,
      resolveRecovery,
      refreshRecoveryState: () => refresh(false),
      retryFinalization,
      retryTimeoutClose,
      takeOverDurabilityLease: persistence.takeOverLease,
      setAnswer,
      toggleReview,
      toggleEliminatedOption,
      setAnnotationNote,
      setAnnotations,
      selectQuestion: (questionIndex: number) => {
        if (answerInteractionBlocked) return;
        flushBeforeNavigation();
        dispatch({ type: "selectQuestion", questionIndex });
      },
      returnToQuestion,
      previousQuestion: () => {
        if (answerInteractionBlocked) return;
        flushBeforeNavigation();
        dispatch({
          type: "selectQuestion",
          questionIndex: state.phase === "module" ? state.questionIndex - 1 : 0,
        });
      },
      nextQuestion: () => {
        if (answerInteractionBlocked) return;
        flushBeforeNavigation();
        dispatch({
          type: "selectQuestion",
          questionIndex: state.phase === "module" ? state.questionIndex + 1 : 0,
        });
      },
      reviewModule: () => {
        if (answerInteractionBlocked) return;
        flushBeforeNavigation();
        dispatch({ type: "reviewModule" });
      },
      returnToModule: () => {
        if (answerInteractionBlocked) return;
        flushBeforeNavigation();
        dispatch({ type: "returnToModule" });
      },
      showDirections: () => dispatch({ type: "showDirections" }),
      toggleCalculator: () => dispatch({ type: "toggleTool", tool: "calculator" }),
      toggleReference: () => dispatch({ type: "toggleTool", tool: "reference_sheet" }),
      closeTool: (tool: SatToolId) => dispatch({ type: "closeTool", tool }),
      closeAllTools: () => dispatch({ type: "closeAllTools" }),
    },
  };
}
