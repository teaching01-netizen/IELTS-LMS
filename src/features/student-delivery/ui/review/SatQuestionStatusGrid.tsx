import { Bookmark, Check } from "lucide-react";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";
import { SAT_COPY } from "../../domain/satCopy";

export interface SatQuestionStatusGridProps {
  items: readonly SatQuestionNavigationItem[];
  onSelectQuestion: (index: number) => void;
  /** Render the answered/current/flagged legend (review page). Navigator owns its own legend. */
  showLegend?: boolean | undefined;
}

/**
 * Question status grid (Phase 2: legend parity + non-color states).
 *
 * Every state carries a redundant non-color cue so color-blind and
 * low-vision students never depend on fill alone:
 * - answered: filled + check glyph (was fill-only, legend omitted it).
 * - current: ring + bold underline of the number.
 * - flagged: bookmark badge, repositioned off cell edges.
 * Screen-reader names already enumerate state; the visual layer now matches.
 */
export function SatQuestionStatusGrid({ items, onSelectQuestion, showLegend = false }: SatQuestionStatusGridProps) {
  return (
    <div>
      {showLegend ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[var(--sat-text)]" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5">
            <span className="grid h-5 w-5 place-items-center rounded-[4px] border border-[var(--sat-accent)] bg-[var(--sat-accent)] text-[var(--sat-accent-text)]">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            Answered
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="grid h-5 w-5 place-items-center rounded-[4px] border border-dashed border-[var(--sat-text)] text-[var(--sat-accent-strong)]">
              3
            </span>
            Unanswered
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Bookmark className="h-4 w-4 fill-[var(--sat-review)] text-[var(--sat-review)]" aria-hidden="true" />
            {SAT_COPY.flag.flagged}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-6 gap-3 sm:grid-cols-9 md:grid-cols-11" aria-label="Question status">
        {items.map((item) => {
          const answered = item.status === "answered";
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => onSelectQuestion(item.index)}
              aria-label={"Question " + item.number + (answered ? ", answered" : ", unanswered") + (item.markedForReview ? ", flagged" : "") + (item.current ? ", current question" : "")}
              aria-current={item.current ? "step" : undefined}
              className={"sat-pressable sat-state-transition relative grid h-11 min-w-11 place-items-center border text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 " + (answered ? "border-[var(--sat-accent)] bg-[var(--sat-accent)] text-[var(--sat-accent-text)]" : "border-dashed border-[var(--sat-text)] bg-[var(--sat-surface)] text-[var(--sat-accent-strong)]") + (item.current ? " ring-2 ring-[var(--sat-accent)] ring-offset-1" : "")}
            >
              <span className="inline-flex items-center gap-1" style={item.current ? { textDecorationLine: "underline", textUnderlineOffset: "3px" } : undefined}>
                {answered ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                <span aria-hidden="true">{item.number}</span>
              </span>
              {item.markedForReview ? (
                <Bookmark
                  className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-[var(--sat-surface)] fill-[var(--sat-review)] p-[2px] text-[var(--sat-review)] shadow-sm"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
