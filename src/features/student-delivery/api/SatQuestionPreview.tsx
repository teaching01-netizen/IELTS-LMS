import { useId, useState } from "react";
import type { DeliveredQuestion, QuestionRevision } from "../../exam-rendering/api/assessmentContracts";
import { createSatReadingPreferences } from "../domain/satReadingPreferences";
import { emptySatQuestionResponse } from "../domain/satResponses";
import { SatQuestionRenderer } from "../ui/question/SatQuestionRenderer";
import { SatReadingLayoutProvider } from "../ui/reading/SatReadingLayoutContext";

export interface SatQuestionPreviewProps {
  question: QuestionRevision;
  questionNumber: number;
}

const ignore = () => undefined;

/** Preview presentation only: no attempt, answer state, timer, or persistence. */
export function SatQuestionPreview({ question, questionNumber }: SatQuestionPreviewProps) {
  const scope = useId();
  const [preferences, setPreferences] = useState(createSatReadingPreferences);
  const answer = question.answer;
  const delivered: DeliveredQuestion = {
    examQuestionId: `${scope}-${question.questionId}`,
    questionId: question.questionId,
    displayOrder: questionNumber - 1,
    isPretest: false,
    questionType: question.questionType,
    stimulus: question.stimulus,
    prompt: question.prompt,
    answer: answer.kind === "single_choice"
      ? { kind: "single_choice", options: answer.options }
      : { kind: "student_produced_response", normalizeFraction: answer.normalizeFraction, normalizeDecimal: answer.normalizeDecimal, numericTolerance: answer.numericTolerance },
    metadata: question.metadata,
    accessibility: question.accessibility,
  };

  return (
    <section aria-label="Student preview" className="sat-ui h-[560px] min-h-0 min-w-0 overflow-hidden border-y border-au-separator bg-au-surface">
      <SatReadingLayoutProvider preferences={preferences}>
        <SatQuestionRenderer
          sectionKey={question.metadata.sectionKey === "math" ? "math" : "reading-writing"}
          questionNumber={questionNumber}
          question={delivered}
          response={emptySatQuestionResponse(delivered.examQuestionId)}
          eliminationMode={false}
          disabled
          disabledReason="Read-only student preview. Answers are unavailable here."
          readingPreferences={preferences}
          onReadingSplitRatioChange={(splitRatio) => setPreferences((current) => ({ ...current, splitRatio }))}
          onAnswerChange={ignore}
          onToggleReview={ignore}
          onToggleEliminationMode={ignore}
          onToggleEliminatedOption={ignore}
        />
      </SatReadingLayoutProvider>
    </section>
  );
}
