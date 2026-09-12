import { ChevronRight } from "lucide-react";
import type { QuestionSaveStatus } from "../../hooks/useQuestionAutosave";
import { SaveCluster } from "./SaveCluster";

export interface SpineSaveFooterProps {
  status: QuestionSaveStatus;
  lastSavedAt: Date | null;
  keepMetadataForNext: boolean;
  saveDisabled: boolean;
  onKeepMetadataForNextChange: (value: boolean) => void;
  onSaveAndNext: () => void;
  onRetry: () => void;
  onReviewConflict?: (() => void) | undefined;
}

/**
 * Spine footer save cluster (plan Phase 7): status + always-visible
 * carry-metadata + Save & Next docked to the 720px column in normal flow
 * (never floating, never clipped at 200% zoom).
 */
export function SpineSaveFooter({
  status,
  lastSavedAt,
  keepMetadataForNext,
  saveDisabled,
  onKeepMetadataForNextChange,
  onSaveAndNext,
  onRetry,
  onReviewConflict,
}: SpineSaveFooterProps) {
  return (
    <div className="sat-spine__save-footer mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border py-5">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <SaveCluster status={status} lastSavedAt={lastSavedAt} onRetry={onRetry} onReviewConflict={onReviewConflict} />
        <label
          htmlFor="sat-spine-carry-metadata"
          className="flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground"
          title="When Save & Next reaches an empty slot, carry Domain, Skill, and Difficulty into the new question."
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
        title="Save and move to the next question"
        className="flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:opacity-45"
      >
        Save & Next <ChevronRight size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
