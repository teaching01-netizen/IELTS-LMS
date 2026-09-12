import { Bookmark, ListX } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";

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
        aria-label={props.markedForReview ? SAT_COPY.flag.markedForReview : SAT_COPY.flag.markForReview}
        title={props.markedForReview ? SAT_COPY.flag.markedForReview : SAT_COPY.flag.markForReview}
        className="sat-pressable min-h-11 inline-flex min-w-11 flex-none items-center justify-center gap-2 px-2.5 sat-type-control-secondary font-medium text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]"
      >
        <Bookmark
          // Review signal (Phase 6): review-red fill on the icon ONLY via
          // the semantic alias; the label keeps text color (black).
          className={`sat-state-transition h-5 w-5 shrink-0 ${props.markedForReview ? "fill-[var(--sat-review-active)] text-[var(--sat-review-active)]" : "text-[var(--sat-text)]"}`}
          aria-hidden="true"
        />
        {/* Icon + short label at narrow widths: the full Bluebook label is
            icon-only below sm (accessible name kept via aria-label), so the
            44px touch target never squeezes below minimum. */}
        <span aria-hidden="true" className="hidden truncate sm:inline">{props.markedForReview ? SAT_COPY.flag.markedForReview : SAT_COPY.flag.markForReview}</span>
      </button>
      {/* Bluebook Option Eliminator (Phase 6): the mode toggle carries a
          VISIBLE static label instead of an icon-only affordance; state lives
          in fill + aria-pressed, never in label text — the label must not
          flip between on/off or screen-reader users lose control identity.
          The strikethrough style evokes Bluebook's [ABC] affordance. */}
      {props.eliminationAvailable ? (
        <button
          type="button"
          onClick={props.onToggleEliminationMode}
          disabled={props.disabled}
          aria-pressed={props.eliminationMode}
          aria-label={
            props.eliminationMode ? SAT_COPY.flag.turnOffEliminator : SAT_COPY.flag.turnOnEliminator
          }
          className={`sat-pressable sat-state-transition inline-flex min-h-11 shrink-0 items-center gap-1.5 border-l border-[var(--sat-divider-soft)] px-3 sat-type-control-secondary font-medium hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)] ${props.eliminationMode ? "bg-[var(--sat-surface-hover)] text-[var(--sat-text)]" : "text-[var(--sat-text)]"}`}
        >
          <ListX
            // Eliminator state (Phase 6): static ABC label (below) + fill +
            // aria-pressed carry state; accent-soft fill tokenized.
            className={`h-5 w-5 shrink-0 ${props.eliminationMode ? "fill-[var(--sat-accent-soft)] text-[var(--sat-accent)]" : ""}`}
            aria-hidden="true"
          />
          {/* Label collapses below sm like the mark button (accessible
              name kept via aria-label), so neither control squeezes below
              the 44px touch minimum at 320px / 200%. */}
          <span aria-hidden="true" className="hidden truncate sm:inline"><span className="line-through decoration-[1.5px]">ABC</span> {SAT_COPY.flag.optionEliminator}</span>
        </button>
      ) : null}
    </div>
  );
}
