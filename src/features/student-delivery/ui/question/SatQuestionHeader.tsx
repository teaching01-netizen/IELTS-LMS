import { Bookmark } from "lucide-react";
import { SAT_COPY } from "../../domain/satCopy";
import { SatCutChoiceGlyph } from "./SatCutChoiceGlyph";

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
    // Reference geometry: the strip is taller than the 44px controls it holds
    // and centres them, so the black number block and the ABC control keep
    // vertical breathing space instead of stretching across the whole row. The
    // strip is light GRAY (only the main exam header is paper white) and its
    // reserved bottom border is transparent: the spectrum rail below paints the
    // bottom edge, so no divider colour contributes pixels to it.
    <div className="relative flex min-h-[var(--sat-question-header-height)] items-center border-b border-transparent bg-[var(--sat-question-header-bg)]">
      {/* Semantic question heading (mobile a11y Task 6): the number cell is a
          real h2 whose accessible name is "Question N" from real text — never
          an aria-label on a generic div. The "Question " prefix is sr-only so
          the visible Bluebook cell keeps its number-only styling. */}
      <h2 className="grid h-11 w-11 shrink-0 place-items-center bg-[var(--sat-text)] sat-type-control-primary font-semibold text-[var(--sat-background)]">
        <span className="sr-only">Question </span>
        {props.questionNumber}
      </h2>
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
      {/* Bluebook Option Eliminator: the compact ABC-strike control at the
          FAR RIGHT of the header, as in the reference. It is icon-only, so the
          accessible name (not a visible label) carries its identity and the
          state rides on the glyph's ink plus aria-pressed — the name must not
          flip between two labels or the control loses its identity for
          screen-reader users. `title` keeps the name discoverable on hover.
          Visual box is 36px inside a real 44px hit target (sat-touch-target). */}
      {props.eliminationAvailable ? (
        <button
          type="button"
          onClick={props.onToggleEliminationMode}
          disabled={props.disabled}
          aria-pressed={props.eliminationMode}
          aria-label={
            props.eliminationMode ? SAT_COPY.flag.turnOffEliminator : SAT_COPY.flag.turnOnEliminator
          }
          title={
            props.eliminationMode ? SAT_COPY.flag.turnOffEliminator : SAT_COPY.flag.turnOnEliminator
          }
          data-sat-eliminator-toggle="true"
          className="sat-touch-target sat-pressable sat-state-transition ml-auto inline-grid h-11 w-11 shrink-0 place-items-center rounded-[6px] hover:bg-[var(--sat-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sat-focus)]"
        >
          <SatCutChoiceGlyph
            // Closed = light surface with a dark-blue outline; open = the SAT
            // blue treatment. Both pairs are tokens, so high contrast wins.
            className={
              props.eliminationMode
                ? "border-[var(--sat-accent)] bg-[var(--sat-accent)] text-[var(--sat-accent-text)]"
                : "border-[var(--sat-accent-strong)] bg-[var(--sat-surface)] text-[var(--sat-accent-strong)]"
            }
          />
        </button>
      ) : null}
      {/* Bluebook parity: the header's bottom divider IS the spectrum rail, one
          continuous line spanning the whole header — under the review control
          and across to the ABC eliminator on the right. Decorative: aria-hidden,
          untabbable, click-through, and last in the row so it paints over the
          controls it passes beneath without moving any of them. */}
      <span aria-hidden="true" data-sat-color-rail="true" className="sat-color-rail" />
    </div>
  );
}
