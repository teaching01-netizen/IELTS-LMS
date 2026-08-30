import { Bookmark, ListX } from "lucide-react";

export interface SatQuestionHeaderProps {
  questionNumber: number;
  markedForReview: boolean;
  eliminationAvailable: boolean;
  eliminationMode: boolean;
  disabled: boolean;
  onToggleReview: () => void;
  onToggleEliminationMode: () => void;
}

export function SatQuestionHeader(props: SatQuestionHeaderProps) {
  return (
    <div className="flex min-h-11 items-stretch border-b border-[var(--sat-divider)] bg-[var(--sat-surface-subtle)]">
      <div
        className="grid w-11 shrink-0 place-items-center bg-[var(--sat-text)] sat-type-control-primary font-semibold text-[var(--sat-background)]"
        aria-label={`Question ${props.questionNumber}`}
      >
        {props.questionNumber}
      </div>
      <button
        type="button"
        onClick={props.onToggleReview}
        disabled={props.disabled}
        aria-pressed={props.markedForReview}
        className="sat-pressable min-h-11 inline-flex min-w-0 flex-1 items-center gap-2 px-3 sat-type-control-secondary font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]"
      >
        <Bookmark
          className={`sat-state-transition h-5 w-5 ${props.markedForReview ? "fill-[var(--sat-review)] text-[var(--sat-review)]" : "text-[var(--sat-text)]"}`}
          aria-hidden="true"
        />
        {props.markedForReview ? "Marked for Review" : "Mark for Review"}
      </button>
      {props.eliminationAvailable ? (
        <button
          type="button"
          onClick={props.onToggleEliminationMode}
          disabled={props.disabled}
          aria-pressed={props.eliminationMode}
          aria-label={
            props.eliminationMode ? "Turn off option eliminator" : "Turn on option eliminator"
          }
          className={`sat-pressable sat-state-transition grid min-h-11 w-11 shrink-0 place-items-center border-l border-[var(--sat-divider-soft)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] ${props.eliminationMode ? "bg-[var(--sat-surface-hover)] text-[var(--sat-text)]" : "text-[var(--sat-text)]"}`}
        >
          <ListX className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
