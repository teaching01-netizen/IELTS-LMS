import type { DeliveredQuestion } from "../../contracts/assessmentDelivery";
import { hasStructuredContent } from "../../../exam-authoring/api/renderingPublic";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";
import type { SatQuestionResponseDraft } from "../../domain/satResponses";
import type { SatSectionKey } from "../../application/satRunnerReducer";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { SatQuestionHeader } from "./SatQuestionHeader";
import { SatQuestionWorkspace } from "./SatQuestionWorkspace";
import { SatSingleChoiceAnswer } from "./SatSingleChoiceAnswer";
import { SatStudentProducedAnswer } from "./SatStudentProducedAnswer";

export interface SatQuestionRendererProps {
  sectionKey: SatSectionKey;
  questionNumber: number;
  question: DeliveredQuestion;
  response: SatQuestionResponseDraft;
  eliminationMode: boolean;
  disabled: boolean;
  readingPreferences: SatReadingPreferences;
  onReadingSplitRatioChange: (ratio: number) => void;
  onAnswerChange: (answer: string) => void;
  onToggleReview: () => void;
  onToggleEliminationMode: () => void;
  onToggleEliminatedOption: (optionId: string) => void;
}

export function SatQuestionRenderer(props: SatQuestionRendererProps) {
  const hasStimulus = hasStructuredContent(props.question.stimulus);
  const split = props.sectionKey === "reading-writing" && hasStimulus;
  const eliminationAvailable = props.question.answer.kind === "single_choice";
  const eliminated = new Set(props.response.eliminatedOptionIds);

  const questionContent = (
    <div className="pb-8">
      <SatQuestionHeader
        questionNumber={props.questionNumber}
        markedForReview={props.response.markedForReview}
        eliminationAvailable={eliminationAvailable}
        eliminationMode={props.eliminationMode}
        disabled={props.disabled}
        onToggleReview={props.onToggleReview}
        onToggleEliminationMode={props.onToggleEliminationMode}
      />
      <div className="pt-4 sat-exam-prose sat-type-body text-[var(--sat-text)]">
        {!split && hasStimulus ? (
          <div className="mb-6 border-b border-[var(--sat-divider-soft)] pb-5">
            <StructuredContentRenderer content={props.question.stimulus} />
          </div>
        ) : null}
        <div className="mb-5">
          <StructuredContentRenderer content={props.question.prompt} />
        </div>
      </div>
      {props.question.answer.kind === "single_choice" ? (
        <SatSingleChoiceAnswer
          questionId={props.question.examQuestionId}
          options={props.question.answer.options}
          value={props.response.answer || undefined}
          eliminatedOptionIds={eliminated}
          eliminationMode={props.eliminationMode}
          disabled={props.disabled}
          onChange={props.onAnswerChange}
          onToggleElimination={props.onToggleEliminatedOption}
        />
      ) : (
        <SatStudentProducedAnswer
          questionId={props.question.examQuestionId}
          value={props.response.answer}
          disabled={props.disabled}
          onChange={props.onAnswerChange}
        />
      )}
    </div>
  );

  return (
    <SatQuestionWorkspace
      split={split}
      readingPreferences={props.readingPreferences}
      onSplitRatioChange={props.onReadingSplitRatioChange}
      {...(split
        ? {
            stimulus: <StructuredContentRenderer content={props.question.stimulus} />,
          }
        : {})}
      question={questionContent}
    />
  );
}
