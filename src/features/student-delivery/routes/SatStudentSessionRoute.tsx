import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";

/**
 * Phase 04 transient-skew hold window: while state.phase is module/review
 * but the module is momentarily unresolvable (one-frame data/state skew),
 * the last valid exam frame keeps rendering instead of swapping to a
 * full-screen spinner. Must exceed one poll-interval jitter window but stay
 * well under the 60s almost-up banner. Validated against the 2s/20s poll
 * cadence: a single missed-or-skewed poll resolves inside the window.
 */
export const SKEW_HOLD_MS = 1500;
import { SatErrorSurface, SatLoadingSurface } from "../ui/feedback/SatStateSurfaces";
import { hasStructuredContent } from "../../exam-authoring/api/renderingPublic";
import type { ExamSessionRuntime } from "../../../types/domain";
import type { StudentAttempt } from "../../../types/studentAttempt";
import type { SatBootstrapSeed } from "../bootstrap/satBootstrapSeed";
import { useSatExamController } from "../hooks/useSatExamController";
import { useSatReadingPreferences } from "../hooks/useSatReadingPreferences";
import { useSatEntryTransitionHold } from "../hooks/useSatEntryTransitionHold";
import {
  deriveSatStudentStage,
  type SatExamStage,
  type SatStudentStage,
} from "../application/satStudentSurface";
import {
  findAttemptForModule,
  moduleStartsNewSection,
  sectionForModule,
  studentModuleTitle,
} from "../application/satRuntimeSelectors";
import { responseForQuestion } from "../domain/satResponses";
import { SAT_COPY } from "../domain/satCopy";
import { satAnnotationEducationKey } from "../infrastructure/satAnnotationEducationStore";
import {
  hasSatExamZoomDecision,
  saveSatExamZoomDecision,
} from "../infrastructure/satReadingPreferencesStore";
import { answeredSatQuestionCount, buildSatQuestionNavigationItems } from "../domain/satSelectors";
import { formatSatTime } from "../domain/satTiming";
import { resolveSatToolCapabilities } from "../domain/satTools";
import { resolveSatExamToolPolicy } from "../domain/satToolPolicy";
import { ensureDesmosPreconnect } from "../infrastructure/desmos/desmosPreconnect";
import { SatExamShell } from "../ui/SatExamShell";
import { SatQuestionRenderer } from "../ui/question/SatQuestionRenderer";
import { SatReviewPage } from "../ui/review/SatReviewPage";
import { SatCalculatorPanel } from "../ui/tools/SatCalculatorPanel";
import { SatReferenceSheetPanel } from "../ui/tools/SatReferenceSheetPanel";
import { SatScheduledBreakScreen } from "../ui/break/SatScheduledBreakScreen";
import { SatPresenceSurface } from "../ui/motion/SatPresenceSurface";
import { SatStudentStageHost } from "../ui/stage/SatStudentStageHost";
import { SatCompleteScreen, SatTerminatedScreen } from "../ui/transitions/SatCompleteScreen";
import { SatEntryRecoveryScreen } from "../ui/transitions/SatEntryRecoveryScreen";
import { SatModuleHandoffStatus } from "../ui/transitions/SatModuleHandoffStatus";
import { SatPreStartScreen } from "../ui/transitions/SatPreStartScreen";
import { useStudentExamPageLock } from "@components/student/layout/useStudentExamPageLock";
import { useStudentExamViewport } from "@components/student/layout/useStudentExamViewport";
import { useStudentFocusedControlVisibility } from "@components/student/layout/useStudentFocusedControlVisibility";
import {
  SatBlockingOverlay,
  SatControlBanner,
  SatLeaseConflictNotice,
  SatTimeoutOverlay,
} from "../ui/feedback/SatControlFeedback";
import { SatIntegrityWarning } from "../ui/feedback/SatIntegrityWarning";
import { SatTemporalRuntime } from "../timing/SatTemporalRuntime";

export interface SatStudentSessionRouteProps {
  scheduleId: string;
  attemptId: string;
  candidateId: string;
  attemptSnapshot?: StudentAttempt | null;
  runtimeSnapshot: ExamSessionRuntime | null;
  liveSocketConnected: boolean;
  attemptUpdateToken: number;
  leaseEpoch?: number | null | undefined;
  controlEpoch?: number | null | undefined;
  // Phase 02 bootstrap seed (frontend-only handoff; bytes still come from
  // assessmentDeliveryApi.bootstrap). Optional + backwards-compatible.
  bootstrapSeed?: SatBootstrapSeed | null;
  initialIsLoading?: boolean;
  onExit: () => void | Promise<void>;
}

function assertNever(surface: never): never {
  throw new Error(`Unhandled SAT student stage: ${surface}`);
}

