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
import {
  calculatorWorkspaceKey,
  clearCalculatorWorkspace,
  clearCalculatorWorkspacesForAttempt,
} from "../infrastructure/satCalculatorWorkspace";
import { clearSatReadingPreferences } from "../infrastructure/satReadingPreferencesStore";
import { createSatRunnerState, satRunnerReducer } from "../application/satRunnerReducer";
// SAT-005/007: commit-to-phase routing and conflict policy live in application/
// (pure); the hook only wires them to state and the gateway.
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
  satModuleWindow,
  satPersonalClockRunning,
  satSectionWaitSeconds,
  satSharedClockRunning,
  satStageReady,
} from "../application/satTimingPolicy";
import { satPollDelayMs } from "../application/satPollCadence";
import {
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
import { deriveSatTemporalSnapshot, type SatTemporalModel } from "../timing/satTemporalModel";

/**
 * Break-end pull window (Phase 3): at most one forced refresh per runtime
 * revision, and never faster than this. The section advance is system-driven,
 * so it does not ride the parent poll's control-command fast lane, and the
 * student would otherwise sit at 0:00 until that poll's steady cadence fires.
 */
const SAT_BREAK_END_PULL_WINDOW_MS = 2_000;
const SAT_PERSONAL_MIN_ENTRY_LEAD_MS = 1_000;

/**
 * How many edits the entry-visibility window may hold before it stops queueing.
 * The window is a paint acknowledgement (sub-second when the device can paint),
 * so this only bounds a device that never manages to acknowledge; keeping the
 * newest edits is what makes a slow device lose least.
 */
const SAT_ENTRY_ACK_DRAFT_LIMIT = 64;

type SatEntryAckDraft = {
  questionId: string;
  change: SatResponseDraftChange;
  interactionType: "typing" | "discrete";
};

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

async function waitUntilPersonalStart(startsAt: string, serverOffsetMs: number): Promise<boolean> {
  const target = Date.parse(startsAt);
  if (!Number.isFinite(target)) return false;
  while (target > Date.now() + serverOffsetMs) {
    if (isDocumentHidden()) return false;
    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.min(100, target - (Date.now() + serverOffsetMs))));
  }
  return !isDocumentHidden();
}

