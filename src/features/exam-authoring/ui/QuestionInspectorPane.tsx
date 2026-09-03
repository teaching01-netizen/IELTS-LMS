import { AlertCircle, CheckCircle2, ChevronRight, X } from "lucide-react";
import type { AssessmentValidationIssue, QuestionRevision } from "../contracts/assessment";
import { plainTextFromContent } from "../editor/richContent";
import { SatStudentResponseEditor } from "./SatStudentResponseEditor";
import { AuthoringSegmented } from "./AuthoringSegmented";
import { QuestionProperties } from "./QuestionProperties";

export type InspectorSection = "content" | "answers" | "validation";

export interface QuestionInspectorPaneProps {
  question: QuestionRevision;
  issues: AssessmentValidationIssue[];
  activeSection: InspectorSection;
  onSectionChange: (section: InspectorSection) => void;
  onChange: (question: QuestionRevision) => void;
  onClose?: () => void;
  onIssueSelect?: (issue: AssessmentValidationIssue) => void;
  /** Renders inside the compact viewport inspector sheet. */
  embedded?: boolean;
}

const sections: Array<{ value: InspectorSection; label: string }> = [
  { value: "content", label: "Content" },
  { value: "answers", label: "Answer key" },
  { value: "validation", label: "Validation" },
];

export function QuestionInspectorPane({
  question,
  issues,
  activeSection,
  onSectionChange,
  onChange,
  onClose,
  onIssueSelect,
  embedded = false,
}: QuestionInspectorPaneProps) {
  const blockingIssues = issues.filter((issue) => issue.blocking);
  const warningIssues = issues.filter((issue) => !issue.blocking);
  const isReady = blockingIssues.length === 0;
  const answer = question.answer;

  return (
    <aside
      id="sat-question-inspector"
      aria-label="Question inspector"
      className={`authoring-inspector flex min-h-0 w-[var(--authoring-inspector-width)] shrink-0 flex-col border-l border-au-separator ${embedded ? "authoring-inspector--embedded !w-full !flex-1 !basis-auto !border-l-0" : ""}`}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-au-separator px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            Inspector
          </p>
          <h2 className="mt-1 truncate text-[14px] font-semibold tracking-[-0.012em] text-slate-950">
            Question details
          </h2>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="authoring-interactive flex h-9 w-9 items-center justify-center rounded-[10px] text-slate-500 hover:bg-au-fill hover:text-slate-950"
            aria-label="Close question inspector"
          >
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div className="border-b border-au-separator px-3 py-2">
        <AuthoringSegmented
          className="w-full"
          ariaLabel="Question inspector sections"
          layoutId="sat-question-inspector-sections"
          value={activeSection}
          onChange={onSectionChange}
          options={sections.map((section) => ({
            value: section.value,
            label: (
              <>
                {section.label}
                {section.value === "validation" && blockingIssues.length ? (
                  <span className="tabular-nums text-au-danger-text">{blockingIssues.length}</span>
                ) : null}
              </>
            ),
          }))}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeSection === "content" ? (
          <section aria-labelledby="sat-inspector-content-heading" className="space-y-4">
            <div>
              <h3 id="sat-inspector-content-heading" className="text-[13px] font-semibold text-slate-950">Content</h3>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                Classify the question so it is easy to find and review later.
              </p>
            </div>
            <QuestionProperties question={question} onChange={onChange} />
          </section>
        ) : null}

        {activeSection === "answers" ? (
          <section aria-labelledby="sat-inspector-answer-heading" className="space-y-4">
            <div>
              <h3 id="sat-inspector-answer-heading" className="text-[13px] font-semibold text-slate-950">Answer key</h3>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                Set the response students must produce or select.
              </p>
            </div>
            {answer.kind === "single_choice" ? (
              <div className="space-y-2" role="group" aria-label="Correct answer">
                {answer.options.map((option, index) => {
                  const letter = String.fromCharCode(65 + index);
                  const selected = answer.correctOptionId === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        onChange({
                          ...question,
                          answer: { ...answer, correctOptionId: option.id },
                        })
                      }
                      className={`flex min-h-11 w-full items-center gap-2 rounded-[11px] border px-3 text-left text-[12px] font-medium transition ${selected ? "border-au-success/30 bg-au-success-tint text-slate-950" : "border-au-separator bg-au-surface hover:bg-au-fill"}`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-[11px] font-bold ${selected ? "bg-au-success-text text-white" : "bg-au-fill text-slate-600"}`}
                      >
                        {selected ? <CheckCircle2 size={14} aria-hidden="true" /> : letter}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {plainTextFromContent(option.content) || `Choice ${letter}`}
                      </span>
                      {selected ? <span className="text-[10px] font-semibold text-au-success-text">Key</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <SatStudentResponseEditor
                acceptedResponses={answer.acceptedResponses}
                onChange={(acceptedResponses) =>
                  onChange({
                    ...question,
                    answer: { ...answer, acceptedResponses },
                  })
                }
              />
            )}
          </section>
        ) : null}

        {activeSection === "validation" ? (
          <section aria-label="Validation" className="space-y-4">
            <div>
              <h3 className="text-[13px] font-semibold text-slate-950">Validation</h3>
              <p className="mt-1 text-[11px] leading-5 text-slate-500">
                Resolve blocking issues before releasing this question.
              </p>
            </div>
            <div
              role="status"
              className={`flex items-start gap-2 rounded-[11px] px-3 py-2.5 text-[11px] font-semibold ${isReady ? "bg-au-success-tint text-au-success-text" : "bg-au-danger-tint text-au-danger-text"}`}
            >
              {isReady ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
              <span>{isReady ? "Ready" : "Needs attention"}</span>
            </div>
            {blockingIssues.length || warningIssues.length ? (
              <div className="space-y-2" aria-label="Question validation issues">
                {[...blockingIssues, ...warningIssues].map((issue) => {
                  const content = (
                    <>
                      {issue.blocking ? <AlertCircle size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                      <span className="min-w-0 flex-1 text-left">{issue.message}</span>
                    </>
                  );
                  return onIssueSelect ? (
                    <button
                      key={`${issue.code}-${issue.path}`}
                      type="button"
                      onClick={() => onIssueSelect(issue)}
                      className={`flex w-full items-start gap-2 rounded-[10px] border px-3 py-2.5 text-[11px] ${issue.blocking ? "border-au-danger/20 bg-au-danger-tint text-au-danger-text" : "border-au-warning/20 bg-au-warning-tint text-au-warning-text"}`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      key={`${issue.code}-${issue.path}`}
                      className={`flex items-start gap-2 rounded-[10px] border px-3 py-2.5 text-[11px] ${issue.blocking ? "border-au-danger/20 bg-au-danger-tint text-au-danger-text" : "border-au-warning/20 bg-au-warning-tint text-au-warning-text"}`}
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[12px] text-slate-500">No blocking issues</p>
            )}
          </section>
        ) : null}
      </div>
    </aside>
  );
}