function sectionLabel(displayOrder: number, title: string): string {
  return `Section ${displayOrder + 1}: ${title}`;
}

export function SatStudentSessionRoute({
  scheduleId,
  attemptId,
  candidateId,
  attemptSnapshot,
  runtimeSnapshot,
  liveSocketConnected,
  attemptUpdateToken,
  leaseEpoch,
  controlEpoch,
  bootstrapSeed = null,
  initialIsLoading = false,
  onExit,
}: SatStudentSessionRouteProps) {
  const exam = useSatExamController({
    scheduleId,
    attemptId,
    candidateId,
    attemptSnapshot: attemptSnapshot ?? null,
    runtimeSnapshot,
    liveSocketConnected,
    attemptUpdateToken,
    leaseEpoch,
    controlEpoch,
    bootstrapSeed,
    initialIsLoading,
  });
  const reading = useSatReadingPreferences(scheduleId, attemptId);
  /**
   * The attempt's own memory of its automatic screen-zoom decision, in two
   * halves, because it has to survive two different things.
   *
   * The durable half (`hasSatExamZoomDecision`) survives a page reload: an
   * attempt whose first module needed no shrink stores no zoom at all, so
   * without it a refreshed page would find "nothing stored" and decide again on
   * whatever module it reloaded into. The in-memory half covers what storage
   * cannot — a page session whose decision was taken while storage was
   * unavailable (blocked or private-mode localStorage), where the write fails
   * silently. It remembers WHICH attempt decided rather than a bare boolean, so
   * the same route carrying a different attempt starts undecided by comparison —
   * no reset effect that could race the decision it is meant to record.
   *
   * The durable flag belongs to the attempt, not to the candidate identity that
   * happens to be showing: one decision per attempt, which is the rule.
   */
  const [screenZoomDecidedFor, setScreenZoomDecidedFor] = useState<string | null>(null);
  const screenZoomDecisionStored = useMemo(
    () => hasSatExamZoomDecision(scheduleId, attemptId),
    [attemptId, scheduleId],
  );
  const [eliminationMode, setEliminationMode] = useState(false);
  // Bluebook Help + Shortcuts (Phases 2-3): transient route-level state.
  // Timer unaffected. Single-modal rule: at most one open at a time.
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Bluebook Unscheduled Break (Phase 8): confirm + veil, both transient.
  // The module timer keeps running; answer persistence is unaffected.
  // Available in module phase only (review has no module clock to veil).
  const [breakConfirmOpen, setBreakConfirmOpen] = useState(false);
  const [breakVeilOpen, setBreakVeilOpen] = useState(false);

  const { state, data, result, error, commands, persistence } = exam;
  // Phase 04 hold-previous-UI vessel: a render-time fallback (ref, not
  // state — holding must not itself trigger renders or reset clocks).
  // Updated only on successful module/review renders; cleared on identity
  // change, terminal phases, and unmount. The held element keeps its
  // already-mounted calculator host (no remount on skew); the bounded
  // fallback below mounts none (bare per Phase 01/03 single-surface rule).
  const lastValidFrameRef = useRef<{ element: ReactElement; renderedAt: number } | null>(null);
  const identityKey = `${scheduleId}:${attemptId}:${candidateId}`;
  const pendingSection = data && exam.pendingModule
    ? sectionForModule(data, exam.pendingModule.id)
    : null;
  const initialEntry = Boolean(
    data &&
      state.phase === "directions" &&
      exam.pendingModule?.adaptiveRole === "base" &&
      pendingSection?.displayOrder === 0 &&
      data.attempt.moduleAttempts.every((moduleAttempt) => moduleAttempt.state === "not_started"),
  );
  /**
   * Arms the bounded entry-hold window for the pending module.
   *
   * It is what a student WITHOUT a retained frame waits out — a reload that
   * lands mid-handoff shows "restoring" and only escalates to the recovery
   * surface after this window; with a frame in hand, the handoff status owns
   * the moment instead and the window is never consulted.
   */
  const entryTransitionKey =
    state.phase === "directions" && exam.pendingModule
      ? `${identityKey}:${exam.pendingModule.id}`
      : null;
  const entryHoldExpired = useSatEntryTransitionHold(entryTransitionKey);
  const screenZoomDecided =
    screenZoomDecidedFor === identityKey || screenZoomDecisionStored;
  const prevIdentityKeyRef = useRef<string | null>(null);
  if (prevIdentityKeyRef.current !== identityKey) {
    prevIdentityKeyRef.current = identityKey;
    lastValidFrameRef.current = null;
  }
  /**
   * A render carrying a different attempt/candidate is not a transition: it is a
   * different page. The stage host replaces the surface at once — no cross-fade
   * of the previous attempt's exam into the new one, and no layer of the old
   * attempt left fading behind it.
   */
  const attemptChangedRef = useRef(identityKey);
  const attemptChanged = attemptChangedRef.current !== identityKey;
  attemptChangedRef.current = identityKey;
  /**
   * The one way a student stage reaches the viewport.
   *
   * Everything the route renders goes through the host, so the student has
   * exactly one surface at a time and a stage change is a cross-fade instead of
   * a cut from one full-screen tree to another. `children` may be a keyed array
   * when a stage renders more than one layer (the module handoff adds its status
   * card beside the frozen exam frame) — position 0 is the stage's own surface in
   * every case, which is what keeps the exam frame mounted across a handoff.
   */
  const stageHost = (target: SatStudentStage, children: ReactNode) => (
    <SatTemporalRuntime model={exam.temporalModel ?? null} onBoundary={exam.onTemporalBoundary}>
      <SatStudentStageHost stage={target} instant={attemptChanged}>
        {children}
      </SatStudentStageHost>
    </SatTemporalRuntime>
  );
  useEffect(() => {
    lastValidFrameRef.current = null;
  }, [identityKey]);
  useEffect(() => {
    return () => {
      lastValidFrameRef.current = null;
    };
  }, []);
  const heldFrame = lastValidFrameRef.current;
  const heldFrameFresh =
    heldFrame != null && Date.now() - heldFrame.renderedAt < SKEW_HOLD_MS;
  /**
   * The page lock and the measured exam height belong to the ATTEMPT, not to a
   * phase: a module handoff and the scheduled break happen inside the same
   * attempt, and releasing the lock between them re-acquired it on the next
   * module — re-measuring the viewport and restoring a document scroll the exam
   * had already taken. Terminal phases still release it.
   */
  const examViewportActive =
    state.phase === "module" ||
    state.phase === "review" ||
    state.phase === "directions" ||
    state.phase === "break" ||
    state.phase === "submitting";
  const examViewport = useStudentExamViewport(examViewportActive);
  useStudentExamPageLock(examViewportActive);
  useStudentFocusedControlVisibility(examViewportActive && examViewport.keyboardOpen);
  const flushAnnotations = useCallback(() => {
    // The durability engine publishes offline/failure status to the shell; local edits remain recoverable.
    void persistence.flush().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persistence object identity churns; flush is the stable seam.
  }, [persistence.flush]);
  const activeQuestionIndex =
    state.phase === "module" || state.phase === "review" ? state.questionIndex : -1;
  useEffect(() => {
    setEliminationMode(false);
    // Ephemeral UI resets on navigation: Help/Shortcuts/Break never linger.
    setHelpOpen(false);
    setShortcutsOpen(false);
    setBreakConfirmOpen(false);
    setBreakVeilOpen(false);
  }, [activeQuestionIndex]);

  useEffect(() => {
    ensureDesmosPreconnect();
  }, []);

  /* ------------------------------------------------------------------ *
   * The stage (Stage model)
   *
   * One decision, from facts the route already holds: which single surface the
   * student is on. Everything below renders through the host, so a module
   * handoff is a content change inside the exam stage rather than a walk
   * through intermediate screens.
   * ------------------------------------------------------------------ */
  const liveQuestionId =
    state.phase === "module" && "questionIds" in state
      ? state.questionIds[state.questionIndex]
      : null;
  const liveQuestion =
    liveQuestionId && exam.stateModule
      ? exam.stateModule.questions.find(
          (candidate) => candidate.examQuestionId === liveQuestionId,
        ) ?? null
      : null;
  const terminated =
    data?.proctorStatus === "terminated" ||
    data?.scheduleRuntimeStatus === "completed" ||
    data?.scheduleRuntimeStatus === "cancelled";
  const allModulesFinal =
    Boolean(data) &&
    (data?.attempt.moduleAttempts.length ?? 0) > 0 &&
    (data?.attempt.moduleAttempts.every(
      (moduleAttempt) => moduleAttempt.state === "submitted" || moduleAttempt.state === "locked",
    ) ?? false);
  const entryBlocked =
    exam.entryReason === "runtime-not-live" ||
    exam.entryReason === "proctor-blocked" ||
    exam.entryReason === "stage-not-ready";
  const stage = deriveSatStudentStage({
    runnerPhase: state.phase,
    hasData: Boolean(data),
    loadFailed: Boolean(error) && !data,
    hasResult: Boolean(data?.result) || Boolean(result),
    terminated,
    terminatedByProctor: data?.proctorStatus === "terminated",
    finalizationFailed: Boolean(error),
    allModulesFinal,
    isInitialEntry: initialEntry,
    pendingModule:
      data && exam.pendingModule && pendingSection
        ? {
            id: exam.pendingModule.id,
            title: studentModuleTitle(exam.pendingModule),
            sectionKey:
              pendingSection.sectionKey === "math" ? "math" : "reading-writing",
            // Structural, never ordinal: the module immediately before this one
            // in exam order decides whether the student is crossing a section.
            startsNewSection: moduleStartsNewSection(data, exam.pendingModule.id),
            // A section boundary is only a break before the server starts this
            // module. Reopening after another tab has started it must show the
            // current module instead of a stale break surface.
            started: Boolean(
              data.attempt.moduleAttempts.find(
                (moduleAttempt) => moduleAttempt.moduleId === exam.pendingModule?.id,
              )?.startedAt,
            ),
          }
        : null,
    hasExamFrame: heldFrame !== null,
    frameFresh: heldFrameFresh,
    moduleResolved: Boolean(exam.stateModule && exam.stateModuleAttempt && exam.stateSection),
    moduleQuestionResolved: state.phase !== "module" || (liveQuestion !== null && liveQuestionId !== null),
    entryRecoverable: exam.autoEntryRecoverable,
    entryBlocked,
    entryHoldExpired,
    pendingBreakSeconds: exam.pendingBreakSeconds,
    personalBreakStarting: exam.personalBreakStarting,
    pendingSectionWaitSeconds: exam.pendingSectionWaitSeconds,
    entryInFlight: exam.isStarting,
    attemptKey: identityKey,
  });

  if (!data) {
    if (stage.kind === "error") {
      return stageHost(
        stage,
        <SatErrorSurface
          title="SAT delivery unavailable"
          description="Your responses are safe. The exam could not be loaded just now."
          {...(error ? { detail: error } : {})}
          actionLabel="Exit"
          onAction={() => void onExit()}
        />,
      );
    }
    return stageHost(
      stage,
      <SatPreStartScreen
        reason="loading"
        runtimeStatus="loading"
        proctorStatus="connecting"
        stageReady={false}
      />,
    );
  }

  if (stage.kind === "complete") {
    lastValidFrameRef.current = null;
    // The finished screen carries no unsynced-draft banner. Quarantine records
    // are written routinely by finalize/ack-supersede reconciliation, so a
    // quarantined or still-pending draft could decorate a clean sitting with a
    // proctor-contact warning. The durability engine still holds and retries
    // those drafts; that signal is not part of the student's terminal surface.
    return stageHost(
      stage,
      <SatCompleteScreen result={data.result ?? result} onExit={onExit} />,
    );
  }
  if (stage.kind === "terminated") {
    lastValidFrameRef.current = null;
    return stageHost(
      stage,
      <SatTerminatedScreen
        note={
          stage.byProctor
            ? data.proctorNote
            : "The proctor has ended this exam session."
        }
        onExit={onExit}
      />,
    );
  }

  const currentCalculatorModule =
    (state.phase === "module" || state.phase === "review") &&
    state.toolCapabilities.calculator &&
    exam.stateModule
      ? exam.stateModule
      : null;
  const pendingCalculatorModule =
    exam.pendingModule && resolveSatToolCapabilities(exam.pendingModule.toolPolicy).calculator
      ? exam.pendingModule
      : null;

  // Phase 03 prewarm gating: the host mounts ONLY where exam chrome can
  // exist. Module/review warm the live module; directions warms ONLY the
  // pending module when IT is calculator-capable. Every other phase yields
  // null (no host). No cross-exam fallback scan: a fallback math module's
  // warmed iframes would sit under an unrelated module-attempt key with
  // zero hit rate while spending 2 Desmos embeds on error/loading screens.
  const prewarmEligibleModule =
    state.phase === "module" || state.phase === "review"
      ? currentCalculatorModule
      : state.phase === "directions"
        ? pendingCalculatorModule
        : null;

  const prewarmAttempt = prewarmEligibleModule
    ? findAttemptForModule(data, prewarmEligibleModule.id)
    : undefined;
  // Synthetic prewarm-colon id ONLY for the directions+pending case (the
  // real attempt does not exist yet). Do NOT extend synthetic ids to any
  // other phase.
  const calculatorModuleAttemptId =
    currentCalculatorModule && exam.stateModuleAttempt
      ? exam.stateModuleAttempt.id
      : (prewarmAttempt?.id ??
        (state.phase === "directions" && prewarmEligibleModule
          ? `prewarm:${prewarmEligibleModule.id}`
          : null));
  const persistenceInteractionBlocked =
    persistence.failureKind === "superseded" || persistence.failureKind === "terminal" || persistence.failureKind === "expired";
  const calculatorDisabled = exam.blocked || exam.isSubmitting || persistenceInteractionBlocked;
  const calculatorHost = calculatorModuleAttemptId ? (
    <SatCalculatorPanel
      key="sat-calculator-warm-host"
      open={state.phase === "module" && state.activeTools.calculator}
      scheduleId={scheduleId}
      attemptId={attemptId}
      moduleAttemptId={calculatorModuleAttemptId}
      disabled={calculatorDisabled}
      prewarmWhenClosed
      onClose={() => commands.closeTool("calculator")}
    />
  ) : null;
  // The question shell and review page each own a normal-flow notice row.
  // Other phases place this notice before their content instead of floating it
  // over the exam viewport.
  const inModulePhase = state.phase === "module";
  const inReviewPhase = state.phase === "review";
  const takeOverDurabilityLease = () => {
    void exam.commands.takeOverDurabilityLease().catch((takeoverError: unknown) => {
      exam.setError(
        takeoverError instanceof Error
          ? takeoverError.message
          : "Unable to take over this attempt."
      );
    });
  };
  const leaseConflictNotice = persistence.failureKind === "superseded" ? (
    <SatLeaseConflictNotice
      error={persistence.failure}
      isTakingOver={persistence.isTakingOver}
      onTakeOver={takeOverDurabilityLease}
    />
  ) : null;
  const withCalculatorHost = (content: ReactNode) => (
    <>
      {!inModulePhase && !inReviewPhase ? leaseConflictNotice : null}
      {content}
      {!inModulePhase ? calculatorHost : null}
    </>
  );

  if (stage.kind === "finalizing") {
    // Exam-day P1: a failed finalization must be visible and retryable — never
    // a bare spinner. Recovery polling continues underneath, so the panel can
    // also resolve on its own when connectivity returns.
    if (stage.failed) {
      return stageHost(
        stage,
        <div
          className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 py-8 text-[var(--sat-text)]"
          role="alert"
        >
          <div className="w-full max-w-md text-center">
            <h1 className="text-[20px] font-semibold tracking-tight">
              {exam.answersRecorded
                ? "Your answers are recorded — finishing the result…"
                : "Submission interrupted — your answers are safe"}
            </h1>
            <p className="mt-2 text-[15px] leading-6 text-[var(--sat-text-secondary)]">
              {exam.answersRecorded
                ? "The result could not be generated just now. Keep this screen open; it will complete automatically, or retry now."
                : "The final step could not be sent just now. Your saved answers remain on this device and the server."}
            </p>
            <p className="mt-3 break-words text-[13px] leading-5 text-[var(--sat-text-secondary)]">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void commands.retryFinalization()}
              disabled={exam.isSubmitting}
              className="sat-touch-target sat-pressable mt-6 inline-flex items-center justify-center rounded-full border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-5 text-[14px] font-semibold text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {exam.isSubmitting ? "Retrying…" : "Retry finalization"}
            </button>
          </div>
        </div>,
      );
    }
    return stageHost(
      stage,
      <SatLoadingSurface
        kind="finalizing"
        label={
          exam.timeoutTransitionStarted
            ? SAT_COPY.timeout.recordingAnswers
            : SAT_COPY.transitions.finalizingResult
        }
      />,
    );
  }

  if (stage.kind === "scheduled-break") {
    // One break surface for all three phases: the stage key is the boundary, so
    // waiting → on break → opening next section never remounts the card.
    return stageHost(
      stage,
      <SatScheduledBreakScreen
        phase={stage.phase}
        nextSectionKey={stage.nextSectionKey}
        remainingSeconds={stage.remainingSeconds}
        entryProgress={stage.entryProgress}
      />,
    );
  }

  if (stage.kind === "pre-start") {
    return stageHost(
      stage,
      withCalculatorHost(
        <SatPreStartScreen
          reason={stage.reason}
          runtimeStatus={data.scheduleRuntimeStatus}
          proctorStatus={data.proctorStatus}
          stageReady={exam.pendingStageReady}
        />,
      ),
    );
  }

  if (stage.kind === "entry-recovery") {
    return stageHost(
      stage,
      withCalculatorHost(
        <SatEntryRecoveryScreen
          module={exam.pendingModule}
          isRetrying={exam.isStarting}
          onRetry={exam.retryModuleEntry}
        />,
      ),
    );
  }

  if (stage.kind === "error") {
    // Phase 03 bare-branch rule: an error surface owns the full screen.
    return stageHost(
      stage,
      <SatErrorSurface
        title={
          stage.reason === "question" ? "SAT question unavailable" : "SAT state unavailable"
        }
        description={
          stage.reason === "question"
            ? "The active question could not be recovered."
            : "The assessment state could not be recovered."
        }
        actionLabel="Exit"
        onAction={() => void onExit()}
      />,
    );
  }

  /* Exhaustive by construction: every non-exam stage kind returned above. A new
   * kind added to the selector fails THIS assignment at compile time instead of
   * silently rendering the exam frame for it. */
  const examStage: SatExamStage = stage;

  /* ------------------------------------------------------------------ *
   * The exam stage
   *
   * One stage for the whole attempt. Its contents below are: the live frame,
   * the bounded skew hold, the bare refresh fallback, and the module handoff —
   * which keeps the finished frame exactly where it is and adds one live status
   * card beside it.
   * ------------------------------------------------------------------ */
  const retainedFrame = heldFrame;
  const refreshFallback = (
    // Phase 03 bare-branch rule: transient skew shows the loader only — the
    // warm tree remounts once the module resolves (no prewarm here). The
    // fallback renders BARE (no withCalculatorHost) per the Phase 01/03
    // single-surface contract: exactly one role=status, no hidden Desmos iframes.
    <SatLoadingSurface kind="module-refresh" label="Refreshing SAT module…" />
  );
  if (examStage.content !== "live") {
    // A frame that vanished between the stage decision and here is a resolution
    // failure, and the refresh fallback is the same answer as a stale hold —
    // never a handoff over nothing.
    if (!retainedFrame || examStage.content === "refreshing") {
      return stageHost(examStage, refreshFallback);
    }
    if (examStage.content === "skew-hold") {
      // Interactive on purpose (Phase 04): a live answer dispatch wins, and the
      // next resolved render replaces the cache.
      return stageHost(examStage, [
        <SatPresenceSurface
          key="sat-exam-frame"
          className="sat-ui min-h-[100dvh] min-w-0"
          data-sat-student-frame
          data-sat-skew-hold="true"
        >
          {retainedFrame.element}
        </SatPresenceSurface>,
      ]);
    }
    if (examStage.content === "opening") {
      /**
       * The module handoff, inside the exam.
       *
       * Position 0 is the same `SatPresenceSurface` the live frame renders, with
       * the same retained element as its child, so React reconciles the frame
       * instead of remounting it: the shell, its DOM, its tool hosts and its zoom
       * plane never leave. Position 1 is the live status card — a SIBLING of the
       * hidden frame, never inside it, so an assistive-tech student hears exactly
       * the one thing that changed. `data-sat-transition-hold` keeps its existing
       * meaning for keyboard guards and e2e.
       */
      return stageHost(examStage, [
        // SAME key and same position as the live frame below: React reconciles
        // the frame instead of remounting it, which is the whole point of the
        // handoff. Keying it differently here is what a handoff cannot afford.
        <SatPresenceSurface
          key="sat-exam-frame"
          className="sat-ui min-h-[100dvh] min-w-0"
          data-sat-student-frame
          data-sat-transition-hold="true"
          aria-hidden="true"
          inert
        >
          {retainedFrame.element}
        </SatPresenceSurface>,
        <SatModuleHandoffStatus
          key="sat-module-handoff"
          moduleTitle={examStage.pendingModuleTitle ?? "the next module"}
          retrying={exam.autoEntryRecoverable}
          remainingSeconds={exam.handoffSeconds ?? null}
          onRetry={exam.retryModuleEntry}
        />,
      ]);
    }
    return assertNever(examStage.content);
  }

  if (state.phase !== "module" && state.phase !== "review") {
    // Unreachable: the stage reports `live` only while the runner is in a
    // working phase. It stays as the narrowing guard the frame reads below need
    // (and as the honest answer if a future phase ever resolves a module).
    return stageHost(examStage, refreshFallback);
  }

  const stateModule = exam.stateModule;
  const stateSection = exam.stateSection;
  if (!stateModule || !stateSection) {
    // The stage only reports `live` when both resolve; a frame that vanished
    // between the two reads is a resolution failure, not a handoff.
    return stageHost(stage, refreshFallback);
  }

  const navigationItems = buildSatQuestionNavigationItems(
    state.questionIds,
    state.questionIndex,
    state.responses
  );
  const answeredCount = answeredSatQuestionCount(state.questionIds, state.responses);
  const activeSectionLabel = sectionLabel(stateSection.displayOrder, stateSection.title);

  if (state.phase === "review") {
    // Phase 04: record the last valid review frame (element cached at render
    // time; clocks keep reading live exam.remainingSeconds, so the hold never
    // resets the countdown; hold is read-only w.r.t. navigation — a live
    // answer dispatch wins and the next resolved render replaces the cache).
    const reviewElement = withCalculatorHost(
      <>
        {exam.blocked ? <SatBlockingOverlay note={data.proctorNote} /> : null}
        {/* Integrity hold: acknowledges only — the review surface, module
            attempt, answers and timer stay exactly as they were. */}
        <SatIntegrityWarning
          open={exam.pendingTabSwitchWarning !== null}
          onContinue={exam.acknowledgeTabSwitchWarning}
        />
        {exam.answerInteractionBlocked ? (
          <SatTimeoutOverlay
            saveFailureKind={persistence.failureKind}
            saveFailure={persistence.failure}
            onRetrySave={() => void persistence.retryFailed()}
          />
        ) : null}
        <SatReviewPage
          sectionLabel={activeSectionLabel}
          moduleTitle={studentModuleTitle(stateModule)}
          remainingLabel={formatSatTime(exam.remainingSeconds)}
          remainingSeconds={exam.remainingSeconds}
          examHeight={examViewport.stableExamHeight}
          keyboardOpen={examViewport.keyboardOpen}
          items={navigationItems}
          answeredCount={answeredCount}
          pendingSaveCount={persistence.pendingCount}
          saveFailure={persistence.failure}
          saveFailureKind={persistence.failureKind}
          currentQuestionIndex={state.questionIndex}
          notices={
            <>
              {exam.warning ? <SatControlBanner tone="warning">Proctor message: {exam.warning}</SatControlBanner> : null}
              {error ? <SatControlBanner tone="error">{error}</SatControlBanner> : null}
              {leaseConflictNotice}
            </>
          }
          onSelectQuestion={commands.returnToQuestion}
          onBack={commands.returnToModule}
          onRetrySave={() => {
            void persistence.retryFailed();
          }}
        />
      </>
    );
    lastValidFrameRef.current = { element: reviewElement, renderedAt: Date.now() };
    return stageHost(stage, [
      <SatPresenceSurface
        key="sat-exam-frame"
        className="sat-ui min-h-[100dvh] min-w-0"
        data-sat-student-frame
      >
        {reviewElement}
      </SatPresenceSurface>,
    ]);
  }

  const question = liveQuestion;
  const questionId = liveQuestionId;
  if (!question || !questionId) {
    // The stage selector owns this verdict; reaching here means the payload
    // changed between the two reads in one render.
    return stageHost(examStage, refreshFallback);
  }

  const response = responseForQuestion(state.responses, questionId);
  const interactionBlocked =
    exam.blocked || exam.isSubmitting || exam.answerInteractionBlocked || persistenceInteractionBlocked;
  const directions = hasStructuredContent(stateModule.instructions)
    ? stateModule.instructions
    : hasStructuredContent(stateSection.instructions)
      ? stateSection.instructions
      : null;
  const saveState =
    persistence.failureKind === "offline"
      ? ("offline" as const)
      : persistence.failureKind === "retryable"
        ? ("retrying" as const)
        : persistence.failureKind === "superseded"
          ? ("superseded" as const)
          : persistence.failure
            ? ("failed" as const)
            : persistence.pendingCount > 0
              ? ("saving" as const)
              : ("idle" as const);

  // Phase 04: record the last valid module frame (same hold contract as
  // review above; ephemeral overlays reset on activeQuestionIndex change,
  // and hold is not navigation, so help/shortcuts/break veils neither reset
  // nor leak past hold expiry).
  const moduleElement = withCalculatorHost(
    <>
      {exam.blocked ? <SatBlockingOverlay note={data.proctorNote} /> : null}
      {exam.answerInteractionBlocked ? (
        <SatTimeoutOverlay
          saveFailureKind={persistence.failureKind}
          saveFailure={persistence.failure}
          onRetrySave={() => void persistence.retryFailed()}
        />
      ) : null}
      {/* Integrity hold sits above every tool and dialog (blocking layer): a
          student cannot dismiss it and keep working behind it. */}
      <SatIntegrityWarning
        open={exam.pendingTabSwitchWarning !== null}
        onContinue={exam.acknowledgeTabSwitchWarning}
      />
      <SatExamShell
        moduleIdentity={stateModule.id}
        sectionLabel={activeSectionLabel}
        sectionKey={state.sectionKey}
        directions={directions}
        remainingLabel={formatSatTime(exam.remainingSeconds)}
        remainingSeconds={exam.remainingSeconds}
        examHeight={examViewport.stableExamHeight}
        keyboardOpen={examViewport.keyboardOpen}
        candidateName={data.candidateName}
        questionIndex={state.questionIndex}
        questionCount={state.questionIds.length}
        navigationItems={navigationItems}
        calculatorAvailable={state.toolCapabilities.calculator}
        calculatorOpen={state.activeTools.calculator}
        referenceAvailable={state.toolCapabilities.referenceSheet}
        referenceOpen={state.activeTools.referenceSheet}
        notesAvailable={resolveSatExamToolPolicy(state.sectionKey, stateModule.toolPolicy).notes}
        blocked={interactionBlocked}
        saveState={saveState}
        saveFailure={persistence.failure}
        notices={
          <>
            {exam.warning ? <SatControlBanner tone="warning">Proctor message: {exam.warning}</SatControlBanner> : null}
            {error ? <SatControlBanner tone="error">{error}</SatControlBanner> : null}
          </>
        }
        questionNote={response.annotations.legacyQuestionNote}
        readingPreferences={reading.preferences}
        onReadingPreferencesChange={reading.setPreferences}
        autoFitScreenZoom
        screenZoomDecided={screenZoomDecided}
        onScreenZoomDecided={() => {
          setScreenZoomDecidedFor(identityKey);
          saveSatExamZoomDecision(scheduleId, attemptId);
        }}
        onSelectQuestion={commands.selectQuestion}
        onToggleCalculator={commands.toggleCalculator}
        onToggleReference={commands.toggleReference}
        onPrevious={commands.previousQuestion}
        onNext={commands.nextQuestion}
        onReviewModule={commands.reviewModule}
        onSaveNote={(note) => commands.setAnnotationNote(questionId, note)}
        annotations={response.annotations}
        onAnnotationsChange={(annotations) => commands.setAnnotations(questionId, annotations)}
        onFlushAnnotations={flushAnnotations}
        answered={Boolean(response.answer.trim())}
        educationKey={satAnnotationEducationKey(scheduleId, attemptId)}
        onToggleMarkForReview={() => commands.toggleReview(questionId)}
        onToggleEliminationMode={() => setEliminationMode((enabled) => !enabled)}
        helpOpen={helpOpen}
        onOpenHelp={() => { setShortcutsOpen(false); setHelpOpen(true); }}
        onCloseHelp={() => setHelpOpen(false)}
        shortcutsOpen={shortcutsOpen}
        onOpenShortcuts={() => { setHelpOpen(false); setShortcutsOpen(true); }}
        onCloseShortcuts={() => setShortcutsOpen(false)}
        onOpenBreakConfirm={() => { setHelpOpen(false); setShortcutsOpen(false); setBreakConfirmOpen(true); }}
        breakAvailable={state.phase === "module"}
        breakConfirmOpen={breakConfirmOpen}
        onCloseBreakConfirm={() => setBreakConfirmOpen(false)}
        onTakeBreak={() => { setBreakConfirmOpen(false); setBreakVeilOpen(true); }}
        breakVeilOpen={breakVeilOpen}
        onReturnFromBreak={() => setBreakVeilOpen(false)}
        onRetrySave={() => {
          void persistence.retryFailed();
        }}
        onTakeOver={() => {
          void exam.commands.takeOverDurabilityLease().catch((takeoverError: unknown) => {
            exam.setError(
              takeoverError instanceof Error
                ? takeoverError.message
                : "Unable to take over this attempt."
            );
          });
        }}
        isTakingOver={persistence.isTakingOver}
        floatingToolChildren={
          <>
            {calculatorHost}
            {state.toolCapabilities.referenceSheet ? (
              <SatReferenceSheetPanel
                open={state.phase === "module" && state.activeTools.referenceSheet}
                disabled={interactionBlocked}
                scheduleId={scheduleId}
                attemptId={attemptId}
                moduleAttemptId={exam.stateModuleAttempt?.id ?? "unknown-module"}
                onClose={() => commands.closeTool("reference_sheet")}
              />
            ) : null}
          </>
        }
      >
        <SatQuestionRenderer
          sectionKey={state.sectionKey}
          questionNumber={state.questionIndex + 1}
          selectionScopeKey={`${stateModule.id}::${questionId}`}
          question={question}
          response={response}
          eliminationMode={eliminationMode}
          disabled={interactionBlocked}
          readingPreferences={reading.preferences}
          onReadingSplitRatioChange={(splitRatio) =>
            reading.setPreferences((current) => ({ ...current, splitRatio }))
          }
          onAnswerChange={(answer) => commands.setAnswer(questionId, answer)}
          onAnswerBlur={flushAnnotations}
          onToggleReview={() => commands.toggleReview(questionId)}
          onToggleEliminationMode={() => setEliminationMode((enabled) => !enabled)}
          onToggleEliminatedOption={(optionId) =>
            commands.toggleEliminatedOption(questionId, optionId)
          }
        />
      </SatExamShell>
    </>
  );
  lastValidFrameRef.current = { element: moduleElement, renderedAt: Date.now() };
  return stageHost(stage, [
    <SatPresenceSurface
      key="sat-exam-frame"
      className="sat-ui min-h-[100dvh] min-w-0"
      data-sat-student-frame
    >
      {moduleElement}
    </SatPresenceSurface>,
  ]);
}
