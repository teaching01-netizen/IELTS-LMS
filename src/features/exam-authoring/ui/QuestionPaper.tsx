import type { QuestionRevision } from "../contracts/assessment";
import { StructuredContentRenderer } from "../../exam-rendering/api/structuredContent";
import { SatQuestionBody } from "../../exam-rendering/api/SatQuestionBody";

export function QuestionPaper({ question }: { question: QuestionRevision }) {
  const answer = question.answer;
  return (
    <article
      data-testid="question-paper"
      data-question-paper
      data-au-section={question.metadata.sectionKey === "math" ? "math" : "rw"}
      className="sat-proof-paper au-elevation-card mx-auto w-full max-w-[720px] rounded-[2px] border border-au-separator bg-au-surface px-7 py-8 text-[17px] leading-7 sm:px-12 sm:py-11"
    >
      <SatQuestionBody question={question} sectionKey={toSatSectionKey(question.metadata.sectionKey)} stimulusPlacement="inline">
        {answer.kind === "single_choice" ? (
          <fieldset aria-label="Answer choices" className="space-y-3">
            <legend className="sr-only">Answer choices</legend>
            {answer.options.map((option, index) => (
              <div
                key={option.id}
                data-question-choice={option.id}
                className="flex min-h-[68px] items-start gap-3 rounded-[7px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] px-4 py-3.5"
              >
                <span
                  aria-hidden="true"
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[14px] font-semibold ${answer.correctOptionId === option.id ? "border-[var(--sat-accent)] bg-[var(--sat-accent)] text-[var(--sat-accent-text)]" : "border-[var(--sat-text-secondary)] text-[var(--sat-text)]"}`}
                >
                  {String.fromCharCode(65 + index)}
                </span>
                <div className="min-w-0 flex-1 sat-type-body text-[var(--sat-text)]">
                  <StructuredContentRenderer content={option.content} />
                </div>
              </div>
            ))}
          </fieldset>
        ) : (
          <div data-question-spr className="max-w-md border-t border-[var(--sat-divider-soft)] pt-5">
            <p className="sat-type-control-secondary font-semibold text-[var(--sat-text)]">Student-produced response</p>
            <div aria-hidden="true" className="mt-3 h-12 rounded-[6px] border border-[var(--sat-divider)] bg-[var(--sat-surface)]" />
          </div>
        )}
      </SatQuestionBody>
    </article>
  );
}

function toSatSectionKey(sectionKey: QuestionRevision["metadata"]["sectionKey"]): "math" | "reading-writing" {
  return sectionKey === "math" ? "math" : "reading-writing";
}
