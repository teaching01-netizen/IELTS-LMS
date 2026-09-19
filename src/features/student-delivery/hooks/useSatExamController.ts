import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAuthoritativeDeadlineClock } from "@shared/hooks/useAuthoritativeDeadlineClock";
import { emitStudentObservabilityMetric } from "../../../utils/studentObservability";
import {
  isCohortTimingModel,
  type ExamSessionRuntime,
} from "../../../types/domain";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentResult,
  AssessmentTimingSnapshot,
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
import { hasBackendStatusCode } from "../infrastructure/assessmentDeliveryBackendGateway";
import {
  calculatorWorkspaceKey,
  clearCalculatorWorkspace,
  clearCalculatorWorkspacesForAttempt,
} from "../infrastructure/satCalculatorWorkspace";
import { clearSatReadingPreferences } from "../infrastructure/satReadingPreferencesStore";
import { createSatRunnerState, satRunnerReducer } from "../application/satRunnerReducer";
// SAT-005/007: commit-to-phase routing and submit-conflict policy live in
// application/ (pure); the hook only wires them to state and the gateway.
import {
  decideSatCommitRoute,
  startModuleRouteAction,
  type SatCommitHint,
} from "../application/satCommitRouting";
import { createSatFinalizationGate } from "../application/satFinalizationGate";
// Clock + cadence policy (pure): display allotment vs expiry authority, stage
// readiness, break/wait countdowns, and the recovery-poll cadence.
import {
  satBreakCountdownSeconds,
  satClockOffsetMs,
  satCountdown,
  satExpectedStageKey,
  satPersonalClockRunning,
  satSectionWaitSeconds,
  satSharedClockRunning,
  satStageReady,
} from "../application/satTimingPolicy";
import { satPollDelayMs } from "../application/satPollCadence";
import {
  isSectionClosingRejection,
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
  previousModuleTimedOut as previousModuleEndedByClock,
  type SatEntryOutcome,
} from "../application/satEntry";
import { seedMatchesIdentity, type SatBootstrapSeed } from "../bootstrap/satBootstrapSeed";
import {
  isEquivalentBootstrap,
  SERVER_NOW_SKIP_TOLERANCE_MS,
} from "../application/satBootstrapEquality";
import { useSatIntegrityControl } from "./useSatIntegrityControl";
import { useSatModuleEntry } from "./useSatModuleEntry";
import { useSatResponsePersistence } from "./useSatResponsePersistence";

/**
 * Break-end pull window (Phase 3): at most one forced refresh per runtime
 * revision, and never faster than this. The section advance is system-driven,
 * so it does not ride the parent poll's control-command fast lane, and the
 * student would otherwise sit at 0:00 until that poll's steady cadence fires.
 */
