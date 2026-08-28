import type { DeliveredQuestion, QuestionRevision } from "./api/assessmentContracts";
import { StructuredContentRenderer } from "./StructuredContentRenderer";
import { hasStructuredContent } from "../exam-authoring/editor/richContent";
import { SingleChoiceAnswer } from "./answers/SingleChoiceAnswer";
import { StudentProducedAnswer } from "./answers/StudentProducedAnswer";

export interface ExamQuestionRendererProps {
  question: QuestionRevision | DeliveredQuestion;
  answer?: string;
  eliminatedOptionIds?: ReadonlySet<string>;
  onAnswerChange?: (answer: string) => void;
  disabled?: boolean;
  showRationale?: boolean;
}

export function ExamQuestionRenderer({
  question,
  answer,
  eliminatedOptionIds,
  onAnswerChange,
  disabled = false,
  showRationale = false,
}: ExamQuestionRendererProps) {
  return (
    <article className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {hasStructuredContent(question.stimulus) ? (
        <section aria-label="Stimulus" className="rounded-xl bg-slate-50 p-4 text-slate-700">
          <StructuredContentRenderer content={question.stimulus} />
        </section>
      ) : null}
      <section aria-label="Question" className="text-slate-900">
        <StructuredContentRenderer content={question.prompt} />
      </section>
      {question.answer.kind === "single_choice" ? (
        <SingleChoiceAnswer
          options={question.answer.options}
          value={answer}
          eliminatedOptionIds={eliminatedOptionIds}
          onChange={onAnswerChange}
          disabled={disabled}
        />
      ) : (
        <StudentProducedAnswer value={answer} onChange={onAnswerChange} disabled={disabled} />
      )}
      {"rationale" in question && showRationale && hasStructuredContent(question.rationale) ? (
        <section
          aria-label="Rationale"
          className="border-t border-slate-200 pt-4 text-sm text-slate-600"
        >
          <StructuredContentRenderer content={question.rationale} />
        </section>
      ) : null}
    </article>
  );
}
