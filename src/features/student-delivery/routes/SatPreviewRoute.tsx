import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SatErrorSurface, SatLoadingSurface } from "../ui/feedback/SatStateSurfaces";
import { hasStructuredContent } from "../../exam-authoring/api/renderingPublic";
import { useSatPreviewController } from "../hooks/useSatPreviewController";
import { SatPreviewControls } from "../ui/SatPreviewControls";
import { formatSatTime } from "../domain/satTiming";
import { answeredSatQuestionCount } from "../domain/satSelectors";
import { createSatReadingPreferences } from "../domain/satReadingPreferences";
import { SatExamShell } from "../ui/SatExamShell";
import { SatQuestionRenderer } from "../ui/question/SatQuestionRenderer";
import { SatReviewPage } from "../ui/review/SatReviewPage";
import { SatCalculatorPanel } from "../ui/tools/SatCalculatorPanel";
import { SatReferenceSheetPanel } from "../ui/tools/SatReferenceSheetPanel";
import { SatBreakScreen } from "../ui/transitions/SatBreakScreen";

function sectionKey(value: string): "math" | "reading-writing" {
  return value === "math" ? "math" : "reading-writing";
}

function sectionLabel(displayOrder: number, title: string): string {
  return `Section ${displayOrder + 1}: ${title}`;
}

export function SatPreviewRoute({ examId }: { examId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const backToExam = location.pathname.startsWith("/sat/")
    ? `/sat/exams/${examId}`
    : `/builder/${examId}`;
  const preview = useSatPreviewController(examId);
  const [eliminationMode, setEliminationMode] = useState(false);
  const [readingPreferences, setReadingPreferences] = useState(createSatReadingPreferences);

  useEffect(() => setEliminationMode(false), [preview.question?.examQuestionId]);

  if (preview.loading) return <SatLoadingSurface label="Loading SAT draft preview…" />;
  if (preview.error) {
    return (
      <SatErrorSurface
        title="SAT preview unavailable"
        description={preview.error}
        actionLabel="Retry"
        onAction={() => void preview.reload()}
      />
    );
  }
  if (!preview.projection) {
    return (
      <SatErrorSurface
        title="SAT preview unavailable"
        description="The current draft could not be projected."
      />
    );
  }
  if (!preview.section || !preview.module) {
    return (
      <SatErrorSurface
        title="Nothing to preview yet"
        description="Add at least one module to the SAT draft before opening the full exam preview."
        actionLabel="Return to authoring"
        onAction={() => navigate(backToExam)}
      />
    );
  }

  const controls = (
    <SatPreviewControls
      sections={preview.sections}
      section={preview.section}
      modules={preview.modules}
      module={preview.module}
      refreshAvailable={Boolean(preview.pendingRefresh)}
      canPreviousSection={preview.canPreviousSection}
      canNextSection={preview.canNextSection}
      canPreviousModule={preview.canPreviousModule}
      canNextModule={preview.canNextModule}
      onRefresh={preview.commands.applyPendingRefresh}
      onSectionChange={preview.commands.selectSectionById}
      onModuleChange={preview.commands.selectModuleById}
      onPreviousSection={preview.commands.previousSection}
      onNextSection={preview.commands.nextSection}
      onPreviousModule={preview.commands.previousModule}
      onNextModule={preview.commands.nextModule}
      onShowBreak={preview.commands.showBreak}
      onExit={() => navigate(backToExam)}
    />
  );

  if (preview.view === "break") {
    const sectionIndex = preview.sections.findIndex(
      (candidate) => candidate.id === preview.section!.id
    );
    const nextSection = preview.sections[sectionIndex + 1] ?? null;
    return (
      <>
        {controls}
        <SatBreakScreen
          nextSectionKey={sectionKey(nextSection?.sectionKey ?? preview.section.sectionKey)}
          remainingSeconds={preview.section.breakAfterSeconds}
          {...(nextSection ? { onContinue: preview.commands.nextSection } : {})}
        />
      </>
    );
  }

  const label = sectionLabel(preview.section.displayOrder, preview.section.title);
  const remainingLabel = formatSatTime(preview.module.durationSeconds);

  if (preview.view === "review") {
    return (
      <>
        {controls}
        <SatReviewPage
          sectionLabel={label}
          moduleTitle={preview.module.title}
          remainingLabel={remainingLabel}
          items={preview.navigationItems}
          answeredCount={answeredSatQuestionCount(preview.questionIds, preview.responses)}
          isSubmitting={false}
          persistenceBlocked={false}
          onSelectQuestion={preview.commands.selectQuestion}
          onBack={preview.commands.showQuestions}
          onSubmit={preview.commands.continueFromReview}
        />
      </>
    );
  }

  if (!preview.question || !preview.response) {
    return (
      <>
        {controls}
        <SatErrorSurface
          title="This module has no questions"
          description="Use the staff preview controls to inspect another module or return to authoring."
        />
      </>
    );
  }

  const directions = hasStructuredContent(preview.module.instructions)
    ? preview.module.instructions
    : hasStructuredContent(preview.section.instructions)
      ? preview.section.instructions
      : null;

  return (
    <>
      {controls}
      <SatExamShell
        sectionLabel={label}
        directions={directions}
        remainingLabel={remainingLabel}
        candidateName="Staff Preview"
        questionIndex={preview.questionIndex}
        questionCount={preview.questionIds.length}
        navigationItems={preview.navigationItems}
        calculatorAvailable={preview.tools.calculator}
        calculatorOpen={preview.calculatorOpen}
        referenceAvailable={preview.tools.referenceSheet}
        referenceOpen={preview.referenceOpen}
        blocked={false}
        saveState="idle"
        questionNote={preview.response.annotations.note}
        readingPreferences={readingPreferences}
        onReadingPreferencesChange={setReadingPreferences}
        onSelectQuestion={preview.commands.selectQuestion}
        onToggleCalculator={preview.commands.toggleCalculator}
        onToggleReference={preview.commands.toggleReference}
        onPrevious={preview.commands.previousQuestion}
        onNext={preview.commands.nextQuestion}
        onReviewModule={preview.commands.showReview}
        onSaveNote={preview.commands.setNote}
      >
        <SatQuestionRenderer
          sectionKey={sectionKey(preview.section.sectionKey)}
          questionNumber={preview.questionIndex + 1}
          question={preview.question}
          response={preview.response}
          eliminationMode={eliminationMode}
          disabled={false}
          readingPreferences={readingPreferences}
          onReadingSplitRatioChange={(splitRatio) =>
            setReadingPreferences((current) => ({ ...current, splitRatio }))
          }
          onAnswerChange={preview.commands.setAnswer}
          onToggleReview={preview.commands.toggleReview}
          onToggleEliminationMode={() => setEliminationMode((enabled) => !enabled)}
          onToggleEliminatedOption={preview.commands.toggleEliminatedOption}
        />
      </SatExamShell>
      {preview.tools.calculator ? (
        <SatCalculatorPanel
          open={preview.calculatorOpen}
          scheduleId={`preview:${examId}`}
          attemptId={preview.projection.versionId}
          moduleAttemptId={preview.module.id}
          onClose={preview.commands.closeCalculator}
        />
      ) : null}
      {preview.tools.referenceSheet ? (
        <SatReferenceSheetPanel
          open={preview.referenceOpen}
          onClose={preview.commands.closeReference}
        />
      ) : null}
    </>
  );
}