function waitForPersonalPaintOpportunity(): Promise<boolean> {
  if (isDocumentHidden()) return Promise.resolve(false);
  return new Promise((resolve) => {
    let frame = 0;
    const finish = (visible: boolean) => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (frame) window.cancelAnimationFrame(frame);
      resolve(visible);
    };
    const onVisibilityChange = () => {
      if (isDocumentHidden()) finish(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    frame = window.requestAnimationFrame(() => finish(!isDocumentHidden()));
  });
}

function personalStartHasFullDisplayedSecond(startsAt: string, serverOffsetMs: number): boolean {
  const elapsed = Date.now() + serverOffsetMs - Date.parse(startsAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 1_000 && !isDocumentHidden();
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
  const now = Date.now();
  const [, wakeAtTemporalBoundary] = useState(0);
  const timeoutTransitionKeyRef = useRef<string | null>(null);
  const visibleEntryAckRef = useRef<string | null>(null);
  // Edits made inside the entry-visibility window (entry confirmed, first active
  // frame not yet acknowledged). They are held in order and replayed, never
  // dropped: that window is live authored time, and dropping a keystroke there
  // silently costs the candidate the seconds they were given.
  const entryAckDraftsRef = useRef<SatEntryAckDraft[]>([]);
  const [timeoutTransitionKey, setTimeoutTransitionKey] = useState<string | null>(null);
  const [timeoutTransitionStarted, setTimeoutTransitionStarted] = useState(false);
  const personalBreakEntryRef = useRef<string | null>(null);
  const visibleBreakAckRef = useRef<string | null>(null);
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
  const hydrateModuleResponsesRef = useRef<
    ((payload: AssessmentDeliveryBootstrap, module: AssessmentDeliveryModule) => void) | null
  >(null);

  useEffect(() => {
    setData(null);
    setResult(null);
    setError(null);
    setIsSubmitting(false);
    setIsStarting(false);
    setTimeoutTransitionStarted(false);
    setTimeoutTransitionKey(null);
    setAnswersRecorded(false);
    timeoutTransitionKeyRef.current = null;
    visibleEntryAckRef.current = null;
    entryAckDraftsRef.current = [];
    personalBreakEntryRef.current = null;
    visibleBreakAckRef.current = null;
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
    async (
      surfaceError = false,
      /**
       * Transport-outcome probe. `refresh` resolves for a failed fetch (every
       * other caller, including `void refresh(...)`, depends on that), so the
       * recovery loop cannot infer success from the resolution: poll failures
       * have to be reported out of band or the backoff never engages.
       */
      onTransportOutcome?: (ok: boolean) => void,
    ) => {
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
        const payload = await satDeliveryGateway.bootstrap(scheduleId, attemptId);
        onTransportOutcome?.(true);
        // Phase 04: poll-hint commit — stale and equivalent payloads surface
        // as null (no-change).
        return acceptPayloadAndRoute(payload, { kind: "poll" }) ? payload : null;
      } catch (loadError) {
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

  // Recovery polling: recurring interval (not one-shot), backs off while
  // erroring (2s → 4s → 8s … → 16s, the satPollCadence window) with jitter,
  // suspends while the browser reports offline (reconnect is event-driven,
  // not poll-driven), and skips work the server already answered via ETag.
  // The offline listener is always cleaned up — a one-shot addEventListener
  // without removeEventListener leaks a stale closure per poll cycle.
  const pollFailuresRef = useRef(0);
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
          void refresh(false, recordTransportOutcome).finally(schedule);
        };
        // One-shot: exactly one reconnect per outage. A handler that stays
        // registered after firing would make every later reconnect poll once
        // per past outage and schedule a timer per handler (doubling the loop).
        window.addEventListener("online", onOnline, { once: true });
        return;
      }
      void refresh(false, recordTransportOutcome).catch(
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
    const key = `${data.versionId}:${data.timing.runtimeRevision}:${state.phase}:${activeModule.id}`;
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
  const pendingBreakSeconds = data
    ? isSatPersonalTimingModel(effectiveTiming?.timingModel)
      ? (() => {
          const activeBreak = data.attempt.personalBreaks?.find((candidate) =>
            candidate.state !== "completed",
          );
          if (!activeBreak || activeBreak.state !== "active" || !activeBreak.deadlineAt) return 0;
          if (activeBreak.pausedAt) return Math.max(0, activeBreak.remainingSeconds);
          const deadline = Date.parse(activeBreak.deadlineAt);
          const breakOffset = serverClockOffsetMs;
          const startsAt = activeBreak.startsAt ? Date.parse(activeBreak.startsAt) : Number.NaN;
          if (Number.isFinite(startsAt) && startsAt > now + breakOffset) return 0;
          return Number.isFinite(deadline)
            ? Math.max(0, Math.ceil((deadline - (now + breakOffset)) / 1_000))
            : 0;
        })()
      : satBreakCountdownSeconds({
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
  const personalBreak = data && isSatPersonalTimingModel(effectiveTiming?.timingModel)
    ? data.attempt.personalBreaks?.find((candidate) => candidate.state !== "completed") ?? null
    : null;
  const breakGateSeconds = personalBreak
    ? personalBreak.state === "completed"
      ? 0
      : Math.max(1, personalBreak.state === "active" ? pendingBreakSeconds : personalBreak.durationSeconds)
    : pendingBreakSeconds;
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

  /**
   * The shared section clock the student is still on while the next module
   * opens, or null when this frame has no authority to quote one.
   *
   * `remainingSeconds` is derived from the ACTIVE module's section, so during a
   * handoff (no active module) a section-keyed cohort frame resolves it to 0 —
   * which is why the retained exam frame used to show a dead countdown. The
   * section clock is the honest number there: it is the clock that governs the
   * section the student is still inside, and no module clock may be invented for
   * a module that has not started. Null (never 0) when the published stage names
   * some other section, so a surface can leave the number out instead of faking
   * one.
   */
  const handoffSeconds =
    pendingSection && effectiveTiming?.stageKey &&
    (effectiveTiming.stageKey === pendingSection.sectionKey ||
      effectiveTiming.stageKey.startsWith(`${pendingSection.sectionKey}:`))
      ? authoritativeRemainingSeconds
      : null;

  // Keep the predecessor's timeout attribution for the module-advance metric.
  // Routing and automatic entry follow the server's selected next module.
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
      let payload = await withEntryControlEpoch((epoch) => satDeliveryGateway.startModule(scheduleId, attemptId, {
        moduleId: pendingModule.id,
        ...controlEpochField(epoch),
      }));
      if (identityGenerationRef.current !== generation) return "noop";
      if (payload.scheduleId !== scheduleId || payload.attempt.id !== attemptId) return "noop";
      if (isSatPersonalTimingModel(payload.timing.timingModel)) {
        if (!satDeliveryGateway.enterModule || !satDeliveryGateway.markStageVisible) {
          throw new Error("Personal SAT entry is unavailable. Refresh and try again.");
        }
        let enteredPayload: AssessmentDeliveryBootstrap | null = null;
        for (let rearm = 0; rearm < 4; rearm += 1) {
          const offerAttempt = findAttemptForModule(payload, pendingModule.id);
          const offerGeneration = offerAttempt?.entryGeneration;
          const startsAt = offerAttempt?.entryStartsAt;
          if (offerGeneration == null || !startsAt) {
            throw new Error("The SAT module start offer is incomplete. Refresh and try again.");
          }
          const offerReceivedAt = Date.now();
          const offerOffset = satClockOffsetMs(payload.serverNow, offerReceivedAt);
          const offerLead = Date.parse(startsAt) - (Date.now() + offerOffset);
          if (
            isDocumentHidden() ||
            !Number.isFinite(offerLead) ||
            offerLead < SAT_PERSONAL_MIN_ENTRY_LEAD_MS
          ) {
            payload = await withEntryControlEpoch((epoch) => satDeliveryGateway.startModule(scheduleId, attemptId, {
              moduleId: pendingModule.id,
              generation: offerGeneration,
              ...controlEpochField(epoch),
            }));
            continue;
          }

          const confirmed = await withEntryControlEpoch((epoch) => satDeliveryGateway.enterModule!(scheduleId, attemptId, {
              moduleId: pendingModule.id,
              generation: offerGeneration,
              ...controlEpochField(epoch),
          }));
          if (identityGenerationRef.current !== generation) return "noop";
          if (confirmed.scheduleId !== scheduleId || confirmed.attempt.id !== attemptId) return "noop";
          const confirmedAt = Date.now();
          const confirmedOffset = satClockOffsetMs(confirmed.serverNow, confirmedAt);
          const confirmedLead = Date.parse(startsAt) - (Date.now() + confirmedOffset);
          if (
            isDocumentHidden() ||
            !Number.isFinite(confirmedLead) ||
            confirmedLead < SAT_PERSONAL_MIN_ENTRY_LEAD_MS
          ) {
            payload = await withEntryControlEpoch((epoch) => satDeliveryGateway.startModule(scheduleId, attemptId, {
              moduleId: pendingModule.id,
              generation: offerGeneration,
              ...controlEpochField(epoch),
            }));
            continue;
          }
          const visibleAtStart = await waitUntilPersonalStart(startsAt, confirmedOffset);
          if (
            !visibleAtStart ||
            !await waitForPersonalPaintOpportunity() ||
            !personalStartHasFullDisplayedSecond(startsAt, confirmedOffset)
          ) {
            payload = await withEntryControlEpoch((epoch) => satDeliveryGateway.startModule(scheduleId, attemptId, {
              moduleId: pendingModule.id,
              generation: offerGeneration,
              ...controlEpochField(epoch),
            }));
            continue;
          }
          const estimatedServerNow = new Date(Date.now() + confirmedOffset).toISOString();
          enteredPayload = {
            ...confirmed,
            serverNow: estimatedServerNow,
            timing: { ...confirmed.timing, serverNow: estimatedServerNow },
          };
          break;
        }
        if (!enteredPayload) {
          throw new Error("The SAT module could not be prepared. Ask the proctor to re-arm it.");
        }
        payload = enteredPayload;
      }
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
    withEntryControlEpoch,
  ]);

  const startPersonalBreak = useCallback(async (): Promise<void> => {
    if (
      !personalBreak ||
      personalBreak.state === "active" ||
      personalBreak.state === "completed" ||
      !satDeliveryGateway.startBreak ||
      !satDeliveryGateway.enterBreak ||
      isStarting
    ) return;
    const generationAtCall = identityGenerationRef.current;
    setIsStarting(true);
    setError(null);
    try {
      let offerPayload = await withEntryControlEpoch((epoch) => satDeliveryGateway.startBreak!(scheduleId, attemptId, personalBreak.id, {
        breakId: personalBreak.id,
        generation: personalBreak.entryGeneration,
        ...controlEpochField(epoch),
      }));
      let acceptedPayload: AssessmentDeliveryBootstrap | null = null;
      for (let rearm = 0; rearm < 4; rearm += 1) {
        if (identityGenerationRef.current !== generationAtCall) return;
        const offer = offerPayload.attempt.personalBreaks?.find((item) => item.id === personalBreak.id);
        if (!offer || offer.entryGeneration <= 0 || !offer.entryStartsAt) {
          throw new Error("The scheduled break offer is incomplete. Refresh and try again.");
        }
        if (offer.state === "active" && offer.startsAt) {
          acceptedPayload = offerPayload;
          break;
        }
        if (isDocumentHidden()) return;
        const offerReceivedAt = Date.now();
        const offerOffset = satClockOffsetMs(offerPayload.serverNow, offerReceivedAt);
        const lead = Date.parse(offer.entryStartsAt) - (Date.now() + offerOffset);
        if (!Number.isFinite(lead) || lead < SAT_PERSONAL_MIN_ENTRY_LEAD_MS) {
          offerPayload = await withEntryControlEpoch((epoch) => satDeliveryGateway.startBreak!(scheduleId, attemptId, personalBreak.id, {
            breakId: personalBreak.id,
            generation: offer.entryGeneration,
            ...controlEpochField(epoch),
          }));
          continue;
        }
        const confirmed = await withEntryControlEpoch((epoch) => satDeliveryGateway.enterBreak!(scheduleId, attemptId, {
          breakId: personalBreak.id,
          generation: offer.entryGeneration,
          ...controlEpochField(epoch),
        }));
        if (identityGenerationRef.current !== generationAtCall) return;
        const confirmedAt = Date.now();
        const confirmedOffset = satClockOffsetMs(confirmed.serverNow, confirmedAt);
        const confirmedBreak = confirmed.attempt.personalBreaks?.find((item) => item.id === personalBreak.id);
        const confirmedLead = Date.parse(offer.entryStartsAt) - (Date.now() + confirmedOffset);
        if (
          !confirmedBreak ||
          isDocumentHidden() ||
          !Number.isFinite(confirmedLead) ||
          confirmedLead < SAT_PERSONAL_MIN_ENTRY_LEAD_MS
        ) {
          offerPayload = await withEntryControlEpoch((epoch) => satDeliveryGateway.startBreak!(scheduleId, attemptId, personalBreak.id, {
            breakId: personalBreak.id,
            generation: offer.entryGeneration,
            ...controlEpochField(epoch),
          }));
          continue;
        }
        if (!await waitUntilPersonalStart(offer.entryStartsAt, confirmedOffset)) {
          // Keep the break unentered while hidden. The next visible retry
          // reuses the offer or rearms it if its start was missed.
          return;
        }
        if (
          !await waitForPersonalPaintOpportunity() ||
          !personalStartHasFullDisplayedSecond(offer.entryStartsAt, confirmedOffset)
        ) {
          offerPayload = await withEntryControlEpoch((epoch) => satDeliveryGateway.startBreak!(scheduleId, attemptId, personalBreak.id, {
            breakId: personalBreak.id,
            generation: offer.entryGeneration,
            ...controlEpochField(epoch),
          }));
          continue;
        }
        const estimatedServerNow = new Date(Date.now() + confirmedOffset).toISOString();
        acceptedPayload = {
          ...confirmed,
          serverNow: estimatedServerNow,
          timing: { ...confirmed.timing, serverNow: estimatedServerNow },
        };
        break;
      }
      if (!acceptedPayload) throw new Error("The scheduled break could not be prepared. Ask the proctor to re-arm it.");
      acceptPayloadAndRoute(acceptedPayload, { kind: "poll" });
    } catch (breakError) {
      if (identityGenerationRef.current === generationAtCall) {
        setError(breakError instanceof Error ? breakError.message : "The scheduled break could not be started.");
      }
    } finally {
      if (identityGenerationRef.current === generationAtCall) setIsStarting(false);
    }
  }, [acceptPayloadAndRoute, attemptId, isStarting, personalBreak, scheduleId, withEntryControlEpoch]);

  useEffect(() => {
    if (!data || !isSatPersonalTimingModel(data.timing.timingModel)) return;
    if (state.phase !== "directions" && state.phase !== "break") return;
    if (!personalBreak || personalBreak.state === "active" || personalBreak.state === "completed") return;
    void startPersonalBreak();
  }, [data, personalBreak, startPersonalBreak, state.phase]);

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
    sectionDisplayOrder: pendingSection?.displayOrder ?? null,
    stageReady: pendingStageReady,
    breakSeconds: breakGateSeconds,
    sectionWaitSeconds: pendingSectionWaitSeconds,
    phase: state.phase,
  });

  // Phase 4: the entry surface is what the student sees when the break
  // countdown has run out but the module has not opened — recovery state for
  // the surfaces, never a silent 0:00.
  const entrySurface = useSatModuleEntry({
    identity: identityKey,
    enabled: entryDecision.shouldStart,
    entryKey: pendingModule ? `${attemptId}:${pendingModule.id}` : null,
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

  // A personal offer is marked entered only after the active module has had a
  // paint opportunity. This acknowledgment closes the server's rearm window;
  // it never moves the authoritative deadline.
  useEffect(() => {
    const generation = stateModuleAttempt?.entryGeneration;
    if (
      !data ||
      !isSatPersonalTimingModel(data.timing.timingModel) ||
      state.phase !== "module" ||
      !stateModule ||
      generation == null ||
      !stateModuleAttempt?.startedAt ||
      stateModuleAttempt.entryEnteredAt ||
      stateModuleAttempt.pausedAt
    ) return;
    const key = `${attemptId}:${stateModule.id}:${generation}`;
    if (visibleEntryAckRef.current === key) return;
    let cancelled = false;
    let frame = 0;
    const scheduleAckAfterPaint = () => {
      if (cancelled || document.visibilityState === "hidden" || frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (cancelled || document.visibilityState === "hidden") return;
        visibleEntryAckRef.current = key;
        if (!satDeliveryGateway.markStageVisible) return;
        void withEntryControlEpoch((epoch) => satDeliveryGateway.markStageVisible!(scheduleId, attemptId, {
          moduleId: stateModule.id,
          generation,
          ...controlEpochField(epoch),
        })).then((payload) => {
          if (!cancelled && identityGenerationRef.current === renderIdentityGeneration) {
            acceptPayloadAndRoute(payload, { kind: "poll" });
          }
        }).catch(() => {
          if (visibleEntryAckRef.current === key) visibleEntryAckRef.current = null;
        });
      });
    };
    scheduleAckAfterPaint();
    document.addEventListener("visibilitychange", scheduleAckAfterPaint);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", scheduleAckAfterPaint);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [
    acceptPayloadAndRoute,
    attemptId,
    data,
    renderIdentityGeneration,
    scheduleId,
    state.phase,
    stateModule,
    stateModuleAttempt,
    withEntryControlEpoch,
  ]);

  // The acknowledgment means "the candidate has seen the break's first ACTIVE
  // frame", so it cannot precede the break's own start. `pendingBreakSeconds` is
  // exactly that clock (the server's start is in the past and the deadline is
  // counting), so acknowledging earlier would close the server's re-arm window
  // while the candidate is still on the pre-start surface — the module path is
  // gated the same way, by its phase.
  useEffect(() => {
    if (
      !data ||
      !isSatPersonalTimingModel(data.timing.timingModel) ||
      !personalBreak ||
      personalBreak.state !== "active" ||
      !personalBreak.startsAt ||
      personalBreak.entryEnteredAt ||
      pendingBreakSeconds <= 0 ||
      !satDeliveryGateway.markBreakVisible
    ) return;
    const key = `${attemptId}:${personalBreak.id}:${personalBreak.entryGeneration}`;
    if (visibleBreakAckRef.current === key) return;
    let cancelled = false;
    let frame = 0;
    const scheduleAckAfterPaint = () => {
      if (cancelled || document.visibilityState === "hidden" || frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (cancelled || document.visibilityState === "hidden") return;
        visibleBreakAckRef.current = key;
        void withEntryControlEpoch((epoch) => satDeliveryGateway.markBreakVisible!(scheduleId, attemptId, {
          breakId: personalBreak.id,
          generation: personalBreak.entryGeneration,
          ...controlEpochField(epoch),
        })).then((payload) => {
          if (!cancelled && identityGenerationRef.current === renderIdentityGeneration) {
            acceptPayloadAndRoute(payload, { kind: "poll" });
          }
        }).catch(() => {
          if (visibleBreakAckRef.current === key) visibleBreakAckRef.current = null;
        });
      });
    };
    scheduleAckAfterPaint();
    document.addEventListener("visibilitychange", scheduleAckAfterPaint);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", scheduleAckAfterPaint);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [acceptPayloadAndRoute, attemptId, data, pendingBreakSeconds, personalBreak, renderIdentityGeneration, scheduleId, withEntryControlEpoch]);

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
  // The middle clause is the entry-visibility window: the server confirmed the
  // entry (so the clock is running and the module is the candidate's) but has
  // not yet been told the first active frame was painted. Named separately
  // because that is the one blocked state whose edits are queued rather than
  // refused — see commitResponseChange.
  const entryVisibilityAckPending =
    isSatPersonalTimingModel(data?.timing.timingModel) &&
    Boolean(stateModuleAttempt?.entryGeneration) &&
    !stateModuleAttempt?.entryEnteredAt;
  const answerInteractionBlocked =
    timeoutTransitionPending ||
    entryVisibilityAckPending ||
    (activeModuleAttemptKey !== null &&
      expiryRemainingSeconds !== null &&
      expiryRemainingSeconds <= 0);

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
      const breakOffset = satClockOffsetMs(effectiveTiming?.serverNow ?? data?.timing.serverNow ?? null, snapshotReceivedAt);
      addDeadline(personalBreak.startsAt, breakOffset);
      addDeadline(personalBreak.deadlineAt, breakOffset);
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
      const last = personal ? personalBreakEndPullRef.current : breakEndPullRef.current;
      if (last?.key === key || (last && firedAt - last.firedAt < SAT_BREAK_END_PULL_WINDOW_MS)) return;
      if (personal) personalBreakEndPullRef.current = { key, firedAt };
      else breakEndPullRef.current = { key, firedAt };
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
    void persistenceRef.current.flush().catch(() => undefined).then(() => {
      if (identityGenerationRef.current !== generation) return;
      // This read is a recovery nudge only. Server reconciliation finalizes the module.
      void refresh(true);
    });
  }, [data, refresh, state.phase, stateModule, stateModuleAttempt]);

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
      if (answerInteractionBlocked) {
        // Held, not dropped, while the module waits for its visibility
        // acknowledgement: the runner is on screen and the clock is running, so
        // these are the candidate's real answers. Every other blocked state
        // (timeout transition, expiry) keeps refusing, because there the module
        // is closing and a late edit must not land.
        if (entryVisibilityAckPending) {
          const queue = entryAckDraftsRef.current;
          if (queue.length < SAT_ENTRY_ACK_DRAFT_LIMIT) {
            queue.push({ questionId, change, interactionType });
          }
        }
        return null;
      }
      const current = currentResponse(questionId);
      if (!current) return null;
      const next = applySatResponseDraftChange(current, change);
      dispatch({ type: "replaceResponse", response: next });
      persistence.save(next, saveContext(interactionType));
      return next;
    },
    [answerInteractionBlocked, currentResponse, entryVisibilityAckPending, persistence, saveContext]
  );

  // Replay the edits held during the entry-visibility window, in the order the
  // candidate made them. Changes to one question fold into each other so a
  // burst cannot lose an earlier mutation, and a question the runner no longer
  // holds (`currentResponse` is null once the phase moved on) drops out instead
  // of resurrecting an answer into a module that already closed.
  useEffect(() => {
    if (entryVisibilityAckPending) return;
    const queued = entryAckDraftsRef.current;
    if (queued.length === 0) return;
    entryAckDraftsRef.current = [];
    const folded = new Map<string, SatQuestionResponseDraft>();
    for (const item of queued) {
      const base = folded.get(item.questionId) ?? currentResponse(item.questionId);
      if (!base) continue;
      const next = applySatResponseDraftChange(base, item.change);
      folded.set(item.questionId, next);
      dispatch({ type: "replaceResponse", response: next });
      persistence.save(next, saveContext(item.interactionType));
    }
  }, [currentResponse, entryVisibilityAckPending, persistence, saveContext]);

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
    pendingModuleWindow,
    pendingBreakSeconds,
    personalBreakStarting: Boolean(personalBreak && personalBreak.state !== "active" && state.phase !== "module" && state.phase !== "review" && isStarting),
    pendingSectionWaitSeconds,
    handoffSeconds,
    pendingStageReady,
    autoEntryRecoverable: entrySurface.recoverable,
    retryModuleEntry: entrySurface.retry,
    entryReason: entryDecision.reason,
    // True while the automatic entry path owns the pending module; the
    // directions screen keeps its Start button recovery-only only then, so a
    // branch module nobody will auto-start keeps a working button.
    entryAutoStartPending: entryDecision.autoStartPending,
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
      retryFinalization,
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
