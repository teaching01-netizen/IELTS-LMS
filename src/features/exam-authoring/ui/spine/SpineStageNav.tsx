import { useId } from "react";
import type { AssessmentValidationIssue } from "../../contracts/assessment";
import type { SpineStageId } from "./useStageCollapse";

export interface SpineStageMeta {
  id: SpineStageId;
  short: string;
  anchor: string;
}

export const SPINE_STAGES: SpineStageMeta[] = [
  { id: "prompt", short: "Prompt", anchor: "prompt" },
  { id: "material", short: "Material", anchor: "stimulus" },
  { id: "classification", short: "Classify", anchor: "domain" },
  { id: "key", short: "Key", anchor: "answer" },
  { id: "rationale", short: "Rationale", anchor: "rationale" },
  { id: "validation", short: "Validate", anchor: "validation" },
];

function stageHasBlocking(stage: SpineStageId, issues: AssessmentValidationIssue[]): boolean {
  if (!issues.some((issue) => issue.blocking)) return false;
  switch (stage) {
    case "prompt":
      return issues.some((issue) => issue.blocking && issue.path.startsWith("prompt"));
    case "material":
      return issues.some((issue) => issue.blocking && issue.path.startsWith("stimulus"));
    case "classification":
      return issues.some((issue) => issue.blocking && issue.path.startsWith("metadata."));
    case "key":
      return issues.some(
        (issue) =>
          issue.blocking &&
          (issue.path.startsWith("answer") ||
            issue.path.startsWith("acceptedResponses") ||
            issue.path === "answer"),
      );
    case "rationale":
      return issues.some((issue) => issue.blocking && issue.path.startsWith("rationale"));
    case "validation":
      return true;
  }
}

/**
 * Sticky stage navigation for the spine column: Prompt → Material →
 * Key → Ready. Collapsed stages with blocking errors still badge here,
 * so collapsing can never hide required work. Buttons scroll-focus the
 * existing `data-authoring-field` anchors — same plumbing as issue jumps.
 */
export function SpineStageNav({
  issues,
  collapsed,
  onToggle,
}: {
  issues: AssessmentValidationIssue[];
  collapsed: Partial<Record<SpineStageId, boolean>>;
  onToggle: (stage: SpineStageId) => void;
}) {
  const labelId = useId();
  const blockingCount = issues.filter((issue) => issue.blocking).length;
  const readiness = blockingCount === 0 ? "Ready" : `${blockingCount} to fix`;
  return (
    <nav
      aria-labelledby={labelId}
      aria-label="Question stages"
      className="spine-card sticky top-2 z-10 mb-5 flex items-center gap-1 overflow-x-auto p-1.5"
    >
      <span id={labelId} className="sr-only">
        Question stages
      </span>
      {SPINE_STAGES.map((stage) => {
        const hasBlocking = stageHasBlocking(stage.id, issues);
        const isCollapsed = collapsed[stage.id] === true;
        return (
          <button
            key={stage.id}
            type="button"
            onClick={() => onToggle(stage.id)}
            aria-label={`Stage ${stage.short}${hasBlocking ? ", needs attention" : ""}${isCollapsed ? ", collapsed" : ""}`}
            aria-pressed={!isCollapsed}
            data-stage={stage.id}
            className={`flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hasBlocking ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            <span>{stage.short}</span>
            {hasBlocking ? (
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-destructive" />
            ) : null}
          </button>
        );
      })}
      <span
        role="status"
        className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${blockingCount === 0 ? "bg-green-800/10 text-green-800" : "bg-destructive/10 text-destructive"}`}
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${blockingCount === 0 ? "bg-green-800" : "bg-destructive"}`} />
        {readiness}
      </span>
    </nav>
  );
}
