import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { SatMenu } from "@/src/products/sat/ui/Menu";
import type { AssessmentValidationIssue } from "../../contracts/assessment";
import { ReadinessControl } from "./ReadinessControl";

/** Question identity, calm co-edit state, and secondary question actions. */
export function QuestionHeader({
  number,
  contextLabel,
  presenceSlot,
  saveSlot,
  issues,
  onIssueSelect,
  onPreview,
  onDuplicate,
  onDelete,
  onMove,
  onSettings,
  busy = false,
  canMoveUp = false,
  canMoveDown = false,
  readOnly = false,
}: {
  number?: number | undefined;
  contextLabel?: string | null | undefined;
  presenceSlot?: ReactNode;
  saveSlot?: ReactNode;
  issues: AssessmentValidationIssue[];
  onIssueSelect: (field: string | null) => void;
  onPreview: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove?: ((direction: -1 | 1) => void) | undefined;
  onSettings?: (() => void) | undefined;
  busy?: boolean | undefined;
  canMoveUp?: boolean | undefined;
  canMoveDown?: boolean | undefined;
  readOnly?: boolean | undefined;
}) {
  const title = number ? `Question ${number}` : "Edit question";
  const hasCollaboration = presenceSlot != null || saveSlot != null;

  return (
    <header className="sat-spine__question-header mb-9 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex items-baseline gap-2">
        <h2
          id="spine-question-heading"
          className="sat-spine__question-title text-[24px] leading-[1.15] tracking-[-0.035em]"
        >
          {title}
        </h2>
        {contextLabel ? (
          <span className="truncate text-xs font-medium text-muted-foreground" title={contextLabel}>
            {contextLabel}
          </span>
        ) : null}
      </div>
      <div
        className={`sat-spine__question-header-actions flex min-w-0 flex-wrap items-center justify-end gap-1 ${
          hasCollaboration ? "sat-spine__question-header-collaboration" : ""
        }`}
      >
        {presenceSlot != null ? (
          <span className="sat-spine__question-header-presence inline-flex items-center">
            {presenceSlot}
          </span>
        ) : null}
        {saveSlot != null ? (
          <span className="sat-spine__question-header-status inline-flex items-center">
            {saveSlot}
          </span>
        ) : null}
        <ReadinessControl issues={issues} onIssueSelect={onIssueSelect} />
        {onSettings ? (
          <button
            type="button"
            onClick={onSettings}
            className={`${hasCollaboration ? "" : "hidden lg:block "}min-h-11 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring`}
          >
            Settings
          </button>
        ) : null}
        <div className="sat-spine__menu">
          <SatMenu
            compact
            label="Question actions"
            icon={MoreHorizontal}
            align="end"
            items={[
              { id: "preview", label: "Preview question as students will see it", onSelect: onPreview },
              { id: "duplicate", label: "Duplicate question", disabled: readOnly || busy, onSelect: onDuplicate },
              { id: "up", label: "Move up", disabled: readOnly || busy || !canMoveUp || !onMove, onSelect: () => onMove?.(-1) },
              { id: "down", label: "Move down", disabled: readOnly || busy || !canMoveDown || !onMove, onSelect: () => onMove?.(1) },
              { id: "settings", label: "Question settings", disabled: !onSettings, onSelect: () => onSettings?.() },
              { id: "delete", label: "Delete question", destructive: true, separatorBefore: true, disabled: readOnly || busy, onSelect: onDelete },
            ]}
          />
        </div>
      </div>
    </header>
  );
}
