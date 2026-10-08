import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { SatMenu } from "@/src/products/sat/ui/Menu";
import type { AssessmentValidationIssue } from "../../contracts/assessment";
import { ReadinessControl } from "./ReadinessControl";

const ICON_BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

/** Question identity, calm co-edit state, and the card's own actions. */
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
  onAddBelow,
  addBelowDisabledReason,
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
  /** Insert a new question after this one. */
  onAddBelow?: (() => void) | undefined;
  /** Why Add below is unavailable (module full…); shown as its tooltip. */
  addBelowDisabledReason?: string | null | undefined;
  onSettings?: (() => void) | undefined;
  busy?: boolean | undefined;
  canMoveUp?: boolean | undefined;
  canMoveDown?: boolean | undefined;
  readOnly?: boolean | undefined;
}) {
  const title = number ? `Question ${number}` : "Edit question";
  const hasCollaboration = presenceSlot != null || saveSlot != null;
  const locked = readOnly || busy;

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
        <div role="group" aria-label={`${title} actions`} className="flex items-center">
          {onAddBelow ? (
            <button
              type="button"
              className={ICON_BUTTON}
              aria-label="Add question below"
              title={addBelowDisabledReason ?? "Add question below"}
              disabled={locked || Boolean(addBelowDisabledReason)}
              onClick={onAddBelow}
            >
              <Plus size={17} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label="Duplicate question"
            title="Duplicate question"
            disabled={locked}
            onClick={onDuplicate}
          >
            <Copy size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label="Move question up"
            title="Move question up"
            disabled={locked || !canMoveUp || !onMove}
            onClick={() => onMove?.(-1)}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            aria-label="Move question down"
            title="Move question down"
            disabled={locked || !canMoveDown || !onMove}
            onClick={() => onMove?.(1)}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${ICON_BUTTON} hover:text-destructive`}
            aria-label="Delete question"
            title="Delete question"
            disabled={locked}
            onClick={onDelete}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
        {onSettings ? (
          <button
            type="button"
            onClick={onSettings}
            className="min-h-11 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Tags &amp; accessibility
          </button>
        ) : null}
        <div className="sat-spine__menu">
          <SatMenu
            compact
            label="Question actions"
            icon={MoreHorizontal}
            align="end"
            items={[
              { id: "preview", label: "Preview question", onSelect: onPreview },
              { id: "settings", label: "Question settings", disabled: !onSettings, onSelect: () => onSettings?.() },
            ]}
          />
        </div>
      </div>
    </header>
  );
}
