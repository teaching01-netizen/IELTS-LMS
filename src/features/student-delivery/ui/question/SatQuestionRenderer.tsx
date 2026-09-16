import type { DeliveredQuestion } from "../../contracts/assessmentDelivery";
import { hasStructuredContent } from "../../../exam-authoring/api/renderingPublic";
import type { StructuredContent } from '../../../exam-authoring/api/assessmentContracts';
import { SatAnnotatedContent } from '../annotations/SatAnnotatedContent';
import { resolveSatExamToolPolicy } from '../../domain/satToolPolicy';
import type { SatQuestionAnnotations, SatQuestionResponseDraft } from "../../domain/satResponses";
import type { SatSectionKey } from "../../application/satRunnerReducer";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { SatQuestionBody } from "../../../exam-rendering/api/SatQuestionBody";
import { renderSatQuestionImageEnlarge } from "../media/SatQuestionImageEnlarge";
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

/**
 * Question presentation.
 *
 * Annotation MUTATION deliberately does not live here any more: the shell owns
 * it, because the contextual toolbar, the touch dock, the edit dock, and the
 * note card are all shell-level surfaces that must write the same response.
 * This component paints marks (through SatAnnotatedContent, which reads the
 * shell's view context) and reports answer changes.
 */
export function SatQuestionRenderer(props: SatQuestionRendererProps) {
  const hasStimulus = hasStructuredContent(props.question.stimulus);
  // Both SAT sections use the Bluebook two-pane layout when a question has
  // supporting material. Reading and Writing calls that pane a passage;
  // Math uses the product's supporting-material label.
  const split = hasStimulus;
  const stimulusLabel = props.sectionKey === "math" ? "Supporting material" : "Passage";
  const eliminationAvailable = props.question.answer.kind === "single_choice";
  const eliminated = new Set(props.response.eliminatedOptionIds);
  const policy = resolveSatExamToolPolicy(props.sectionKey, []);
  const renderContent = (content: StructuredContent, region: 'stimulus' | 'prompt') => (
    <SatAnnotatedContent
      content={content}
      region={region}
      annotations={props.response.annotations}
      enabled={policy.highlight || policy.underline}
      enlarge={props.disabled ? undefined : { renderEnlarge: renderSatQuestionImageEnlarge }}
    />
  );

  return (
    <SatQuestionWorkspace
      split={split}
      stimulusLabel={stimulusLabel}
      readingPreferences={props.readingPreferences}
      onSplitRatioChange={props.onReadingSplitRatioChange}
      {...(split
        ? {
            stimulus: renderContent(props.question.stimulus, 'stimulus'),
          }
        : {})}
      question={
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
          <SatQuestionBody
            sectionKey={props.sectionKey}
            question={props.question}
            stimulusPlacement={split ? "split" : "inline"}
            renderContent={renderContent}
          >
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
          </SatQuestionBody>
        </div>
      }
    />
  );
}

export type { SatQuestionAnnotations };
