import { useEffect, useState, type ReactNode } from "react";
import { SatErrorSurface, SatLoadingSurface } from "../ui/feedback/SatStateSurfaces";
import { hasStructuredContent } from "../../exam-authoring/api/renderingPublic";
import type { ExamSessionRuntime } from "../../../types/domain";
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
  SatSubmissionOverlay,
} from "../ui/feedback/SatControlFeedback";

export interface SatStudentSessionRouteProps {
  scheduleId: string;
  attemptId: string;
  candidateId: string;
  runtimeSnapshot: ExamSessionRuntime | null;
  liveSocketConnected: boolean;
  attemptUpdateToken: number;
  onExit: () => void | Promise<void>;
}

function sectionLabel(displayOrder: number, title: string): string {
  return `Section ${displayOrder + 1}: ${title}`;
}

export function SatStudentSessionRoute({
  scheduleId,
  attemptId,
  candidateId,
  runtimeSnapshot,
  liveSocketConnected,
  attemptUpdateToken,
  onExit,
}: SatStudentSessionRouteProps) {
  const exam = useSatExamController({
    scheduleId,
    attemptId,
    candidateId,
    runtimeSnapshot,
    liveSocketConnected,
    attemptUpdateToken,
  });
  const reading = useSatReadingPreferences(scheduleId, attemptId);
  const [eliminationMode, setEliminationMode] = useState(false);

  const { state, data, result, error, commands, persistence } = exam;
  const activeQuestionIndex =
    state.phase === "module" || state.phase === "review" ? state.questionIndex : -1;
  useEffect(() => {
    setEliminationMode(false);
  }, [activeQuestionIndex]);

  useEffect(() => {
    ensureDesmosPreconnect();
  }, []);

  const bootstrapCalculatorHost = (
    <SatCalculatorPanel
      key="sat-calculator-warm-host"
      open={false}
      scheduleId={scheduleId}
      attemptId={attemptId}
      moduleAttemptId={`prewarm:${attemptId}`}
      prewarmWhenClosed
      onClose={commands.closeTool}
    />
  );

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
      <>
        <SatLoadingSurface label="Loading Digital SAT…" />
        {bootstrapCalculatorHost}
      </>
    );
  }
  if (data.result || state.phase === "complete") {
    return <SatCompleteScreen result={data.result ?? result} onExit={onExit} />;
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
  const fallbackCalculatorModule = data.sections
    .flatMap((section) => section.modules)
    .find((module) => resolveSatToolCapabilities(module.toolPolicy).calculator);
  const calculatorWarmModule =
    currentCalculatorModule ?? pendingCalculatorModule ?? fallbackCalculatorModule ?? null;
  const calculatorWarmAttempt = calculatorWarmModule
    ? findAttemptForModule(data, calculatorWarmModule.id)
    : undefined;
  const calculatorModuleAttemptId =
    currentCalculatorModule && exam.stateModuleAttempt
      ? exam.stateModuleAttempt.id
      : (calculatorWarmAttempt?.id ??
        (calculatorWarmModule ? `prewarm:${calculatorWarmModule.id}` : null));
  const calculatorDisabled =
    exam.blocked || exam.isSubmitting || persistence.failureKind === "superseded";
  const calculatorHost = calculatorModuleAttemptId ? (
    <SatCalculatorPanel
      key="sat-calculator-warm-host"
      open={state.phase === "module" && state.activeTool === "calculator"}
      scheduleId={scheduleId}
      attemptId={attemptId}
      moduleAttemptId={calculatorModuleAttemptId}
      disabled={calculatorDisabled}
      prewarmWhenClosed
      onClose={commands.closeTool}
    />
  ) : null;
  const withCalculatorHost = (content: ReactNode) => (
    <>
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
      />
    );
  }

  if (state.phase === "break") {
    const waitingForScheduledBreak = exam.pendingSectionWaitSeconds > 0;
    return withCalculatorHost(
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
    return withCalculatorHost(<SatLoadingSurface label="Finalizing SAT responses…" />);
  }
  if (state.phase !== "module" && state.phase !== "review") {
    return withCalculatorHost(
      <SatErrorSurface
        title="SAT state unavailable"
        description="The assessment state could not be recovered."
        actionLabel="Exit"
        onAction={() => void onExit()}
      />
    );
  }
  if (!exam.stateModule || !exam.stateModuleAttempt || !exam.stateSection) {
    return withCalculatorHost(<SatLoadingSurface label="Refreshing SAT module…" />);
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
    return withCalculatorHost(
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
          items={navigationItems}
          answeredCount={answeredCount}
          isSubmitting={exam.isSubmitting}
          persistenceBlocked={persistenceBlocked || persistence.pendingCount > 0}
          onSelectQuestion={commands.returnToQuestion}
          onBack={commands.returnToModule}
          onSubmit={() => void commands.submitModule(exam.stateModule!.id)}
        />
      </>
    );
  }

  const questionId = state.questionIds[state.questionIndex];
  const question = exam.stateModule.questions.find(
    (candidate) => candidate.examQuestionId === questionId
  );
  if (!question || !questionId) {
    return withCalculatorHost(
      <SatErrorSurface
        title="SAT question unavailable"
        description="The active question could not be recovered."
        actionLabel="Exit"
        onAction={() => void onExit()}
      />
    );
  }

  const response = responseForQuestion(state.responses, questionId);
  const interactionBlocked =
    exam.blocked || exam.isSubmitting || persistence.failureKind === "superseded";
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

  return withCalculatorHost(
    <>
      {exam.warning ? (
        <SatControlBanner tone="warning">Proctor message: {exam.warning}</SatControlBanner>
      ) : null}
      {error ? <SatControlBanner tone="error">{error}</SatControlBanner> : null}
      {exam.blocked ? <SatBlockingOverlay note={data.proctorNote} /> : null}
      {exam.isSubmitting ? <SatSubmissionOverlay /> : null}
      <SatExamShell
        sectionLabel={activeSectionLabel}
        directions={directions}
        remainingLabel={formatSatTime(exam.remainingSeconds)}
        candidateName={data.candidateName}
        questionIndex={state.questionIndex}
        questionCount={state.questionIds.length}
        navigationItems={navigationItems}
        calculatorAvailable={state.toolCapabilities.calculator}
        calculatorOpen={state.activeTool === "calculator"}
        referenceAvailable={state.toolCapabilities.referenceSheet}
        referenceOpen={state.activeTool === "reference_sheet"}
        blocked={interactionBlocked}
        saveState={saveState}
        saveFailure={persistence.failure}
        questionNote={response.annotations.note}
        readingPreferences={reading.preferences}
        onReadingPreferencesChange={reading.setPreferences}
        onSelectQuestion={commands.selectQuestion}
        onToggleCalculator={commands.toggleCalculator}
        onToggleReference={commands.toggleReference}
        onPrevious={commands.previousQuestion}
        onNext={commands.nextQuestion}
        onReviewModule={commands.reviewModule}
        onSaveNote={(note) => commands.setAnnotationNote(questionId, note)}
        onRetrySave={() => {
          void persistence.retryFailed();
        }}
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
          onToggleReview={() => commands.toggleReview(questionId)}
          onToggleEliminationMode={() => setEliminationMode((enabled) => !enabled)}
          onToggleEliminatedOption={(optionId) =>
            commands.toggleEliminatedOption(questionId, optionId)
          }
        />
      </SatExamShell>

      {state.toolCapabilities.referenceSheet ? (
        <SatReferenceSheetPanel
          open={state.activeTool === "reference_sheet"}
          disabled={interactionBlocked}
          onClose={commands.closeTool}
        />
      ) : null}
    </>
  );
}
