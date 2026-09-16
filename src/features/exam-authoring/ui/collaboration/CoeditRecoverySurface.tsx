import { useState } from "react";
import { PUBLISH_COPY } from "./collaborationCopy";

export interface CoeditRecoverySurfaceProps {
  /** Why the room cannot continue, in the author's own terms. */
  body: string;
  /**
   * Present only when the room ENDED and a replacement draft can be opened. A
   * refused or oversized write has no replacement to offer, so the button is
   * absent rather than disabled: there is nothing behind it.
   */
  onOpenCurrentDraft?: () => void;
  onReviewMyChanges?: () => void;
  onCopyMyChanges: () => void;
  /**
   * Present only when a preserved local copy exists. Discarding it is the one
   * destructive action here, so the button asks once before it acts: the copy
   * is on this device precisely because the server never received it.
   */
  onDiscardLocalCopy?: () => void;
}

/** Recovery for a prompt room that cannot continue; the editor stays mounted. */
export function CoeditRecoverySurface({
  body,
  onOpenCurrentDraft,
  onReviewMyChanges,
  onCopyMyChanges,
  onDiscardLocalCopy,
}: CoeditRecoverySurfaceProps) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  return (
    <section
      role="status"
      aria-label="Draft recovery"
      className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3 text-sm"
      data-testid="coedit-recovery-surface"
    >
      <p className="min-w-0 flex-1 font-medium text-foreground">{body}</p>
      <div className="flex flex-wrap items-center gap-2">
        {onOpenCurrentDraft ? (
          <button
            type="button"
            onClick={onOpenCurrentDraft}
            className="min-h-11 rounded-md px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PUBLISH_COPY.openCurrentDraft}
          </button>
        ) : null}
        {onReviewMyChanges ? (
          <button
            type="button"
            onClick={onReviewMyChanges}
            className="min-h-11 rounded-md px-3 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {PUBLISH_COPY.reviewMyChanges}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCopyMyChanges}
          className="min-h-11 rounded-md px-3 text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PUBLISH_COPY.copyMyWork}
        </button>
        {onDiscardLocalCopy ? (
          confirmingDiscard ? (
            <button
              type="button"
              onClick={() => {
                setConfirmingDiscard(false);
                onDiscardLocalCopy();
              }}
              className="min-h-11 rounded-md px-3 text-xs font-semibold text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PUBLISH_COPY.confirmDiscardLocalCopy}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDiscard(true)}
              className="min-h-11 rounded-md px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {PUBLISH_COPY.discardLocalCopy}
            </button>
          )
        ) : null}
      </div>
    </section>
  );
}
