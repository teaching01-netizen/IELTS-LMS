import { Bookmark } from "lucide-react";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";

export interface SatQuestionStatusGridProps {
  items: readonly SatQuestionNavigationItem[];
  onSelectQuestion: (index: number) => void;
}

export function SatQuestionStatusGrid({ items, onSelectQuestion }: SatQuestionStatusGridProps) {
  return (
    <div
      className="grid grid-cols-6 gap-3 sm:grid-cols-9 md:grid-cols-11"
      aria-label="Question status"
    >
      {items.map((item) => {
        const answered = item.status === "answered";
        return (
          <button
            type="button"
            key={item.id}
            onClick={() => onSelectQuestion(item.index)}
            aria-label={`Question ${item.number}${answered ? ", answered" : ", unanswered"}${item.markedForReview ? ", marked for review" : ""}`}
            className={`sat-pressable sat-state-transition relative h-11 min-w-11 border text-[14px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 ${answered ? "border-[var(--sat-accent)] bg-[var(--sat-accent)] text-[var(--sat-accent-text)]" : "border-dashed border-[var(--sat-text)] bg-[var(--sat-surface)] text-[var(--sat-accent-strong)]"}`}
          >
            {item.number}
            {item.markedForReview ? (
              <Bookmark
                className="absolute -right-1 -top-2 h-4 w-4 fill-[var(--sat-review)] text-[var(--sat-review)]"
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
