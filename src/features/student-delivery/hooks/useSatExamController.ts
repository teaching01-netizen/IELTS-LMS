import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useAuthoritativeDeadlineClock } from "@shared/hooks/useAuthoritativeDeadlineClock";
import { emitStudentObservabilityMetric } from "../../../utils/studentObservability";
import {
  isCohortTimingModel,
  isSectionKeyedCohortModel,
  type ExamSessionRuntime,
} from "../../../types/domain";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentResult,
  AssessmentTimingSnapshot,
} from "../contracts/assessmentDelivery";
import type { StudentAttempt } from "../../../types/studentAttempt";
import { normalizeSatAnnotations, responseForQuestion, type SatQuestionAnnotations } from "../domain/satResponses";
import {
  breakRemainingSeconds,
  mergeAuthoritativeTiming,
  personalModuleRemainingSeconds as personalModuleCountdown,
  timingForAttempt,
} from "../domain/satTiming";
import { resolveSatExamToolPolicy, toSatToolCapabilities } from "../domain/satToolPolicy";
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
import type { SatToolId } from "../domain/satTools";
import {
  findActiveAttempt,
  findAttemptForModule,
  findCurrentModule,
  findPendingAttempt,
  matchesFinalModuleState,
  moduleForAttempt,
  sectionForModule,
  shouldAutoStartInitialModule,
  shouldAutoStartNextSectionAfterBreak,
} from "../application/satRuntimeSelectors";
import { seedMatchesIdentity, type SatBootstrapSeed } from "../bootstrap/satBootstrapSeed";
import {
  isEquivalentBootstrap,
  SERVER_NOW_SKIP_TOLERANCE_MS,
} from "../application/satBootstrapEquality";
import { useSatIntegrityControl } from "./useSatIntegrityControl";
import { useSatResponsePersistence } from "./useSatResponsePersistence";

/**
 * Phase 4: a conflict from the module-submit gate means the server's view of
 * the authoritative clock has moved past ours (DEADLINE_EXPIRED /
 * RUNTIME_NOT_LIVE / SECTION_NOT_ACTIVE / already finalized by the reconciler).
 * The module is finalized server-side and the recovery poll routes the student
 * onwards, so this must never read as "your submission failed".
 */
