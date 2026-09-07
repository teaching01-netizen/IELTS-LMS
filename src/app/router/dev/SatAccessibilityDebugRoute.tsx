import { useMemo, useState } from "react";
import type { DeliveredQuestion } from "../../../features/student-delivery/contracts/assessmentDelivery";
import type { SatQuestionResponseDraft } from "../../../features/student-delivery/domain/satResponses";
import { useSatReadingPreferences } from "../../../features/student-delivery/hooks/useSatReadingPreferences";
import { SatExamShell } from "../../../features/student-delivery/ui/SatExamShell";
import { SatQuestionRenderer } from "../../../features/student-delivery/ui/question/SatQuestionRenderer";
import { SatBlockingOverlay } from "../../../features/student-delivery/ui/feedback/SatControlFeedback";
import { SatCalculatorPanel } from "../../../features/student-delivery/ui/tools/SatCalculatorPanel";
import { SatReferenceSheetPanel } from "../../../features/student-delivery/ui/tools/SatReferenceSheetPanel";

const paragraph = (id: string, text: string) => ({
  version: 1 as const,
  nodes: [{ type: "paragraph" as const, id, text }],
});

const readingQuestion: DeliveredQuestion = {
  examQuestionId: "debug-q1",
  questionId: "debug-question",
  displayOrder: 0,
  isPretest: false,
  questionType: "single_choice",
  stimulus: paragraph(
    "stimulus",
    "Several researchers examined how urban tree cover changes surface temperature during periods of extreme heat. Their results suggest that the relationship depends on both canopy density and the surrounding built environment."
  ),
  prompt: paragraph("prompt", "Which choice best states the main idea of the text?"),
  answer: {
    kind: "single_choice",
    options: [
      {
        id: "a",
        content: paragraph(
          "a",
          "Tree cover can affect heat differently depending on local conditions."
        ),
      },
      {
        id: "b",
        content: paragraph(
          "b",
          "All cities experience identical temperature changes from tree cover."
        ),
      },
      {
        id: "c",
        content: paragraph("c", "Built environments have no relationship to urban temperature."),
      },
      {
        id: "d",
        content: paragraph("d", "Researchers no longer study the effects of extreme heat."),
      },
    ],
  },
  metadata: {
    sectionKey: "reading-writing",
    domain: "Information and Ideas",
    skill: "Central Ideas and Details",
    difficulty: "medium",
    tags: [],
  },
  accessibility: { longDescription: null },
};

const mathQuestion: DeliveredQuestion = {
  ...readingQuestion,
  examQuestionId: "debug-math-q1",
  questionId: "debug-math-question",
  stimulus: { version: 1, nodes: [] },
  prompt: paragraph("math-prompt", "If 3x + 5 = 20, what is the value of x?"),
  metadata: {
    sectionKey: "math",
    domain: "Algebra",
    skill: "Linear equations",
    difficulty: "easy",
    tags: [],
  },
  answer: {
    kind: "single_choice",
    options: [
      { id: "a", content: paragraph("ma", "3") },
      { id: "b", content: paragraph("mb", "5") },
      { id: "c", content: paragraph("mc", "10") },
      { id: "d", content: paragraph("md", "15") },
    ],
  },
};

export function SatAccessibilityDebugRoute() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const math = params.get("mode") === "math";
  const paused = params.get("paused") === "1";
  const initialTool =
    params.get("tool") === "calculator"
      ? "calculator"
      : params.get("tool") === "reference"
        ? "reference"
        : null;
  const [activeTool, setActiveTool] = useState<"calculator" | "reference" | null>(initialTool);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [eliminationMode, setEliminationMode] = useState(false);
  const reading = useSatReadingPreferences("debug-schedule", "debug-attempt");
  const [response, setResponse] = useState<SatQuestionResponseDraft>({
    questionId: math ? mathQuestion.examQuestionId : readingQuestion.examQuestionId,
    answer: "",
    markedForReview: false,
    eliminatedOptionIds: [],
    annotations: { version: 2, annotations: [], legacyQuestionNote: "" },
  });
  const question = math ? mathQuestion : readingQuestion;
  const navigationItems = [0, 1, 2].map((index) => ({
    id: `debug-${index}`,
    index,
    number: index + 1,
    status: index === 0 && response.answer ? ("answered" as const) : ("unanswered" as const),
    current: index === questionIndex,
    markedForReview: index === 0 && response.markedForReview,
  }));

  return (
    <>
      {paused ? <SatBlockingOverlay note="Accessibility harness pause" /> : null}
      <SatExamShell
        sectionLabel={math ? "Section 2: Math" : "Section 1: Reading and Writing"}
        directions={paragraph(
          "directions",
          "Answer every question. You may return to questions in this module before submitting it."
        )}
        remainingLabel="27:14"
        remainingSeconds={1634}
        candidateName="Accessibility Candidate"
        questionIndex={questionIndex}
        questionCount={3}
        navigationItems={navigationItems}
        calculatorAvailable={math}
        calculatorOpen={activeTool === "calculator"}
        referenceAvailable={math}
        referenceOpen={activeTool === "reference"}
        notesAvailable={!math}
        blocked={paused}
        saveState="idle"
        questionNote={response.annotations.legacyQuestionNote}
        readingPreferences={reading.preferences}
        onReadingPreferencesChange={reading.setPreferences}
        onSelectQuestion={setQuestionIndex}
        onToggleCalculator={() =>
          setActiveTool((current) => (current === "calculator" ? null : "calculator"))
        }
        onToggleReference={() =>
          setActiveTool((current) => (current === "reference" ? null : "reference"))
        }
        onPrevious={() => setQuestionIndex((current) => Math.max(0, current - 1))}
        onNext={() => setQuestionIndex((current) => Math.min(2, current + 1))}
        onReviewModule={() => undefined}
        onSaveNote={(note) =>
          setResponse((current) => ({ ...current, annotations: { ...current.annotations, legacyQuestionNote: note } }))
        }
      >
        <SatQuestionRenderer
          sectionKey={math ? "math" : "reading-writing"}
          questionNumber={questionIndex + 1}
          question={question}
          response={response}
          eliminationMode={eliminationMode}
          disabled={paused}
          readingPreferences={reading.preferences}
          onReadingSplitRatioChange={(splitRatio) =>
            reading.setPreferences((current) => ({ ...current, splitRatio }))
          }
          onAnswerChange={(answer) => setResponse((current) => ({ ...current, answer }))}
          onAnnotationsChange={(annotations) => setResponse((current) => ({ ...current, annotations }))}
          onToggleReview={() =>
            setResponse((current) => ({ ...current, markedForReview: !current.markedForReview }))
          }
          onToggleEliminationMode={() => setEliminationMode((current) => !current)}
          onToggleEliminatedOption={(optionId) =>
            setResponse((current) => ({
              ...current,
              eliminatedOptionIds: current.eliminatedOptionIds.includes(optionId)
                ? current.eliminatedOptionIds.filter((id) => id !== optionId)
                : [...current.eliminatedOptionIds, optionId],
            }))
          }
        />
      </SatExamShell>
      {math ? (
        <>
          <SatCalculatorPanel
            open={activeTool === "calculator"}
            scheduleId="debug-schedule"
            attemptId="debug-attempt"
            moduleAttemptId="debug-module"
            disabled={paused}
            prewarmWhenClosed
            onClose={() => setActiveTool(null)}
          />
          <SatReferenceSheetPanel
            open={activeTool === "reference"}
            disabled={paused}
            onClose={() => setActiveTool(null)}
          />
        </>
      ) : null}
    </>
  );
}
