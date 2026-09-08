import { useMemo, useState } from "react";
import { Command } from "cmdk";
import type { AssessmentQuestionSummary } from "../../contracts/assessment";
import { matchesQueueSearch, normalizeQueueSearch } from "./queueModel";

export interface QuestionJumpPaletteProps {
  open: boolean;
  questions: AssessmentQuestionSummary[];
  selectedQuestionId: string | null;
  onSelect: (questionId: string) => void;
  onClose: () => void;
}

/**
 * Question jump palette (plan Phase 8): cmdk over module questions with the
 * SAME search semantics as the queue (queueModel). Enter/click selects via
 * the flush-guarded selectQuestion handler passed in — the palette itself
 * owns no navigation or save logic.
 */
export function QuestionJumpPalette({
  open,
  questions,
  selectedQuestionId,
  onSelect,
  onClose,
}: QuestionJumpPaletteProps) {
  const [query, setQuery] = useState("");
  const normalized = normalizeQueueSearch(query);
  const filtered = useMemo(
    () => questions.filter((question) => matchesQueueSearch(question, normalized)),
    [normalized, questions],
  );

  if (!open) return null;
  return (
    <button
      type="button"
      aria-label="Close jump to question"
      className="fixed inset-0 z-[120] flex cursor-default items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Jump to question"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog panel owns Escape dismissal; the scrim button owns pointer dismissal.
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        className="w-full max-w-lg"
      >
      <Command
        label="Jump to question"
        className="w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg"
      >
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search questions…"
          aria-label="Jump to question"
          className="h-12 w-full border-b border-border bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-[40vh] overflow-y-auto p-1.5">
          {filtered.length ? (
            filtered.map((question) => {
              const current = question.examQuestionId === selectedQuestionId;
              return (
                <Command.Item
                  key={question.examQuestionId}
                  value={`${question.displayOrder + 1} ${question.promptPreview} ${question.domain ?? ""} ${question.skill ?? ""}`}
                  onSelect={() => onSelect(question.examQuestionId)}
                  aria-label={`Question ${question.displayOrder + 1}: ${question.promptPreview || "Empty question"}${current ? ", current" : ""}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-foreground aria-selected:bg-muted"
                >
                  <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                    {question.displayOrder + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {question.promptPreview || "Empty question"}
                  </span>
                  {current ? (
                    <span className="shrink-0 text-xs font-semibold text-primary">Current</span>
                  ) : null}
                </Command.Item>
              );
            })
          ) : (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No matching questions. Change the search.
            </p>
          )}
        </Command.List>
      </Command>
      </div>
    </button>
  );
}
