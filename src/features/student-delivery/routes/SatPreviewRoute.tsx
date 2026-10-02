import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SatErrorSurface, SatLoadingSurface } from "../ui/feedback/SatStateSurfaces";
import { hasStructuredContent } from "../../exam-authoring/api/renderingPublic";
import { useSatPreviewController } from "../hooks/useSatPreviewController";
import { SatPreviewControls } from "../ui/SatPreviewControls";
import { formatSatTime } from "../domain/satTiming";
import { resolveSatExamToolPolicy, toSatSectionKey, toSatToolCapabilities } from "../domain/satToolPolicy";
import { answeredSatQuestionCount } from "../domain/satSelectors";
import { createSatReadingPreferences } from "../domain/satReadingPreferences";
import { SatExamShell } from "../ui/SatExamShell";
import { SatQuestionRenderer } from "../ui/question/SatQuestionRenderer";
import { satAnnotationEducationPreviewKey } from "../infrastructure/satAnnotationEducationStore";
import { SatReviewPage } from "../ui/review/SatReviewPage";
import { SatCalculatorHost } from "../ui/tools/SatCalculatorHost";
import { SatReferenceSheetPanel } from "../ui/tools/SatReferenceSheetPanel";
import { SatBreakScreen } from "../ui/transitions/SatBreakScreen";

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

  const nextSection =
    preview.sections[
      preview.sections.findIndex((section) => section.id === preview.section?.id) + 1
    ];
  const upcomingModule =
    preview.view === "break"
      ? [...(nextSection?.modules ?? [])].sort((a, b) => a.displayOrder - b.displayOrder)[0]
      : null;
  const upcomingCalculator =
    upcomingModule &&
    nextSection &&
    toSatToolCapabilities(
      resolveSatExamToolPolicy(toSatSectionKey(nextSection.sectionKey), upcomingModule.toolPolicy)
    ).calculator;
  const calculatorModule = upcomingCalculator
    ? upcomingModule
    : preview.tools.calculator
      ? preview.module
      : null;

  const renderPreview = () => {
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
            nextSectionKey={toSatSectionKey(nextSection?.sectionKey ?? preview.section.sectionKey)}
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
            pendingSaveCount={0}
            saveFailure={null}
            saveFailureKind={null}
            onSelectQuestion={preview.commands.selectQuestion}
            onBack={preview.commands.showQuestions}
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
    const previewVersionId = preview.projection.versionId;
    const previewModuleId = preview.module.id;

    return (
      <>
        {controls}
        <SatExamShell
          moduleIdentity={preview.module.id}
          sectionLabel={label}
          sectionKey={toSatSectionKey(preview.section.sectionKey)}
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
          notesAvailable={preview.toolPolicy.notes}
          blocked={false}
          saveState="idle"
          questionNote={preview.response.annotations.legacyQuestionNote}
          readingPreferences={readingPreferences}
          onReadingPreferencesChange={setReadingPreferences}
          onSelectQuestion={preview.commands.selectQuestion}
          onToggleCalculator={preview.commands.toggleCalculator}
          onToggleReference={preview.commands.toggleReference}
          onPrevious={preview.commands.previousQuestion}
          onNext={preview.commands.nextQuestion}
          onReviewModule={preview.commands.showReview}
          onSaveNote={preview.commands.setNote}
          annotations={preview.response.annotations}
          onAnnotationsChange={preview.commands.setAnnotations}
          answered={Boolean(preview.response.answer.trim())}
          // Preview teaches nothing: it gets its own key so a staff walkthrough
          // never consumes a student's first-run cues.
          educationKey={satAnnotationEducationPreviewKey(examId)}
          referenceTool={
            preview.tools.referenceSheet
              ? (controls) => (
                  <SatReferenceSheetPanel
                    {...controls}
                    open={preview.referenceOpen}
                    scheduleId={`preview:${examId}`}
                    attemptId={previewVersionId}
                    moduleAttemptId={previewModuleId}
                    onClose={preview.commands.closeReference}
                  />
                )
              : undefined
          }
        >
          <SatQuestionRenderer
            sectionKey={toSatSectionKey(preview.section.sectionKey)}
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
      </>
    );
  };
  return (
    <>
      {renderPreview()}
      {!preview.loading && !preview.error && calculatorModule && preview.projection ? (
        <SatCalculatorHost
          moduleId={calculatorModule.id}
          open={preview.view === "questions" && preview.calculatorOpen}
          scheduleId={`preview:${examId}`}
          attemptId={preview.projection.versionId}
          moduleAttemptId={calculatorModule.id}
          examZoom={readingPreferences.examZoom}
          contrastMode={readingPreferences.contrastMode}
          onClose={preview.commands.closeCalculator}
        />
      ) : null}
    </>
  );
}
