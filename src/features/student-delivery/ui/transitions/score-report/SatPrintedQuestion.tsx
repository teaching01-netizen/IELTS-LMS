import type { DeliveredQuestion } from '../../../contracts/assessmentDelivery';
import { hasStructuredContent } from '../../../../exam-authoring/api/renderingPublic';
import type { StructuredContent } from '../../../../exam-authoring/api/assessmentContracts';
import { StructuredContentRenderer } from '../../../../exam-rendering/api/structuredContent';
import { SatQuestionBody } from '../../../../exam-rendering/api/SatQuestionBody';
import { createSatReadingPreferences } from '../../../domain/satReadingPreferences';
import { SatQuestionHeader } from '../../question/SatQuestionHeader';
import { SatQuestionWorkspace } from '../../question/SatQuestionWorkspace';
import { SatSingleChoiceAnswer } from '../../question/SatSingleChoiceAnswer';
import { SatStudentProducedAnswer } from '../../question/SatStudentProducedAnswer';
import type { LoadMediaUrl } from '../SatScoreReport';

const PRINT_READING_PREFERENCES = createSatReadingPreferences();
const ignoreAction = () => undefined;
const NO_ELIMINATED_OPTIONS: ReadonlySet<string> = new Set();

/** The actual exam components, frozen for paper; metadata sits outside the
 * workspace. No alternate answer-card/header implementation to drift from it. */
export function SatPrintedQuestion({
  question,
  questionNumber,
  moduleId,
  sectionKey,
  answer,
  markedForReview,
  loadMediaUrl,
  onMediaFailure,
}: {
  question: DeliveredQuestion;
  questionNumber: number;
  moduleId: string;
  sectionKey: string;
  answer: string | null;
  markedForReview: boolean;
  loadMediaUrl?: LoadMediaUrl | undefined;
  onMediaFailure?: (() => void) | undefined;
}) {
  const split = hasStructuredContent(question.stimulus);
  const subject = sectionKey === 'math' ? 'math' : 'reading-writing';
  // Prefix form IDs: the same question can occur in several modules, and the
  // live student screen can still be mounted outside this print portal.
  const printQuestionId = `paper-${moduleId}-${question.examQuestionId}`;
  const choiceIndex = question.answer.kind === 'single_choice'
    ? question.answer.options.findIndex(option => option.id === answer)
    : -1;
  const answerLabel = answer === null ? 'Unanswered'
    : choiceIndex >= 0 ? String.fromCharCode(65 + choiceIndex) : answer;
  const unmatched = answer !== null && question.answer.kind === 'single_choice' && choiceIndex < 0;
  const renderContent = (content: StructuredContent) => (
    <StructuredContentRenderer
      content={content}
      loadMediaUrl={loadMediaUrl}
      onMediaFailure={onMediaFailure}
      questionId={question.examQuestionId}
      eagerMedia
    />
  );

  return (
    <article className="sat-ui sat-paper-question" inert data-review-question={questionNumber}>
      <div className="sat-paper-question-meta">
        <h3>Question {questionNumber}</h3>
        <p>Your answer: {answerLabel}</p>
      </div>
      <div className="sat-paper-exam-frame">
      <SatQuestionWorkspace
        print
        split={split}
        stimulusLabel={subject === 'math' ? 'Supporting material' : 'Passage'}
        stimulus={split ? renderContent(question.stimulus) : undefined}
        readingPreferences={PRINT_READING_PREFERENCES}
        onSplitRatioChange={ignoreAction}
        question={
          <div className="pb-8">
            <SatQuestionHeader
              questionNumber={questionNumber}
              markedForReview={markedForReview}
              eliminationAvailable={false}
              eliminationMode={false}
              disabled={false}
              onToggleReview={ignoreAction}
              onToggleEliminationMode={ignoreAction}
            />
            <SatQuestionBody
              sectionKey={subject}
              question={question}
              stimulusPlacement={split ? 'split' : 'inline'}
              renderContent={renderContent}
            >
              {question.answer.kind === 'single_choice' ? (
                <div data-review-choices="true">
                  <SatSingleChoiceAnswer
                    questionId={printQuestionId}
                    options={question.answer.options}
                    value={answer ?? undefined}
                    eliminatedOptionIds={NO_ELIMINATED_OPTIONS}
                    eliminationMode={false}
                    disabled={false}
                    onChange={ignoreAction}
                    onToggleElimination={ignoreAction}
                    renderOptionContent={option => renderContent(option.content)}
                  />
                </div>
              ) : (
                <div data-review-spr="true">
                  <SatStudentProducedAnswer
                    questionId={printQuestionId}
                    value={answer ?? ''}
                    disabled={false}
                    onChange={ignoreAction}
                  />
                </div>
              )}
              {unmatched ? (
                <p className="sat-paper-response-note">
                  Recorded answer “{answer}” matches none of the listed choices.
                </p>
              ) : null}
            </SatQuestionBody>
          </div>
        }
      />
      </div>
    </article>
  );
}
