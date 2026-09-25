import type { DeliveredQuestion } from "../../contracts/assessmentDelivery";
import { hasStructuredContent } from "../../../exam-authoring/api/renderingPublic";
import type { StructuredContent } from '../../../exam-authoring/api/assessmentContracts';
import { SatAnnotatedContent } from '../annotations/SatAnnotatedContent';
import { resolveSatExamToolPolicy } from '../../domain/satToolPolicy';
import type { SatQuestionAnnotations, SatQuestionResponseDraft } from "../../domain/satResponses";
import type { SatSectionKey } from "../../application/satRunnerReducer";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { SatQuestionBody } from "../../../exam-rendering/api/SatQuestionBody";
import { SAT_QUESTION_IMAGE_ENLARGE } from "../media/SatQuestionImageEnlarge";
import { SatQuestionHeader } from "./SatQuestionHeader";
import { SatQuestionWorkspace } from "./SatQuestionWorkspace";
import { SatSingleChoiceAnswer } from "./SatSingleChoiceAnswer";
import { SatStudentProducedAnswer } from "./SatStudentProducedAnswer";
import { satChoiceAnnotationRegion, type SatAnnotationRegion } from '../../domain/satAnnotationIdentity';

export interface SatQuestionRendererProps {
  sectionKey: SatSectionKey;
  questionNumber: number;
  /** Stable scope identity for transient app-owned selection state. */
  selectionScopeKey?: string | undefined;
  question: DeliveredQuestion;
  response: SatQuestionResponseDraft;
  eliminationMode: boolean;
  disabled: boolean;
  readingPreferences: SatReadingPreferences;
  onReadingSplitRatioChange: (ratio: number) => void;
  onAnswerChange: (answer: string) => void;
  onAnswerBlur?: (() => void) | undefined;
  onToggleReview: () => void;
  onToggleEliminationMode: () => void;
  onToggleEliminatedOption: (optionId: string) => void;
  loadMediaUrl?: ((assetId: string) => Promise<string | null>) | undefined;
  onMediaFailure?: ((assetId: string, questionId: string) => void) | undefined;
}

/**
 * Question presentation.
 *
 * Annotation MUTATION deliberately does not live here any more: the shell owns
 * it, because the contextual toolbar and the note card are both shell-level
 * surfaces that must write the same response.
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
  const selectionScopeKey = props.selectionScopeKey ?? `${props.sectionKey}::${props.question.examQuestionId}`;
  const renderContent = (content: StructuredContent, region: SatAnnotationRegion) => (
    <SatAnnotatedContent
      content={content}
      region={region}
      selectionScopeKey={selectionScopeKey}
      annotations={props.response.annotations}
      enabled={policy.highlight || policy.underline}
      // Figure inspection follows the same policy shape as annotation: a module
      // whose policy does not advertise image zoom gets a plain, unlensed
      // figure rather than a disabled strip.
      enlarge={props.disabled || !policy.imageZoom ? undefined : SAT_QUESTION_IMAGE_ENLARGE}
      loadMediaUrl={props.loadMediaUrl}
      onMediaFailure={props.onMediaFailure}
      questionId={props.question.examQuestionId}
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
                onBlur={props.onAnswerBlur}
                onToggleElimination={props.onToggleEliminatedOption}
                renderOptionContent={(option) =>
                  renderContent(option.content, satChoiceAnnotationRegion(option.id))
                }
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
