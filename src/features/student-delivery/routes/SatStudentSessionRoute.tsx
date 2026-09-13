import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

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
import {
  findAttemptForModule,
  sectionForModule,
  studentModuleTitle,
} from "../application/satRuntimeSelectors";
import { responseForQuestion } from "../domain/satResponses";
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
import { SatBreakScreen } from "../ui/transitions/SatBreakScreen";
import { SatCompleteScreen, SatTerminatedScreen } from "../ui/transitions/SatCompleteScreen";
import { SatDirectionsScreen } from "../ui/transitions/SatDirectionsScreen";
import {
  SatBlockingOverlay,
  SatControlBanner,
  SatLeaseConflictNotice,
  SatSubmissionOverlay,
} from "../ui/feedback/SatControlFeedback";

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
  const [eliminationMode, setEliminationMode] = useState(false);
  // Bluebook Help + Shortcuts (Phases 2-3): transient route-level state.
  // Timer unaffected. Single-modal rule: at most one open at a time.
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Bluebook Unscheduled Break (Phase 8): confirm + veil, both transient.
  // The module timer keeps running; autosubmit/persistence unaffected.
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
  const prevIdentityKeyRef = useRef<string | null>(null);
  if (prevIdentityKeyRef.current !== identityKey) {
    prevIdentityKeyRef.current = identityKey;
    lastValidFrameRef.current = null;
  }
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

  if (error && !data) {
    return (
      <SatErrorSurface
        title="SAT delivery unavailable"
        description="Your responses are safe. The exam could not be loaded just now."
        detail={error}
        actionLabel="Exit"
        onAction={() => void onExit()}
      />
    );
  }
  if (!data) {
    return (
      <SatLoadingSurface label="Loading Digital SAT…" />
    );
  }
  if (data.result || state.phase === "complete") {
    lastValidFrameRef.current = null;
    return <SatCompleteScreen result={data.result ?? result} onExit={onExit} />;
  }
  if (data.proctorStatus === "terminated") {
    lastValidFrameRef.current = null;
  }
  if (data.scheduleRuntimeStatus === "completed" || data.scheduleRuntimeStatus === "cancelled") {
    lastValidFrameRef.current = null;
  }
  if (data.proctorStatus === "terminated") {
    return <SatTerminatedScreen note={data.proctorNote} onExit={onExit} />;
  }
  if (data.scheduleRuntimeStatus === "completed" || data.scheduleRuntimeStatus === "cancelled") {
    return <SatTerminatedScreen note="The proctor has ended this exam session." onExit={onExit} />;
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
    persistence.failureKind === "superseded" || persistence.failureKind === "terminal";
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
  // Single save surface (Phase 6f close-out): in module phase the shell's
  // SatSaveStatus banner owns the superseded state (bottom, outside inert,
  // with Take over inline) — the route notice would be a second competing
  // surface for the same truth. Outside module phase (no shell mounted)
  // the route notice stays the only surface.
  const inModulePhase = state.phase === "module";
  const withCalculatorHost = (content: ReactNode) => (
    <>
      {persistence.failureKind === "superseded" && !inModulePhase ? (
        <SatLeaseConflictNotice
          error={persistence.failure}
          isTakingOver={persistence.isTakingOver}
          onTakeOver={() => {
            void exam.commands.takeOverDurabilityLease().catch((takeoverError: unknown) => {
              exam.setError(
                takeoverError instanceof Error
                  ? takeoverError.message
                  : "Unable to take over this attempt."
              );
            });
          }}
        />
      ) : null}
      {content}
      {calculatorHost}
    </>
  );

  if (state.phase === "directions") {
    const pendingSection = exam.pendingModule
      ? sectionForModule(data, exam.pendingModule.id)
      : null;
    if (exam.pendingSectionWaitSeconds > 0 && exam.pendingModule) {
      return withCalculatorHost(
        <SatBreakScreen
          nextSectionKey={pendingSection?.sectionKey === "math" ? "math" : "reading-writing"}
          remainingSeconds={exam.pendingSectionWaitSeconds}
          mode="waiting"
        />
      );
    }
    if (exam.pendingBreakSeconds > 0 && exam.pendingModule) {
      return withCalculatorHost(
        <SatBreakScreen
          nextSectionKey={pendingSection?.sectionKey === "math" ? "math" : "reading-writing"}
          remainingSeconds={exam.pendingBreakSeconds}
        />
      );
    }
    // Exam-day re-audit defect 2: terminal recovery failed while all modules
    // are final — surface the same retry offered in `submitting` instead of
    // stranding the student on directions with an error and no action.
    const terminalRecoveryFailed =
      Boolean(error) &&
      !exam.isSubmitting &&
      !data.result &&
      data.attempt.moduleAttempts.length > 0 &&
      data.attempt.moduleAttempts.every((moduleAttempt) =>
        moduleAttempt.state === "submitted" || moduleAttempt.state === "locked",
      );
    return withCalculatorHost(
      <SatDirectionsScreen
        module={exam.pendingModule}
        sectionLabel={
          pendingSection
            ? sectionLabel(pendingSection.displayOrder, pendingSection.title)
            : "Next SAT module"
        }
        runtimeStatus={data.scheduleRuntimeStatus}
        proctorStatus={data.proctorStatus}
        isStarting={exam.isStarting}
        stageReady={exam.pendingStageReady}
        error={error}
        onStart={() => void commands.startPendingModule()}
        onExit={onExit}
        secondaryActionLabel={terminalRecoveryFailed ? "Retry finalization" : undefined}
        onSecondaryAction={terminalRecoveryFailed ? () => void commands.retryFinalization() : undefined}
        secondaryActionPending={terminalRecoveryFailed ? exam.isSubmitting : undefined}
      />
    );
  }

  if (state.phase === "break") {
    const waitingForScheduledBreak = exam.pendingSectionWaitSeconds > 0;
    // Phase 03 bare-branch rule: a break screen is timer-only full-viewport
    // chrome — no hidden tool tree. Directions re-warms before module entry.
    return (
      <SatBreakScreen
        nextSectionKey={state.nextSectionKey}
        remainingSeconds={
          waitingForScheduledBreak ? exam.pendingSectionWaitSeconds : exam.pendingBreakSeconds
        }
        mode={waitingForScheduledBreak ? "waiting" : "break"}
      />
    );
  }
  if (state.phase === "submitting") {
    // Exam-day P1: a failed finalization must be visible and retryable —
    // never a bare spinner. Recovery polling continues underneath, so the
    // panel can also resolve on its own when connectivity returns.
    if (error) {
      // Phase 03 bare-branch rule: a retry panel owns the full screen — no
      // hidden tool tree, no competing live region. Copy is Phase 05-owned.
      return (
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
        </div>
      );
    }
    // Phase 03 bare-branch rule: a single live region owns the screen.
    return (
      <SatLoadingSurface
        label={exam.autoSubmitted ? "Time expired — submitting your saved answers." : "Finalizing SAT responses…"}
      />
    );
  }
  // Phase 04 hold-previous-UI rule (C2): while state.phase is
  // module/review but the module is momentarily unresolvable, keep rendering
  // the previous valid frame while the hold is fresh; the bounded fallback
  // (bare Refreshing, kind="module-refresh" per Phase 01 contract) shows
  // only with no held frame or after hold expiry (genuine resolution
  // failure). SAT state unavailable is unreachable for transient skew — it
  // renders only when no held frame exists (phase=loading+data-present
  // under-one-frame window or a genuine invariant violation).
  if (state.phase !== "module" && state.phase !== "review") {
    // Defensive order: a fresh held frame wins even here (never swap valid
    // exam UI for the error on a one-frame mismatch).
    if (heldFrame && heldFrameFresh) return heldFrame.element;
    // Phase 03 bare-branch rule: an error surface owns the full screen.
    return (
      <SatErrorSurface
        title="SAT state unavailable"
        description="The assessment state could not be recovered."
        actionLabel="Exit"
        onAction={() => void onExit()}
      />
    );
  }
  if (!exam.stateModule || !exam.stateModuleAttempt || !exam.stateSection) {
    if (heldFrame && heldFrameFresh) {
      return heldFrame.element;
    }
    // Phase 03 bare-branch rule: transient skew shows the loader only — the
    // warm tree remounts once the module resolves (no prewarm here). The
    // fallback renders BARE (no withCalculatorHost) per the Phase 01/03
    // single-surface contract: exactly one role=status, no hidden Desmos iframes.
    return <SatLoadingSurface kind="module-refresh" label="Refreshing SAT module…" />;
  }

  const navigationItems = buildSatQuestionNavigationItems(
    state.questionIds,
    state.questionIndex,
    state.responses
  );
  const answeredCount = answeredSatQuestionCount(state.questionIds, state.responses);
  const activeSectionLabel = sectionLabel(exam.stateSection.displayOrder, exam.stateSection.title);
  const persistenceBlocked = Boolean(persistence.failure);

  if (state.phase === "review") {
    // Phase 04: record the last valid review frame (element cached at render
    // time; clocks keep reading live exam.remainingSeconds, so the hold never
    // resets the countdown; hold is read-only w.r.t. navigation — a live
    // answer dispatch wins and the next resolved render replaces the cache).
    const reviewElement = withCalculatorHost(
      <>
        {exam.warning ? (
          <SatControlBanner tone="warning">Proctor message: {exam.warning}</SatControlBanner>
        ) : null}
        {error ? <SatControlBanner tone="error">{error}</SatControlBanner> : null}
        {exam.blocked ? <SatBlockingOverlay note={data.proctorNote} /> : null}
        <SatReviewPage
          sectionLabel={activeSectionLabel}
          moduleTitle={studentModuleTitle(exam.stateModule)}
          remainingLabel={formatSatTime(exam.remainingSeconds)}
          remainingSeconds={exam.remainingSeconds}
          items={navigationItems}
          answeredCount={answeredCount}
          isSubmitting={exam.isSubmitting}
          persistenceBlocked={persistenceBlocked || persistence.pendingCount > 0}
          readinessInput={{
            isSubmitting: exam.isSubmitting,
            failure: persistence.failure,
            failureKind: persistence.failureKind,
            pendingCount: persistence.pendingCount,
          }}
          currentQuestionIndex={state.questionIndex}
          onSelectQuestion={commands.returnToQuestion}
          onBack={commands.returnToModule}
          onSubmit={() => void commands.submitModule(exam.stateModule!.id)}
          onRetrySave={() => {
            void persistence.retryFailed();
          }}
        />
      </>
    );
    lastValidFrameRef.current = { element: reviewElement, renderedAt: Date.now() };
    return reviewElement;
  }

  const questionId = state.questionIds[state.questionIndex];
  const question = exam.stateModule.questions.find(
    (candidate) => candidate.examQuestionId === questionId
  );
  if (!question || !questionId) {
    // Phase 03 bare-branch rule: an error surface owns the full screen.
    return (
      <SatErrorSurface
        title="SAT question unavailable"
        description="The active question could not be recovered."
        actionLabel="Exit"
        onAction={() => void onExit()}
      />
    );
  }

  const response = responseForQuestion(state.responses, questionId);
  const interactionBlocked = exam.blocked || exam.isSubmitting || persistenceInteractionBlocked;
  const directions = hasStructuredContent(exam.stateModule.instructions)
    ? exam.stateModule.instructions
    : hasStructuredContent(exam.stateSection.instructions)
      ? exam.stateSection.instructions
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
      {exam.warning ? (
        <SatControlBanner tone="warning">Proctor message: {exam.warning}</SatControlBanner>
      ) : null}
      {error ? <SatControlBanner tone="error">{error}</SatControlBanner> : null}
      {exam.blocked ? <SatBlockingOverlay note={data.proctorNote} /> : null}
      {exam.showAlmostUp && !exam.isSubmitting ? (
        <SatControlBanner tone="warning">Time almost up — answers save automatically.</SatControlBanner>
      ) : null}
      {exam.isSubmitting ? <SatSubmissionOverlay autoSubmitted={exam.autoSubmitted} /> : null}
      <SatExamShell
        moduleIdentity={exam.stateModule.id}
        sectionLabel={activeSectionLabel}
        directions={directions}
        remainingLabel={formatSatTime(exam.remainingSeconds)}
        remainingSeconds={exam.remainingSeconds}
        candidateName={data.candidateName}
        questionIndex={state.questionIndex}
        questionCount={state.questionIds.length}
        navigationItems={navigationItems}
        calculatorAvailable={state.toolCapabilities.calculator}
        calculatorOpen={state.activeTools.calculator}
        referenceAvailable={state.toolCapabilities.referenceSheet}
        referenceOpen={state.activeTools.referenceSheet}
        notesAvailable={resolveSatExamToolPolicy(state.sectionKey, exam.stateModule.toolPolicy).notes}
        blocked={interactionBlocked}
        saveState={saveState}
        saveFailure={persistence.failure}
        questionNote={response.annotations.legacyQuestionNote}
        readingPreferences={reading.preferences}
        onReadingPreferencesChange={reading.setPreferences}
        onSelectQuestion={commands.selectQuestion}
        onToggleCalculator={commands.toggleCalculator}
        onToggleReference={commands.toggleReference}
        onPrevious={commands.previousQuestion}
        onNext={commands.nextQuestion}
        onReviewModule={commands.reviewModule}
        onSaveNote={(note) => commands.setAnnotationNote(questionId, note)}
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
      >
        <SatQuestionRenderer
          sectionKey={state.sectionKey}
          questionNumber={state.questionIndex + 1}
          question={question}
          response={response}
          eliminationMode={eliminationMode}
          disabled={interactionBlocked}
          readingPreferences={reading.preferences}
          onReadingSplitRatioChange={(splitRatio) =>
            reading.setPreferences((current) => ({ ...current, splitRatio }))
          }
          onAnswerChange={(answer) => commands.setAnswer(questionId, answer)}
          onAnnotationsChange={(annotations) => commands.setAnnotations(questionId, annotations)}
          onFlushAnnotations={flushAnnotations}
          onToggleReview={() => commands.toggleReview(questionId)}
          onToggleEliminationMode={() => setEliminationMode((enabled) => !enabled)}
          onToggleEliminatedOption={(optionId) =>
            commands.toggleEliminatedOption(questionId, optionId)
          }
        />
      </SatExamShell>

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
  );
  lastValidFrameRef.current = { element: moduleElement, renderedAt: Date.now() };
  return moduleElement;
}
