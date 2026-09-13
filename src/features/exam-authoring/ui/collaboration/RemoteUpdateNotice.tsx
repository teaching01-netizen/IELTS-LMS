import { Info, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { authoringMotion } from "@/src/shared/motion";
import { REMOTE_UPDATE_COPY } from "./collaborationCopy";

export interface RemoteUpdateNoticeProps {
  /** Who saved, when known. Null renders the neutral wording. */
  remoteAuthorName: string | null;
  /** Optional question label, e.g. "Q14", for the headline suffix. */
  questionLabel?: string | null;
  /** Opens the Review sheet. */
  onReview: () => void;
  /** Dismiss == keep editing: stays diverged, the dot remains. */
  onDismiss?: (() => void) | undefined;
  /** The footer/status surface owns the polite announcement when it also renders. */
  announce?: boolean;
}

/**
 * Diverged-editor banner: a 44px single line docked under the question title.
 *
 * Deliberately not an overlay and not a transient popup: it is an inline row in
 * the layout, so it never steals focus. It also never moves the cursor, never
 * scrolls, and offers no destructive action inline — `Review` is one deliberate
 * click deeper. The word "conflict" does not appear here: these two revisions
 * may not even touch the same field.
 */
export function RemoteUpdateNotice({
  remoteAuthorName,
  questionLabel = null,
  onReview,
  onDismiss,
  announce = true,
}: RemoteUpdateNoticeProps) {
  const reduceMotion = useReducedMotion();
  const headline =
    remoteAuthorName && questionLabel
      ? `${REMOTE_UPDATE_COPY.headline} — ${remoteAuthorName} saved ${questionLabel}`
      : REMOTE_UPDATE_COPY.headline;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduceMotion ? { duration: 0 } : authoringMotion.state}
      // The reserved row (min-h-11 = 44px) is what keeps the editor from
      // shifting when this appears or dismisses.
      className="flex min-h-11 w-full items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-950"
      data-testid="remote-update-notice"
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
    >
      <Info size={16} aria-hidden="true" className="shrink-0 text-amber-800" />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-medium">{headline}</span>
        <span className="text-amber-900">
          {" — "}
          {REMOTE_UPDATE_COPY.safety} {REMOTE_UPDATE_COPY.contract}
        </span>
      </p>
      <button
        type="button"
        onClick={onReview}
        className="shrink-0 rounded-md bg-amber-900/90 px-2.5 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
      >
        {REMOTE_UPDATE_COPY.review}
      </button>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={REMOTE_UPDATE_COPY.dismissLabel}
          className="shrink-0 rounded-md p-1 text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </motion.div>
  );
}
