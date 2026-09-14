import { ChevronRight } from "lucide-react";
import type { QuestionSaveStatus } from "../../hooks/useQuestionAutosave";
import { SaveCluster } from "./SaveCluster";

export interface SpineSaveFooterProps {
  status: QuestionSaveStatus;
  lastSavedAt: Date | null;
  /** Phase 05: dirty + a known-newer revision. Same wording as the header. */
  diverged?: boolean | undefined;
  /** Co-edit keeps this indicator in the selected question header only. */
  showSaveStatus?: boolean | undefined;
  keepMetadataForNext: boolean;
  saveDisabled: boolean;
  onKeepMetadataForNextChange: (value: boolean) => void;
  onSaveAndNext: () => void;
  onRetry: () => void;
  onReviewConflict?: (() => void) | undefined;
}

/**
 * Spine footer action bar (plan Phase 7, refined).
 *
 * Autosave is the product behaviour, so the footer reports on it rather than
 * asking the author to perform it: save truth sits quietly on the left beside
 * the carry-metadata preference, and the single filled control on the right is
 * the next step — `Next`, with its shortcut. The label keeps "Save" in its
 * accessible name and title so the behaviour is still discoverable.
 */
export function SpineSaveFooter({
  status,
  lastSavedAt,
  diverged = false,
  showSaveStatus = true,
  keepMetadataForNext,
  saveDisabled,
  onKeepMetadataForNextChange,
  onSaveAndNext,
  onRetry,
  onReviewConflict,
}: SpineSaveFooterProps) {
  return (
    <div className="sat-spine__save-footer flex flex-wrap items-center justify-between gap-3 border-t border-border">
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        {showSaveStatus ? (
          <SaveCluster
            status={status}
            lastSavedAt={lastSavedAt}
            diverged={diverged}
            onRetry={onRetry}
            onReviewConflict={onReviewConflict}
          />
        ) : null}
        {showSaveStatus ? <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" /> : null}
        <label
          htmlFor="sat-spine-carry-metadata"
          className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground"
          title="When moving to the next question, carry Domain, Skill, and Difficulty into the new question."
        >
          <input
            id="sat-spine-carry-metadata"
            type="checkbox"
            aria-label="Carry metadata"
            checked={keepMetadataForNext}
            onChange={(event) => onKeepMetadataForNextChange(event.target.checked)}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          Carry metadata
        </label>
      </div>
      <button
        type="button"
        onClick={onSaveAndNext}
        disabled={saveDisabled}
        aria-label="Save and move to the next question"
        title="Save and move to the next question (⌘↵)"
        className="spine-next flex min-h-11 items-center gap-2 rounded-[10px] px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-100"
      >
        Next
        <span className="sat-spine__kbd" aria-hidden="true">⌘↵</span>
        <ChevronRight size={14} aria-hidden="true" className="opacity-70" />
      </button>
    </div>
  );
}