function isSectionClosingRejection(error: unknown): boolean {
  return hasBackendStatusCode(error, 409);
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
  const initialAutoStartKeyRef = useRef<string | null>(null);
  const nextSectionAutoStartRef = useRef<{ key: string; attemptedAt: number } | null>(null);
  const finalizationInFlightRef = useRef<Promise<AssessmentResult | null> | null>(null);
  const finalizationRecoveryKeyRef = useRef<string | null>(null);
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

  useEffect(() => {
    setData(null);
    setResult(null);
    setError(null);
    setIsSubmitting(false);
    setIsStarting(false);
    setAutoSubmitted(false);
    setAnswersRecorded(false);
    timeoutSubmissionKeyRef.current = null;
    initialAutoStartKeyRef.current = null;
    nextSectionAutoStartRef.current = null;
    dataRef.current = null;
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

  // Phase 04: pure route decision for the atomic commit path. Computes at
  // most one phase action from (preState, payload, hint); post-await callers
  // must pass the payload argument (never read back data state after await).
  // Poll uses the existing finalized-module predicate shape (:899-909 area).
  type CommitHint =
    | { kind: "bootstrap" }
    | { kind: "poll" }
    | { kind: "startModule"; moduleId: string }
    | { kind: "submitModule" }
    | { kind: "terminal" };
  function decideCommitRouteAction(
    preState: typeof state,
    payload: AssessmentDeliveryBootstrap,
    hint: CommitHint,
  ) {
    switch (hint.kind) {
      case "bootstrap":
        return preState.phase === "loading"
          ? ({ type: "bootstrapLoaded", assessmentId: payload.versionId } as const)
          : null;
      case "poll": {
        if (payload.result && preState.phase !== "complete") {
          return {
            type: "recover",
            state: {
              phase: "complete",
              scheduleId,
              candidateId,
              assessmentId: payload.versionId,
              resultId: payload.result.id,
            },
          } as const;
        }
        if (
          (preState.phase === "module" || preState.phase === "review") &&
          "moduleKey" in preState
        ) {
          const currentModule = payload.sections
            .flatMap((section) => section.modules)
            .find((candidate) => candidate.moduleKey === preState.moduleKey);
          const attempt = currentModule
            ? findAttemptForModule(payload, currentModule.id)
            : undefined;
          if (attempt && matchesFinalModuleState(attempt.state)) {
            const nextAttempt = findPendingAttempt(payload);
            const nextModule = moduleForAttempt(payload, nextAttempt);
            if (nextModule && nextModule.moduleKey !== preState.moduleKey) {
              return { type: "showDirections" } as const;
            }
          }
        }
        return null;
      }
      default:
        return null;
    }
  }

  // Phase 04 commit layer (C1 atomic data+phase rule): the single entry
  // point every post-await payload funnels through. acceptPayloadAndRoute
  // keeps the legacy applyPayload signature (boolean; 304 stays null at the
  // refresh layer) and runs setData + the at-most-one phase dispatch in the
  // same synchronous tick so React 18+ batches them into one render. The
  // hint selects the route decision; startModule/submitModule/terminal hints
  // commit data here and dispatch via their existing call-site logic in the
  // same tick (see startPendingModule/submitModule below).
  const acceptPayloadAndRoute = useCallback(
    (
      payload: AssessmentDeliveryBootstrap,
      hint: CommitHint = { kind: "poll" },
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
      if (current && isEquivalentBootstrap(current, payload)) return false;
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
      hydrateBootstrap(payload);
      const action = decideCommitRouteAction(preState, merged, hint);
      if (action) dispatch(action);
      return true;
    },
    [attemptId, candidateId, hydrateBootstrap, renderIdentityGeneration, scheduleId]
  );

  const applyPayload = useCallback(
    (payload: AssessmentDeliveryBootstrap): boolean =>
      acceptPayloadAndRoute(payload, { kind: "poll" }),
    [acceptPayloadAndRoute]
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
    async (surfaceError = false, ifNoneMatch?: string | null) => {
      try {
        const payload = await satDeliveryGateway.bootstrap(scheduleId, attemptId, ifNoneMatch ?? null);
        // Phase 04: poll-hint commit — 304, stale, and equivalent payloads
        // all surface as null (no-change), exactly like the 304 path below.
        return acceptPayloadAndRoute(payload, { kind: "poll" }) ? payload : null;
      } catch (loadError) {
        // A 304 (not modified) is not a failure: no new payload, no error.
        if (hasBackendStatusCode(loadError, 304)) return null;
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
  // erroring (2s → 4s → 8s … capped at the live 20s cadence) with jitter,
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
    const schedule = () => {
      if (stopped) return;
      const baseMs = liveSocketConnected ? 20_000 : 2_000;
      const failures = pollFailuresRef.current;
      const backoffMs = Math.min(baseMs * 2 ** Math.min(failures, 3), 20_000);
      // Full-jitter: spread the cohort reconnect herd across the window.
      const intervalMs = backoffMs / 2 + Math.random() * (backoffMs / 2);
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
          void refresh(false).then(
            () => { pollFailuresRef.current = 0; },
            () => { pollFailuresRef.current += 1; },
          ).finally(schedule);
        };
        window.addEventListener("online", onOnline);
        return;
      }
      void refresh(false, pollEtagRef.current).then(
        (payload) => {
          pollFailuresRef.current = 0;
          // Phase 04 dead-store note (documented, not fixed): the typed
          // AssessmentDeliveryBootstrap payload carries no `etag` field, so
          // this read is always undefined and pollEtagRef stays null. The
          // poll-skip layer (isEquivalentBootstrap) is the real no-change
          // path; fetch/ETag plumbing stays owned by Phase 02.
          const etag = (payload as { etag?: unknown } | null)?.etag;
          if (typeof etag === "string" && etag) pollEtagRef.current = etag;
        },
        () => { pollFailuresRef.current += 1; },
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
    // jitter / offline semantics unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            eliminatedOptionIds: [...response.eliminatedOptions],
            annotations: normalizeSatAnnotations(response.annotations),
          },
        });
      }
    },
    [persistence.visibleDrafts, state]
  );

  const startModuleFrom = useCallback(
    (payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => {
      const section = sectionForModule(payload, module.id);
      const attempt = findAttemptForModule(payload, module.id);
      if (!section || !attempt?.startedAt) return;
      const timing = timingForAttempt(payload, attempt);
      dispatch({
        type: "routeToModule",
        sectionKey: section.sectionKey === "math" ? "math" : "reading-writing",
        moduleKey: module.moduleKey,
        questionIds: module.questions.map((question) => question.examQuestionId),
        startedAt: timing.startedAt,
        endsAt: timing.endsAt,
        toolCapabilities: toSatToolCapabilities(resolveSatExamToolPolicy(section.sectionKey === "math" ? "math" : "reading-writing", module.toolPolicy)),
      });
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
    running: data?.scheduleRuntimeStatus === "live" && effectiveTiming?.stageStatus === "live",
  });

  const pendingModule = useMemo(() => (data ? findCurrentModule(data) : null), [data]);
  const pendingAttempt = useMemo(
    () => (data && pendingModule ? findAttemptForModule(data, pendingModule.id) : undefined),
    [data, pendingModule]
  );
  const cohortRuntimeTiming = isCohortTimingModel(effectiveTiming?.timingModel);
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
    ? cohortRuntimeTiming
      ? nextSectionStartAt
        ? nextSectionStartSeconds
        : 0
      : breakRemainingSeconds(data, pendingAttempt, snapshotReceivedAt, now)
    : 0;
  const pendingSection = data && pendingModule ? sectionForModule(data, pendingModule.id) : null;
  const pendingExpectedStageKey =
    pendingSection && pendingModule
      ? isSectionKeyedCohortModel(effectiveTiming?.timingModel)
        ? pendingSection.sectionKey
        : `${pendingSection.sectionKey}:${pendingModule.adaptiveRole === "base" ? "m1" : "m2"}`
      : null;
  const pendingStageReady =
    !cohortRuntimeTiming ||
    (effectiveTiming?.stageKey === pendingExpectedStageKey &&
      effectiveTiming?.stageStatus === "live" &&
      data?.scheduleRuntimeStatus === "live");
  // Waiting for the scheduled end of the current section (the student finished
  // their module early while the shared clock is still running). Once the
  // server names the next section's start this window is over and the break
  // countdown above takes over.
  const pendingSectionWaitSeconds =
    data &&
    pendingSection &&
    effectiveTiming &&
    isSectionKeyedCohortModel(effectiveTiming.timingModel) &&
    data.scheduleRuntimeStatus === "live" &&
    !waitingForNextSection &&
    effectiveTiming.stageKey &&
    effectiveTiming.stageKey !== pendingSection.sectionKey
      ? authoritativeRemainingSeconds
      : 0;

  const startPendingModule = useCallback(async () => {
    if (!data || !pendingModule || isStarting) return;
    const generation = identityGenerationRef.current;
    setIsStarting(true);
    setError(null);
    try {
      const payload = await satDeliveryGateway.startModule(scheduleId, attemptId, {
        moduleId: pendingModule.id,
      });
      // Phase 04 atomic start: commit data first (stale/equivalent losers
      // still route locally — startModule responses carry the started
      // attempt even at equal runtimeRevision).
      if (identityGenerationRef.current !== generation) return;
      if (payload.scheduleId !== scheduleId || payload.attempt.id !== attemptId) return;
      const current = dataRef.current;
      const timing = mergeAuthoritativeTiming(current?.timing ?? null, payload.timing);
      const merged = timing === payload.timing ? payload : { ...payload, timing };
      dataRef.current = merged;
      setData(merged);
      setSnapshotReceivedAt(Date.now());
      setResult(payload.result);
      setError(null);
      hydrateBootstrap(payload);
      const activeAttempt = findActiveAttempt(merged);
      const activeModule = moduleForAttempt(merged, activeAttempt);
      if (activeModule) startModuleFrom(merged, activeModule);
    } catch (startError) {
      if (identityGenerationRef.current === generation) {
        setError(
          startError instanceof Error ? startError.message : "The SAT module could not be started."
        );
      }
    } finally {
      if (identityGenerationRef.current === generation) setIsStarting(false);
    }
  }, [attemptId, data, hydrateBootstrap, isStarting, pendingModule, scheduleId, startModuleFrom]);

  useEffect(() => {
    if (
      !data ||
      state.phase !== "directions" ||
      !pendingModule ||
      !shouldAutoStartInitialModule(
        data,
        pendingModule,
        pendingSection?.displayOrder ?? null,
        pendingStageReady
      )
    ) {
      return;
    }
    const autoStartKey = `${attemptId}:${pendingModule.id}`;
    if (initialAutoStartKeyRef.current === autoStartKey) return;
    initialAutoStartKeyRef.current = autoStartKey;
    void startPendingModule();
  }, [
    attemptId,
    data,
    pendingModule,
    pendingSection,
    pendingStageReady,
    startPendingModule,
    state.phase,
  ]);

  useEffect(() => {
    if (
      !data ||
      !pendingModule ||
      !["break", "directions"].includes(state.phase) ||
      isStarting ||
      !shouldAutoStartNextSectionAfterBreak(
        data,
        pendingModule,
        pendingSection?.displayOrder ?? null,
        pendingStageReady,
        pendingBreakSeconds,
        pendingSectionWaitSeconds
      )
    ) {
      return;
    }

    const autoStartKey = `${attemptId}:${pendingModule.id}:${effectiveTiming?.runtimeRevision ?? "legacy"}`;
    const lastAttempt = nextSectionAutoStartRef.current;
    const attemptedAt = Date.now();
    if (lastAttempt?.key === autoStartKey && attemptedAt - lastAttempt.attemptedAt < 2_000) {
      return;
    }

    nextSectionAutoStartRef.current = { key: autoStartKey, attemptedAt };
    void startPendingModule();
  }, [
    attemptId,
    data,
    effectiveTiming?.runtimeRevision,
    isStarting,
    now,
    pendingBreakSeconds,
    pendingModule,
    pendingSection,
    pendingSectionWaitSeconds,
    pendingStageReady,
    startPendingModule,
    state.phase,
  ]);

  const finalizeAssessment = useCallback(
    (generation: number, assessmentId: string): Promise<AssessmentResult | null> => {
      const existing = finalizationInFlightRef.current;
      if (existing) return existing;

      const operation = (async () => {
        emitStudentObservabilityMetric('sat_finalize_attempt', { scheduleId, attemptId });
        await persistenceRef.current.flush();
        if (identityGenerationRef.current !== generation) return null;
        await persistenceRef.current.submit();
        if (identityGenerationRef.current !== generation) return null;
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
      })();
      finalizationInFlightRef.current = operation;
      void operation.then(
        () => {
          if (finalizationInFlightRef.current === operation) {
            finalizationInFlightRef.current = null;
          }
        },
        () => {
          if (finalizationInFlightRef.current === operation) {
            finalizationInFlightRef.current = null;
          }
        }
      );
      return operation;
    },
    [attemptId, scheduleId]
  );

  useEffect(() => {
    if (
      !data ||
      data.result ||
      state.phase !== "directions" ||
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
    const recoveryKey = `${attemptId}:${data.versionId}:${data.attempt.moduleAttempts
      .map(
        (moduleAttempt) => `${moduleAttempt.id}:${moduleAttempt.state}:${moduleAttempt.revision}`
      )
      .join(",")}`;
    if (finalizationRecoveryKeyRef.current === recoveryKey) return;
    finalizationRecoveryKeyRef.current = recoveryKey;
    const generation = identityGenerationRef.current;
    void finalizeAssessment(generation, data.versionId).catch((finalizationError: unknown) => {
      if (identityGenerationRef.current !== generation) return;
      // Exam-day re-audit defect 2: release the dedupe key so a manual
      // retry (or a later data change) can re-attempt finalization instead
      // of being suppressed forever by the consumed key.
      finalizationRecoveryKeyRef.current = null;
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
      try {
        await persistence.flush();
        if (!isCurrent()) return;
        const next = await satDeliveryGateway.submitModule(scheduleId, attemptId, { moduleId });
        // Phase 04 atomic submit: data + the post-submit route decision
        // commit in the same tick (decision computed from the `next`
        // payload argument, never from data state after await). Stale-
        // identity payloads still drop silently.
        if (!isCurrent()) return;
        if (next.scheduleId !== scheduleId || next.attempt.id !== attemptId) return;
        {
          const current = dataRef.current;
          const timing = mergeAuthoritativeTiming(current?.timing ?? null, next.timing);
          const merged = timing === next.timing ? next : { ...next, timing };
          const nextAttempt = findPendingAttempt(merged);
          const nextModule = moduleForAttempt(merged, nextAttempt);
          const submitAction = !nextModule
            ? ({ type: "submit" } as const)
            : (() => {
                const committed = dataRef.current;
                const currentSection = committed
                  ? sectionForModule(committed, moduleId)
                  : null;
                const nextSection = sectionForModule(merged, nextModule.id);
                return currentSection && nextSection && nextSection.id !== currentSection.id
                  ? ({
                      type: "startBreak",
                      nextSectionKey:
                        nextSection.sectionKey === "math" ? "math" : "reading-writing",
                      resumeAt: nextAttempt?.availableAt ?? merged.serverNow,
                    } as const)
                  : ({ type: "showDirections" } as const);
              })();
          dataRef.current = merged;
          setData(merged);
          setSnapshotReceivedAt(Date.now());
          setResult(merged.result);
          setError(null);
          hydrateBootstrap(merged);
          dispatch(submitAction);
          if (submittedModuleAttemptId) {
            clearCalculatorWorkspace(
              calculatorWorkspaceKey(scheduleId, attemptId, submittedModuleAttemptId)
            );
          }
          if (!nextModule) {
            const finalResult = await finalizeAssessment(generation, merged.versionId);
            if (!finalResult || !isCurrent()) return;
            clearCalculatorWorkspacesForAttempt(scheduleId, attemptId);
            clearSatReadingPreferences(scheduleId, attemptId);
            return;
          }
          return;
        }
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
        setError(submitError instanceof Error ? submitError.message : "Module submission failed.");
      } finally {
        if (isCurrent()) setIsSubmitting(false);
      }
    },
    [
      attemptId,
      data,
      hydrateBootstrap,
      isSubmitting,
      persistence,
      refresh,
      finalizeAssessment,
      scheduleId,
    ]
  );

  // All modules are finalized but no result exists (recovery effect fired
  // from directions): the finalize call failed and polling alone cannot
  // create a result. Exam-day re-audit defect 2 exposes the same retry here.
  const recoveryNeedsRetry =
    state.phase === "directions" &&
    !isSubmitting &&
    Boolean(error) &&
    Boolean(data) &&
    !data?.result &&
    !findPendingAttempt(data as AssessmentDeliveryBootstrap) &&
    (data as AssessmentDeliveryBootstrap).attempt.moduleAttempts.length > 0 &&
    (data as AssessmentDeliveryBootstrap).attempt.moduleAttempts.every((moduleAttempt) =>
      matchesFinalModuleState(moduleAttempt.state),
    );
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
  const serverClockOffsetMs = data?.timing.serverNow
    ? Date.parse(data.timing.serverNow) - snapshotReceivedAt
    : 0;
  const cohortStageRunning = !isCohortTimingModel(effectiveTiming?.timingModel)
    ? true
    : data?.scheduleRuntimeStatus === "live" && effectiveTiming?.stageStatus === "live";
  const personalModuleRemainingSeconds = stateModuleAttempt
    ? personalModuleCountdown(stateModuleAttempt, snapshotReceivedAt, now, serverClockOffsetMs, cohortStageRunning)
    : 0;
  // D2: min(personal, section) is the STUDENT-FACING allotment only. The
  // server's section clock is the sole expiry authority — a module past its
  // personal clock is not force-closed while its section is live, so this
  // minimum never has to agree with a server-side deadline.
  // A section-keyed cohort model publishes one clock for the whole section, so
  // the student's allotment is min(their module, the section) — but only while
  // the published stage is the section they are actually in. A stage-keyed
  // cohort model already publishes the running module's own clock.
  const remainingSeconds = effectiveTiming && isSectionKeyedCohortModel(effectiveTiming.timingModel)
    ? stateSection && effectiveTiming.stageKey === stateSection.sectionKey
      ? Math.min(personalModuleRemainingSeconds, authoritativeRemainingSeconds)
      : 0
    : isCohortTimingModel(effectiveTiming?.timingModel)
      ? authoritativeRemainingSeconds
      : personalModuleRemainingSeconds;

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
    // Phase 04 skew guard: a skew frame that looks like 0 (missing attempt
    // resolves through the personal-countdown fallback) must neither submit
    // nor consume timeoutSubmissionKeyRef — submit fires only from a
    // resolved frame. Key stays moduleId:attemptId-scoped, exactly once.
    if (!data || !findAttemptForModule(data, stateModule.id)) return;
    const key = `${stateModule.id}:${stateModuleAttempt.id}`;
    if (remainingSeconds > 0) {
      if (timeoutSubmissionKeyRef.current !== key) timeoutSubmissionKeyRef.current = null;
      return;
    }
    if (stateModuleAttempt.pausedAt || timeoutSubmissionKeyRef.current === key) return;
    timeoutSubmissionKeyRef.current = key;
    setAutoSubmitted(true);
    void submitModule(stateModule.id);
  }, [data, remainingSeconds, state.phase, stateModule, stateModuleAttempt, submitModule]);

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

  const setAnswer = useCallback(
    (questionId: string, answer: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      const next = { ...current, answer };
      const question = stateModule?.questions.find(
        (candidate) => candidate.examQuestionId === questionId
      );
      const interactionType =
        question?.questionType === "student_produced_response" ? "typing" : "discrete";
      dispatch({ type: "setAnswer", questionId, value: answer });
      persistence.save(next, saveContext(interactionType));
    },
    [currentResponse, persistence, saveContext, stateModule]
  );

  const toggleReview = useCallback(
    (questionId: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      const next = { ...current, markedForReview: !current.markedForReview };
      dispatch({ type: "setReviewFlag", questionId, flagged: next.markedForReview });
      persistence.save(next, saveContext("discrete"));
    },
    [currentResponse, persistence, saveContext]
  );

  const toggleEliminatedOption = useCallback(
    (questionId: string, optionId: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      const eliminatedOptionIds = current.eliminatedOptionIds.includes(optionId)
        ? current.eliminatedOptionIds.filter((candidate) => candidate !== optionId)
        : [...current.eliminatedOptionIds, optionId];
      const next = { ...current, eliminatedOptionIds };
      dispatch({ type: "toggleEliminatedOption", questionId, optionId });
      persistence.save(next, saveContext("discrete"));
    },
    [currentResponse, persistence, saveContext]
  );

  const setAnnotationNote = useCallback(
    (questionId: string, note: string) => {
      const current = currentResponse(questionId);
      if (!current) return;
      const annotations = { ...current.annotations, legacyQuestionNote: note.slice(0, 2_000) };
      const next = { ...current, annotations };
      dispatch({ type: "setAnnotations", questionId, annotations });
      persistence.save(next, saveContext("typing"));
    },
    [currentResponse, persistence, saveContext]
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
