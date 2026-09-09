import { AlertCircle, CheckCircle2, ChevronRight } from "lucide-react";
import type { AssessmentValidationIssue } from "../../contracts/assessment";

export interface ValidationChecklistProps {
  issues: AssessmentValidationIssue[];
  onIssueSelect: (issue: AssessmentValidationIssue) => void;
}

/**
 * Inline per-question validation checklist (plan Phase 6): blocking issues
 * first, each item forwards to the workspace field scroll-focus handler
 * (`resolveAuthoringField` + `[data-authoring-field]` anchors — same
 * plumbing as the legacy inspector tab). role=status summary included.
 */
export function ValidationChecklist({ issues, onIssueSelect }: ValidationChecklistProps) {
  const blocking = issues.filter((issue) => issue.blocking);
  const warnings = issues.filter((issue) => !issue.blocking);
  const isReady = blocking.length === 0;
  const ordered = [...blocking, ...warnings];

  return (
    <section aria-label="Validation" className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Validation</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Resolve blocking issues before releasing this question.
      </p>
      <div
        role="status"
        className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2.5 text-xs font-semibold ${isReady ? "bg-green-800/10 text-green-800" : "bg-destructive/10 text-destructive"}`}
      >
        {isReady ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
        <span>{isReady ? "Ready" : "Needs attention"}</span>
      </div>
      {ordered.length ? (
        <div className="mt-2 space-y-2" aria-label="Question validation issues">
          {ordered.map((item) => (
            <button
              key={`${item.code}-${item.path}`}
              type="button"
              onClick={() => onIssueSelect(item)}
              className={`flex w-full items-start gap-2 rounded-md border px-3 py-2.5 text-left text-xs transition-colors ${item.blocking ? "border-destructive/25 bg-destructive/[0.06] text-destructive" : "border-amber-800/25 bg-amber-800/[0.07] text-amber-800"}`}
            >
              {item.blocking ? <AlertCircle size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
              <span className="min-w-0 flex-1">{item.message}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No blocking issues</p>
      )}
    </section>
  );
}
