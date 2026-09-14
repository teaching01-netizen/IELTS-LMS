import { PUBLISH_COPY } from "./collaborationCopy";

export interface CoeditRecoverySurfaceProps {
  onOpenCurrentDraft: () => void;
  onReviewMyChanges: () => void;
  onCopyMyChanges: () => void;
}

/** Recovery for a closed or replaced prompt room; the editor stays mounted. */
export function CoeditRecoverySurface({
  onOpenCurrentDraft,
  onReviewMyChanges,
  onCopyMyChanges,
}: CoeditRecoverySurfaceProps) {
  return (
    <section
      role="status"
      aria-label="Draft recovery"
      className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 text-sm"
      data-testid="coedit-recovery-surface"
    >
      <p className="min-w-0 flex-1 font-medium text-foreground">{PUBLISH_COPY.recoveryBody}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenCurrentDraft}
          className="min-h-11 rounded-md px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PUBLISH_COPY.openCurrentDraft}
        </button>
        <button
          type="button"
          onClick={onReviewMyChanges}
          className="min-h-11 rounded-md px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PUBLISH_COPY.reviewMyChanges}
        </button>
        <button
          type="button"
          onClick={onCopyMyChanges}
          className="min-h-11 rounded-md px-3 text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PUBLISH_COPY.copyMyWork}
        </button>
      </div>
    </section>
  );
}