const SAT_BREAK_END_PULL_WINDOW_MS = 2_000;

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
  const [now, setNow] = useState(() => Date.now());
  const timeoutSubmissionKeyRef = useRef<string | null>(null);
  // SAT-002: one owner for "which revision may finalize, and is one already
  // running" — the claim / single-flight / release rules live in
  // application/satFinalizationGate.ts so both drivers (the module-submit
  // commit path and the recovery effect) apply them identically.
  const finalizationGateRef = useRef(
    createSatFinalizationGate<AssessmentResult | null>()
  );
  const identityGenerationRef = useRef(0);
  const identityKey = `${scheduleId}:${attemptId}:${candidateId}`;
  const previousIdentityKeyRef = useRef<string | null>(null);
  if (previousIdentityKeyRef.current !== identityKey) {
    previousIdentityKeyRef.current = identityKey;
    identityGenerationRef.current += 1;
  }
  const renderIdentityGeneration = identityGenerationRef.current;

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
  const hydrateModuleResponsesRef = useRef<
    ((payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => void) | null
  >(null);

  useEffect(() => {
    setData(null);
    setResult(null);
    setError(null);
    setIsSubmitting(false);
    setIsStarting(false);
    setAutoSubmitted(false);
    setAnswersRecorded(false);
    timeoutSubmissionKeyRef.current = null;
    dataRef.current = null;
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
    // Preferred writer id comes from the attempt snapshot when the backend
    // has bound one (recovery/integrity), so SAT heartbeat/refresh present
    // the same identity the bearer was issued for — never a second id.
    configureSatDeliveryAttempt(
      scheduleId,
      attemptId,
      candidateId,
      attemptSnapshot?.recovery?.clientSessionId ?? attemptSnapshot?.integrity?.clientSessionId ?? null,
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
  // route decision; startModule/submitModule hints commit data here and
  // dispatch via their existing call-site logic in the same tick (see
  // startPendingModule/submitModule below).
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
      // Phase 04 C3 poll-skip: identical polls are no-ops — zero state
      // writes (no setData, no snapshotReceivedAt, no clock recompute).
      // Clock-only drift past tolerance is accepted as a no-clock-touch
      // patch (serverNow updated in place, snapshotReceivedAt preserved) so
      // serverClockOffsetMs stays stable; anything else commits normally.
      if (current && isEquivalentBootstrap(current, payload)) {
        // SAT-005: an unchanged projection still needs the route decision for
        // mutation responses — a poll may have committed the server's advance
        // first, and skipping the decision would strand the runner. Data
        // writes stay skipped; only the phase action and hydration run.
        if (hint.kind === "startModule" || hint.kind === "submitModule") {
          const action = decideSatCommitRoute(stateRef.current, current, hint, commitIdentity);
          if (action) dispatch(action);
          if (hint.kind === "startModule" && action?.type === "routeToModule") {
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
          // Deliberately no setSnapshotReceivedAt / setResult / dispatch.
          return true;
        }
      }
      const timing = mergeAuthoritativeTiming(current?.timing ?? null, payload.timing);
      const merged = timing === payload.timing ? payload : { ...payload, timing };
      const preState = stateRef.current;
      dataRef.current = merged;
      setData(merged);
      // snapshotReceivedAt advances ONLY on accepted+changed payloads, so
      // serverClockOffsetMs and both countdowns hold still across no-change
      // polls (C3 stable-clock invariant).
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
    async (
      surfaceError = false,
      ifNoneMatch?: string | null,
      /**
       * Transport-outcome probe. `refresh` resolves for a failed fetch (every
       * other caller, including `void refresh(...)`, depends on that), so the
       * recovery loop cannot infer success from the resolution: poll failures
       * have to be reported out of band or the backoff never engages.
       */
      onTransportOutcome?: (ok: boolean) => void,
    ) => {
      try {
        const payload = await satDeliveryGateway.bootstrap(scheduleId, attemptId, ifNoneMatch ?? null);
        onTransportOutcome?.(true);
        // Phase 04: poll-hint commit — 304, stale, and equivalent payloads
        // all surface as null (no-change), exactly like the 304 path below.
        return acceptPayloadAndRoute(payload, { kind: "poll" }) ? payload : null;
      } catch (loadError) {
        // A 304 (not modified) is not a failure: no new payload, no error.
        if (hasBackendStatusCode(loadError, 304)) {
          onTransportOutcome?.(true);
          return null;
        }
        onTransportOutcome?.(false);
        if (surfaceError && identityGenerationRef.current === renderIdentityGeneration) {
          setError(
            loadError instanceof Error ? loadError.message : "Unable to load the SAT attempt."
          );
        }
        return null;
      }
    },
    [acceptPayloadAndRoute, attemptId, renderIdentityGeneration, scheduleId]
  );

  // Phase 02 bootstrap effect (singleflight per identity+version): the only
  // new-import is the pure seed matcher (no React, no fetch). Rules: one
  // network call per (identityKey, staticVersionId); ETag passed only from a
  // matching seed; 304 silent; superseded-generation failures silent; initial
  // failure still setError so error && !data stays reachable; success path
  // identical to before (acceptPayloadAndRoute bootstrap-hint + its
  // internal bootstrapLoaded dispatch, committed atomically).
  // StrictMode note: React mounts, unmounts (cleanup sets cancelled = true
  // for that run only), then re-runs the effect. The second run JOINS the
  // still-in-flight shared promise (same map key + same ETag) instead of
  // firing a second gateway call — so StrictMode double-effects cost one
  // network call. Parent re-renders without dep changes do not re-run the
  // effect at all; only an identity rotation or a seed staticVersionId /
  // deliveryEtag scalar change starts a new request.
  const bootstrapSeedRef = useRef(bootstrapSeed);
  bootstrapSeedRef.current = bootstrapSeed;
  // Singleflight per (identity, version): StrictMode double-invoke + parent
  // re-render collapse here. Keyed on identityKey + seed staticVersionId so a
  // republish refires exactly once while churn at equal revision does not.
  // NOTE: the promise is stored WITHOUT a .then tap attached at set time —
  // taps attach per-effect-run below — so the map never triggers
  // unhandledrejection on failure paths.
  // The entry also records the ETag it was sent with: a re-run that would
  // send a DIFFERENT If-None-Match must not join the in-flight request (the
  // server answer is scoped to the ETag sent), it starts its own call.
  const bootstrapInflightRef = useRef(
    new Map<string, { etag: string | null; run: Promise<AssessmentDeliveryBootstrap> }>(),
  );

  useEffect(() => {
    const generationAtCall = identityGenerationRef.current;
    // Validate the seed belongs to THIS identity; a stale seed (identity
    // rotated while the parent re-rendered) must never scope the fetch.
    const seed = bootstrapSeedRef.current;
    const seedOk = seedMatchesIdentity(seed, { scheduleId, attemptId, candidateId });
    const ifNoneMatch = seedOk ? (seed?.deliveryEtag ?? null) : null;
    const requestKey = identityKey + "::" + (seedOk ? (seed?.staticVersionId ?? "") : "");

    let cancelled = false;
    const inFlight = bootstrapInflightRef.current.get(requestKey);
    // Join the in-flight request ONLY when it was sent with the same ETag;
    // a changed ETag scopes a different conditional request and must fire.
    const joinable = inFlight && inFlight.etag === ifNoneMatch ? inFlight.run : null;
    const run = joinable ?? satDeliveryGateway.bootstrap(scheduleId, attemptId, ifNoneMatch);
    if (!joinable) bootstrapInflightRef.current.set(requestKey, { etag: ifNoneMatch, run });

    void run.then(
      (payload) => {
        if (bootstrapInflightRef.current.get(requestKey)?.run === run) {
          bootstrapInflightRef.current.delete(requestKey);
        }
        if (cancelled || identityGenerationRef.current !== generationAtCall) return; // superseded: silent
        // Phase 04 atomic bootstrap: data + bootstrapLoaded commit in one
        // tick (no intermediate new-data/old-phase frame); the commit
        // dispatches bootstrapLoaded itself when pre-state is loading.
        acceptPayloadAndRoute(payload, { kind: "bootstrap" });
      },
      (loadError: unknown) => {
        if (bootstrapInflightRef.current.get(requestKey)?.run === run) {
          bootstrapInflightRef.current.delete(requestKey);
        }
        if (cancelled || identityGenerationRef.current !== generationAtCall) return;
        if (hasBackendStatusCode(loadError, 304)) return; // not-modified: not a failure
        setError(loadError instanceof Error ? loadError.message : "Unable to load the SAT attempt.");
      },
    );
    return () => {
      cancelled = true;
    };
    // Deps: identityKey (covers schedule/attempt/candidate rotation) + seed
    // staticVersionId (republish rebootstrap) + seed ETag scalar — NOT the
    // whole seed object (it churns with runtimeSnapshot). candidateId is read
    // via identityKey/seed-match only (kept out of deps to avoid refire on
    // unrelated prop churn). acceptPayloadAndRoute stays: stable per identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptPayloadAndRoute, identityKey, scheduleId, attemptId, bootstrapSeed?.staticVersionId, bootstrapSeed?.deliveryEtag]);

  useEffect(() => {
    // Exam-day P1: the local `now` must advance in every timing model. The
    // cohort section clock ticks via useAuthoritativeDeadlineClock, but the
    // personal module countdown derives from this `now` — freezing it froze
    // the displayed module timer between bootstraps.
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  // Recovery polling: recurring interval (not one-shot), backs off while
  // erroring (2s → 4s → 8s … → 16s, the satPollCadence window) with jitter,
  // suspends while the browser reports offline (reconnect is event-driven,
  // not poll-driven), and skips work the server already answered via ETag.
  // The offline listener is always cleaned up — a one-shot addEventListener
  // without removeEventListener leaks a stale closure per poll cycle.
  const pollFailuresRef = useRef(0);
  const pollEtagRef = useRef<string | null>(null);
  useEffect(() => {
    // Keep recovery polling alive while finalization is in flight. A
    // bootstrap that carries `result` recovers submitting → complete via
    // the terminal-result commit path, so an outage that lifts after the
    // finalize call failed still completes without manual retry.
    // Phase 04: the loop no longer depends on state.phase (phase changes
    // must not tear down the cadence and reset backoff); the terminal read
    // goes through phaseRef, re-checked inside each tick.
    if (phaseRef.current === "complete") return;
    let stopped = false;
    let timer = 0;
    let onOnline: (() => void) | null = null;
    // A failed poll doubles the window; a successful one (including a 304
    // no-change) resets it. Without this signal the backoff is dead code, since
    // refresh() resolves for a failed fetch.
    const recordTransportOutcome = (ok: boolean) => {
      pollFailuresRef.current = ok ? 0 : pollFailuresRef.current + 1;
    };
    const schedule = () => {
      if (stopped) return;
      const failures = pollFailuresRef.current;
      const intervalMs = satPollDelayMs({ liveSocketConnected, failures, random: Math.random() });
      timer = window.setTimeout(tick, intervalMs);
    };
    const tick = () => {
      if (stopped) return;
      // Phase 04: terminal re-check without remounting the loop — an
      // in-flight cadence stops promptly after a terminal commit.
      if (phaseRef.current === "complete") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        // Offline: the online event (not the timer) drives the next
        // refresh; reschedule the cadence after reconnect.
        onOnline = () => {
          pollFailuresRef.current = 0;
          void refresh(false, null, recordTransportOutcome).finally(schedule);
        };
        // One-shot: exactly one reconnect per outage. A handler that stays
        // registered after firing would make every later reconnect poll once
        // per past outage and schedule a timer per handler (doubling the loop).
        window.addEventListener("online", onOnline, { once: true });
        return;
      }
      void refresh(false, pollEtagRef.current, recordTransportOutcome).then(
        (payload) => {
          // Phase 04 dead-store note (documented, not fixed): the typed
          // AssessmentDeliveryBootstrap payload carries no `etag` field, so
          // this read is always undefined and pollEtagRef stays null. The
          // poll-skip layer (isEquivalentBootstrap) is the real no-change
          // path; fetch/ETag plumbing stays owned by Phase 02.
          const etag = (payload as { etag?: unknown } | null)?.etag;
          if (typeof etag === "string" && etag) pollEtagRef.current = etag;
        },
        // Safety net for an unexpected throw; transport failures arrive through
        // recordTransportOutcome, which owns the backoff counter.
        () => { recordTransportOutcome(false); },
      ).finally(() => { if (!stopped) schedule(); });
    };
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (onOnline) window.removeEventListener("online", onOnline);
    };
    // Phase 04: stable across phase transitions — [liveSocketConnected,
    // refresh] (+ identity generation via the refresh closure). Backoff /
    // jitter / offline semantics live in application/satPollCadence.ts.
  }, [liveSocketConnected, refresh]);

  useEffect(() => {
    if (!runtimeSnapshot?.revision || !isCohortTimingModel(data?.timing.timingModel)) return;
    void refresh(false);
  }, [data?.timing.timingModel, refresh, runtimeSnapshot?.revision]);

  useEffect(() => {
    if (attemptUpdateToken <= 0) return;
    void refresh(false);
  }, [attemptUpdateToken, refresh]);

  useSatIntegrityControl({
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
  // data+phase atomically, so this directions auto-route is a safety net for
  // externally-driven data changes (e.g. a Phase-02 seed swap). Dedupe-keyed
  // so StrictMode double-invoke cannot double-dispatch; at most one action
  // per (versionId, runtimeRevision, phase, moduleKey).
  useEffect(() => {
    if (!data || state.phase !== "directions") return;
    const activeAttempt = findActiveAttempt(data);
    const activeModule = moduleForAttempt(data, activeAttempt);
    if (!activeAttempt?.startedAt || !activeModule) return;
    const key = `${data.versionId}:${data.timing.runtimeRevision}:directions:${activeModule.id}`;
    if (safetyReconcileKeyRef.current === key) return;
    safetyReconcileKeyRef.current = key;
    startModuleFrom(data, activeModule);
  }, [data, startModuleFrom, state.phase]);

  useEffect(() => {
    if (!data) return;
    const terminalWithoutResult =
      data.proctorStatus === "terminated" ||
      data.scheduleRuntimeStatus === "completed" ||
      data.scheduleRuntimeStatus === "cancelled";
    if (!terminalWithoutResult) return;
    clearSatReadingPreferences(scheduleId, attemptId);
  }, [attemptId, data, scheduleId]);

  // Phase 04: terminal-result commit path. Poll commits carrying `result`
  // recover to complete synchronously; this effect stays as the safety net
  // for externally-driven data changes, dedupe-keyed on (versionId, result).
  useEffect(() => {
    if (!data?.result || state.phase === "complete") return;
    const key = `terminal:${data.versionId}:${data.result.id}`;
    if (reconcileGuardKeyRef.current === key) return;
    reconcileGuardKeyRef.current = key;
    clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
    clearSatReadingPreferences(scheduleId, attemptId);
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
  }, [attemptId, data, scheduleId, state.phase]);

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
        runtimeSnapshot.nextSectionStartAt ?? data.timing.nextSectionStartAt ?? null,
      waitingForNextSection:
        runtimeSnapshot.waitingForNextSection ?? data.timing.waitingForNextSection ?? false,
      runtimeRevision: runtimeSnapshot.revision ?? data.timing.runtimeRevision,
    };
  }, [data, runtimeSnapshot]);
  const effectiveTiming = useMemo(
    () => (data ? mergeAuthoritativeTiming(data.timing, runtimeTiming ?? data.timing) : null),
    [data, runtimeTiming]
  );
  const authoritativeRemainingSeconds = useAuthoritativeDeadlineClock({
    deadlineAt: effectiveTiming?.deadlineAt ?? null,
    serverNow: effectiveTiming?.serverNow ?? null,
    fallbackSeconds: effectiveTiming?.remainingSeconds ?? 0,
    running: satSharedClockRunning({
      runtimeStatus: data?.scheduleRuntimeStatus,
      stageStatus: effectiveTiming?.stageStatus,
    }),
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
  const nextSectionStartSeconds = useAuthoritativeDeadlineClock({
    deadlineAt: nextSectionStartAt,
    serverNow: effectiveTiming?.serverNow ?? null,
    fallbackSeconds: 0,
    running: Boolean(nextSectionStartAt) && data?.scheduleRuntimeStatus === "live",
  });
  const pendingBreakSeconds = data
    ? satBreakCountdownSeconds({
        timingModel: effectiveTiming?.timingModel,
        nextSectionStartAt,
        nextSectionStartSeconds,
        legacyBreakSeconds: breakRemainingSeconds(
          data,
          pendingAttempt,
          snapshotReceivedAt,
          now,
        ),
      })
    : 0;
  const pendingSection = data && pendingModule ? sectionForModule(data, pendingModule.id) : null;
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

  // Module-advance fix: a branch module (Module 2) is opened by the automatic
  // path only when the module before it in the same section ended because its
  // own clock ran out — the timeout hand-off the runbook describes. Read from
  // the payload rather than from local submit state so a reload or an offline
  // reconnect reaches the same verdict (see application/satEntry.ts on why
  // `completionReason` cannot answer this).
  const previousModuleTimedOut = useMemo(
    () => (data && pendingModule ? previousModuleEndedByClock(data, pendingModule) : false),
    [data, pendingModule],
  );

  /**
   * Starts the pending module and reports what actually happened:
   *  - "opened": the module resolved active and the runner routed into it;
   *  - "noop":   a guard stopped us, or the response did not open the module;
   *  - "failed": the call rejected (the student-facing error is set here).
   * Callers use this to decide whether the entry attempt may be retried, so a
   * failure or an inert response can never be mistaken for a completed entry.
   */
  const startPendingModule = useCallback(async (): Promise<SatEntryOutcome> => {
    if (!data || !pendingModule || isStarting) return "noop";
    const generation = identityGenerationRef.current;
    setIsStarting(true);
    setError(null);
    try {
      const payload = await satDeliveryGateway.startModule(scheduleId, attemptId, {
        moduleId: pendingModule.id,
      });
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
        reason: previousModuleTimedOut ? "timeout" : "student",
        sectionKey: pendingSection?.sectionKey ?? null,
        adaptiveRole: pendingModule.adaptiveRole,
      });
      return "opened";
    } catch (startError) {
      if (identityGenerationRef.current === generation) {
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
            "This attempt is now active in another window. Your saved answers are safe — continue there, or use Take over to resume here."
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
    pendingSection,
    previousModuleTimedOut,
    scheduleId,
  ]);

  // Phase 3 (client-forced break end): once the authoritative break has run
  // out, pull the advanced projection ourselves instead of waiting out the
  // parent's steady cadence. Throttled to the window above and to one pull per
  // revision, so a late advance cannot become a request storm.
  const breakEndPullRef = useRef<{ key: string; firedAt: number } | null>(null);
  useEffect(() => {
    if (!data || !waitingForNextSection) return;
    if (data.scheduleRuntimeStatus !== "live") return;
    if (nextSectionStartSeconds > 0) return;
    const key = `${identityKey}:${effectiveTiming?.runtimeRevision ?? data.timing.runtimeRevision}`;
    const firedAt = now;
    const lastPull = breakEndPullRef.current;
    if (lastPull?.key === key && firedAt - lastPull.firedAt < SAT_BREAK_END_PULL_WINDOW_MS) {
      return;
    }
    breakEndPullRef.current = { key, firedAt };
    void refresh(false);
  }, [
    data,
    effectiveTiming?.runtimeRevision,
    identityKey,
    nextSectionStartSeconds,
    now,
    refresh,
    waitingForNextSection,
  ]);

  // One owner for entry (Phase 2): the pure decision from
  // application/satEntry.ts plus the dedupe/retry/start in useSatModuleEntry.
  // The first module (the proctor's Start) and every later section (the end of
  // the authoritative break) run through this single path.
  const entryDecision = deriveSatEntryDecision({
    data,
    module: pendingModule,
    sectionDisplayOrder: pendingSection?.displayOrder ?? null,
    stageReady: pendingStageReady,
    breakSeconds: pendingBreakSeconds,
    sectionWaitSeconds: pendingSectionWaitSeconds,
    phase: state.phase,
    previousModuleTimedOut,
  });

  // Phase 4: the entry surface is what the student sees when the break
  // countdown has run out but the module has not opened — recovery state for
  // the surfaces, never a silent 0:00.
  const entrySurface = useSatModuleEntry({
    identity: identityKey,
    enabled: entryDecision.shouldStart,
    entryKey: pendingModule ? `${attemptId}:${pendingModule.id}` : null,
    now,
    startModule: startPendingModule,
  });

  const finalizeAssessment = useCallback(
    (generation: number, assessmentId: string): Promise<AssessmentResult | null> =>
      finalizationGateRef.current.begin(async () => {
        emitStudentObservabilityMetric('sat_finalize_attempt', { scheduleId, attemptId });
        // SAT-001: a committed V2 provisional claim (bootstrap reports
        // provisionalSubmitted) makes response resubmission impossible by
        // design — the durability engine treats the attempt as terminal and
        // refuses — while the scoring result is still missing. Skip the
        // resubmission phase and go straight to the idempotent completion
        // call instead of failing finalization forever.
        const provisional = dataRef.current?.attempt.provisionalSubmitted === true;
        if (!provisional) {
          await persistenceRef.current.flush();
          if (identityGenerationRef.current !== generation) return null;
          await persistenceRef.current.submit();
          if (identityGenerationRef.current !== generation) return null;
        }
        if (identityGenerationRef.current === generation) setAnswersRecorded(true);
        const finalResult = await satDeliveryGateway.submitAssessment(scheduleId, attemptId, {
          submissionId: attemptId,
        });
        if (identityGenerationRef.current !== generation) return null;
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

  const submitModule = useCallback(
    async (moduleId: string) => {
      if (isSubmitting) return;
      const generation = identityGenerationRef.current;
      const isCurrent = () => identityGenerationRef.current === generation;
      const submittedModuleAttemptId = data ? findAttemptForModule(data, moduleId)?.id : undefined;
      setIsSubmitting(true);
      setError(null);
      // SAT-007 slice 2: a control-epoch or durability conflict means our local
      // view is stale, not that the request is illegal. Refresh the authoritative
      // epoch/revision and send exactly ONE more attempt before treating it as a
      // real failure. Section closures and writer supersession are deliberately
      // excluded: the module is genuinely gone, or another window owns the
      // attempt and retrying here cannot help.
      const submitModuleRequest = async () => {
        try {
          return await satDeliveryGateway.submitModule(scheduleId, attemptId, { moduleId });
        } catch (conflict) {
          if (!isStaleConflictRejection(conflict)) throw conflict;
          await refresh(false);
          return await satDeliveryGateway.submitModule(scheduleId, attemptId, { moduleId });
        }
      };
      try {
        await persistence.flush();
        if (!isCurrent()) return;
        // SAT-004: module submission is a boundary too. flush() only proves
        // the queue drained — a blocked draft can be visible outside the
        // queue — so refuse to finalize the module while any visible answer
        // is unsettled. The shared barrier is the same one the terminal
        // submit uses.
        await persistence.assertBoundarySettled?.();
        if (!isCurrent()) return;
        const next = await submitModuleRequest();
        if (!isCurrent()) return;
        if (next.scheduleId !== scheduleId || next.attempt.id !== attemptId) return;
        // SAT-005: the submitModule hint commits data AND dispatches the
        // post-submit route action (submit / break / directions) in one
        // monotonic commit — mutation responses no longer have a privileged
        // bypass around the stale-revision guard. A rejected payload reports
        // false; the newer committed state (or the poll/recovery safety nets)
        // owns the route from there.
        if (!acceptPayloadAndRoute(next, { kind: "submitModule", moduleId })) return;
        if (submittedModuleAttemptId) {
          clearCalculatorWorkspace(
            calculatorWorkspaceKey(scheduleId, attemptId, submittedModuleAttemptId)
          );
        }
        const committed = dataRef.current;
        const nextAttempt = committed ? findPendingAttempt(committed) : undefined;
        const nextModule = committed ? moduleForAttempt(committed, nextAttempt) : null;
        if (!nextModule) {
          // SAT-002: claim the finalization identity for this revision before
          // the data-driven recovery effect can see the same terminal
          // projection — one completion attempt, one error to report. The
          // effect clears it on failure so retries (manual or from a later
          // revision) still work.
          if (committed) {
            finalizationGateRef.current.claim(
              finalizationGateRef.current.revisionKey(attemptId, committed)
            );
          }
          const finalResult = await finalizeAssessment(
            generation,
            committed?.versionId ?? next.versionId
          );
          if (!finalResult || !isCurrent()) return;
          clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
          clearSatReadingPreferences(scheduleId, attemptId);
          return;
        }
        return;
      } catch (submitError) {
        if (!isCurrent()) return;
        const refreshed = await refresh(false);
        if (!isCurrent()) return;
        if (refreshed?.result) {
          clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
          clearSatReadingPreferences(scheduleId, attemptId);
          setResult(refreshed.result);
          dispatch({
            type: "recover",
            state: {
              phase: "complete",
              scheduleId,
              candidateId,
              assessmentId: refreshed.versionId,
              resultId: refreshed.result.id,
            },
          });
          return;
        }

        if (refreshed) {
          const nextAttempt = findPendingAttempt(refreshed);
          const nextModule = moduleForAttempt(refreshed, nextAttempt);
          if (nextModule && nextModule.id !== moduleId) {
            if (submittedModuleAttemptId) {
              clearCalculatorWorkspace(
                calculatorWorkspaceKey(scheduleId, attemptId, submittedModuleAttemptId)
              );
            }
            dispatch({ type: "showDirections" });
            return;
          }
        }
        // SAT-007: writer supersession is not a section transition. The
        // attempt is live somewhere else; the correct instruction is to
        // continue there (or take the attempt over), never to wait for a
        // module close that will not arrive on this client.
        if (isWriterSupersededRejection(submitError)) {
          setError(
            "This attempt is now active in another window. Your saved answers are safe — continue there, or use Take over to resume here."
          );
          return;
        }
        // Phase 4: the server's clock has moved past ours — the section clock
        // closed underneath the submit, the runtime paused, or the reconciler
        // already finalized this module. Not a student error and not a
        // timeout (a timeout keeps the attribution the zero-remaining path
        // already set): say what is happening and let the poll loop, or
        // reconnect when this ran offline, move the student on.
        if (isSectionClosingRejection(submitError)) {
          setError(
            "The exam is finalizing this module — your answers are safe. Keep this screen open."
          );
          return;
        }
        // The retry already refetched once. Say what is actually true — the
        // module is NOT closed and the last answers were not lost — instead of
        // the backend's raw code, which reads like an exam error to a student.
        if (isStaleConflictRejection(submitError)) {
          setError(
            "This device and the server disagreed about the latest revision, so the module was not submitted. Your answers are saved — submit the module again."
          );
          return;
        }
        setError(submitError instanceof Error ? submitError.message : "Module submission failed.");
      } finally {
        if (isCurrent()) setIsSubmitting(false);
      }
    },
    [
      acceptPayloadAndRoute,
      attemptId,
      data,
      isSubmitting,
      persistence,
      refresh,
      finalizeAssessment,
      scheduleId,
    ]
  );

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
      clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
      clearSatReadingPreferences(scheduleId, attemptId);
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
  }, [attemptId, data?.versionId, finalizeAssessment, isSubmitting, recoveryNeedsRetry, refresh, scheduleId, state.phase]);

  const stateModule = useMemo(() => {
    if (!data || (state.phase !== "module" && state.phase !== "review")) return null;
    return (
      data.sections
        .flatMap((section) => section.modules)
        .find((candidate) => candidate.moduleKey === state.moduleKey) ?? null
    );
  }, [data, state]);

  const stateModuleAttempt = useMemo(
    () => (data && stateModule ? findAttemptForModule(data, stateModule.id) : undefined),
    [data, stateModule]
  );

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
  const runtimeServerNow = runtimeTiming?.serverNow ?? null;
  const runtimeTimingReceiptRef = useRef<{ serverNow: string | null; receivedAt: number }>({
    serverNow: null,
    receivedAt: 0,
  });
  if (runtimeServerNow !== null && runtimeServerNow !== runtimeTimingReceiptRef.current.serverNow) {
    runtimeTimingReceiptRef.current = { serverNow: runtimeServerNow, receivedAt: Date.now() };
  }
  const effectiveTimingReceivedAt =
    runtimeServerNow !== null && effectiveTiming?.serverNow === runtimeServerNow
      ? runtimeTimingReceiptRef.current.receivedAt || snapshotReceivedAt
      : snapshotReceivedAt;
  const serverClockOffsetMs = satClockOffsetMs(
    effectiveTiming?.serverNow ?? null,
    effectiveTimingReceivedAt,
  );
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
    ? personalModuleCountdown(stateModuleAttempt, snapshotReceivedAt, now, serverClockOffsetMs, cohortStageRunning)
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
  const { displaySeconds: remainingSeconds, expirySeconds: expiryRemainingSeconds } = satCountdown({
    timingModel: effectiveTiming?.timingModel,
    stageKey: effectiveTiming?.stageKey ?? null,
    sectionKey: stateSection?.sectionKey ?? null,
    personalSeconds: personalModuleRemainingSeconds,
    authoritativeSeconds: authoritativeRemainingSeconds,
  });

  const saveContext = useCallback(
    (interactionType: "typing" | "discrete") => {
      if (!stateModuleAttempt) return undefined;
      return {
        moduleAttemptId: stateModuleAttempt.id,
        stageKey: effectiveTiming?.stageKey ?? null,
        runtimeRevision: effectiveTiming?.runtimeRevision ?? null,
        remainingSeconds,
        interactionType,
      };
    },
    [
      effectiveTiming?.runtimeRevision,
      effectiveTiming?.stageKey,
      remainingSeconds,
      stateModuleAttempt,
    ]
  );

  useEffect(() => {
    if (
      (state.phase !== "module" && state.phase !== "review") ||
      !stateModule ||
      !stateModuleAttempt
    ) {
      return;
    }
    // Phase 04 skew guard: a skew frame that looks like 0 (a missing attempt
    // resolves through the section-clock fallback) must neither submit
    // nor consume timeoutSubmissionKeyRef — submit fires only from a
    // resolved frame. Key stays moduleId:attemptId-scoped, exactly once.
    if (!data || !findAttemptForModule(data, stateModule.id)) return;
    const key = `${stateModule.id}:${stateModuleAttempt.id}`;
    // SAT-003: expiry is judged on the authoritative clock only. A null
    // expiry means this frame has no authority for the module yet (mismatched
    // cohort stage) — keep the timeout inert rather than trusting the
    // student-facing allotment.
    if (expiryRemainingSeconds === null || expiryRemainingSeconds > 0) {
      if (timeoutSubmissionKeyRef.current !== key) timeoutSubmissionKeyRef.current = null;
      return;
    }
    if (stateModuleAttempt.pausedAt || timeoutSubmissionKeyRef.current === key) return;
    timeoutSubmissionKeyRef.current = key;
    setAutoSubmitted(true);
    void submitModule(stateModule.id);
  }, [data, expiryRemainingSeconds, state.phase, stateModule, stateModuleAttempt, submitModule]);

  // Phase 04 commit-first / reconciler-second: the poll commit dispatches
  // showDirections synchronously when it carries the finalized predicate;
  // this stays as the idempotent safety net for externally-driven data
  // changes, dedupe-keyed on (versionId, runtimeRevision, phase, moduleKey).
  useEffect(() => {
    if (!data || (state.phase !== "module" && state.phase !== "review") || !stateModule) return;
    const attempt = findAttemptForModule(data, stateModule.id);
    if (attempt && matchesFinalModuleState(attempt.state)) {
      const nextAttempt = findPendingAttempt(data);
      const nextModule = moduleForAttempt(data, nextAttempt);
      if (nextModule && nextModule.id !== stateModule.id) {
        const moduleKey = "moduleKey" in state ? state.moduleKey : stateModule.moduleKey;
        const key = `${data.versionId}:${data.timing.runtimeRevision}:${state.phase}:${moduleKey}`;
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
      const current = currentResponse(questionId);
      if (!current) return null;
      const next = applySatResponseDraftChange(current, change);
      dispatch({ type: "replaceResponse", response: next });
      persistence.save(next, saveContext(interactionType));
      return next;
    },
    [currentResponse, persistence, saveContext]
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
    const current = currentResponse(questionId);
    if (!current || (state.phase !== 'module' && state.phase !== 'review') || !resolveSatExamToolPolicy(state.sectionKey, []).highlight) return;
    dispatch({ type: 'setAnnotations', questionId, annotations });
    persistence.save({ ...current, annotations }, saveContext('discrete'));
  }, [currentResponse, persistence, saveContext, state]);

  const returnToQuestion = useCallback((questionIndex: number) => {
    dispatch({ type: "selectQuestion", questionIndex });
    dispatch({ type: "returnToModule" });
  }, []);

  const blocked = Boolean(
    data && (data.proctorStatus === "paused" || data.scheduleRuntimeStatus === "paused")
  );
  const warning = data?.proctorStatus === "warned" ? data.proctorNote : null;
  // Timeout attribution (Phase 1): distinguishes the auto-submit overlay copy
  // ("Time expired — submitting…") from a manual submit. Set when the
  // zero-remaining effect fires; cleared on identity change and once the
  // phase leaves module/review (submit pipeline consumed it).
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  // Exam-day P1: distinguishes "answers recorded, generating result" from
  // "submission failed, answers safe locally — retry". Set once flush +
  // V2 submit ack inside finalizeAssessment; cleared on identity change.
  const [answersRecorded, setAnswersRecorded] = useState(false);

  return {
    state,
    data,
    result,
    error,
    setError,
    isSubmitting,
    isStarting,
    pendingModule,
    pendingBreakSeconds,
    pendingSectionWaitSeconds,
    pendingStageReady,
    autoEntryRecoverable: entrySurface.recoverable,
    // True while the automatic entry path owns the pending module; the
    // directions screen keeps its Start button recovery-only only then, so a
    // branch module nobody will auto-start keeps a working button.
    entryAutoStartPending: entryDecision.autoStartPending,
    effectiveTiming,
    stateModule,
    stateModuleAttempt,
    stateSection,
    remainingSeconds,
    blocked,
    warning,
    autoSubmitted,
    answersRecorded,
    showAlmostUp: remainingSeconds <= 60 && remainingSeconds > 0 && (state.phase === "module" || state.phase === "review"),
    persistence,
    /** Phase 04 test seam: atomic poll-hint commit (see commitForTest). */
    commitForTest,
    commands: {
      startPendingModule,
      submitModule,
      retryFinalization,
      takeOverDurabilityLease: persistence.takeOverLease,
      setAnswer,
      toggleReview,
      toggleEliminatedOption,
      setAnnotationNote,
      setAnnotations,
      selectQuestion: (questionIndex: number) =>
        dispatch({ type: "selectQuestion", questionIndex }),
      returnToQuestion,
      previousQuestion: () =>
        dispatch({
          type: "selectQuestion",
          questionIndex: state.phase === "module" ? state.questionIndex - 1 : 0,
        }),
      nextQuestion: () =>
        dispatch({
          type: "selectQuestion",
          questionIndex: state.phase === "module" ? state.questionIndex + 1 : 0,
        }),
      reviewModule: () => dispatch({ type: "reviewModule" }),
      returnToModule: () => dispatch({ type: "returnToModule" }),
      showDirections: () => dispatch({ type: "showDirections" }),
      toggleCalculator: () => dispatch({ type: "toggleTool", tool: "calculator" }),
      toggleReference: () => dispatch({ type: "toggleTool", tool: "reference_sheet" }),
      closeTool: (tool: SatToolId) => dispatch({ type: "closeTool", tool }),
      closeAllTools: () => dispatch({ type: "closeAllTools" }),
    },
  };
}
