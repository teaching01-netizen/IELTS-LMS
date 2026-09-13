import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, CircleAlert, Cloud, LoaderCircle } from "lucide-react";
import { authoringMotion } from "@/src/shared/motion";
import type { QuestionSaveStatus } from "../../hooks/useQuestionAutosave";
import { SAVE_CONFLICT_COPY, saveBlockedCopy, saveStatusCopy } from "../../realtime/connectionCopy";

export interface SaveClusterProps {
  status: QuestionSaveStatus;
  /**
   * Phase 05: the open question has unsaved work AND a newer remote revision.
   * Swaps the status copy to `Newer version available` without inventing a new
   * save status — the draft is still saveable, it is just behind. The 409
   * `conflict` status keeps its own, different wording (a fenced write is not
   * the same condition as a known-newer revision).
   */
  diverged?: boolean;
  lastSavedAt: Date | null;
  onRetry?: (() => void) | undefined;
  onReviewConflict?: (() => void) | undefined;
  /** Header only: quietly hide success, never exceptional save states. */
  transientSaved?: boolean;
  /** The footer is the single live announcer when two copies render. */
  announce?: boolean;
}

/**
 * StrictMode-safe previous value: the ref is read during render but only
 * written in an effect, so double-rendered commits stay consistent and the
 * first mount always reports no previous value.
 */
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

/**
 * Single save truth (plan Phase 7): one vocabulary for QuestionSaveStatus,
 * one component rendered in the header slot AND the footer from the same
 * autosave object. Error is a Retry button; everything else is read-only
 * status text with a polite live region.
 */
export function SaveCluster({ status, lastSavedAt, onRetry, onReviewConflict, diverged = false, transientSaved = false, announce = true }: SaveClusterProps) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (!transientSaved || status !== 'saved') return;
    const timer = window.setTimeout(() => setHidden(true), 1500);
    return () => window.clearTimeout(timer);
  }, [status, lastSavedAt, transientSaved]);
  const hideSuccess = transientSaved && status === 'saved' && hidden;
  const statusRole = announce ? 'status' : undefined;
  const label = saveStatusCopy({ status, diverged });
  const Icon =
    status === "saving"
      ? LoaderCircle
      : !diverged && (status === "error" || status === "conflict")
        ? CircleAlert
        : status === "saved" && !diverged
          ? Check
          : Cloud;
  const tone =
    diverged
      ? // Divergence is not a failure: neutral attention, never the
        // destructive palette (that stays reserved for a fenced/failed write).
        "text-amber-800"
      : status === "error" || status === "conflict"
        ? "text-destructive"
        : status === "offline"
          ? "text-amber-800"
          : status === "saved"
            ? "text-green-800"
            : "text-muted-foreground";
  // One source for this vocabulary: `connectionCopy.ts`. The fenced branch is
  // the same product condition the socket delivers, so it says the same thing
  // and points at Review instead of at a manual reload.
  const title = diverged
    ? SAVE_CONFLICT_COPY.diverged
    : status === "conflict"
      ? saveBlockedCopy(false)
      : status === "offline"
        ? SAVE_CONFLICT_COPY.offline
        : lastSavedAt
          ? `Last saved ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : label;

  // One-shot Saved tick: true only on the render that ENTERS saved, so
  // typing (unsaved) or re-renders while saved never retrigger the pop.
  // The previous value is written in an effect (never during render) so
  // StrictMode double-render cannot swallow or duplicate the tick.
  const prevStatus = usePrevious(status);
  const isFirstMount = prevStatus === undefined;
  const justSaved = !isFirstMount && prevStatus !== "saved" && status === "saved";

  const faceInner = (
    <>
      {justSaved ? (
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={authoringMotion.snap}
          className="flex"
          aria-hidden="true"
        >
          <Icon size={14} strokeWidth={2.3} />
        </motion.span>
      ) : (
        <Icon size={14} aria-hidden="true" strokeWidth={2.3} />
      )}
      <span>{label}</span>
    </>
  );

  // Error renders instantly: a failed save must offer Retry with no
  // entrance choreography. All other states cross-fade on change.
  const face =
    status === "error" ? (
      <span className={`flex min-w-24 items-center gap-1.5 text-xs font-semibold ${tone}`}>{faceInner}</span>
    ) : (
      <motion.span
        key={status}
        initial={isFirstMount ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={authoringMotion.state}
        className={`flex min-w-24 items-center gap-1.5 text-xs font-semibold ${tone}`}
      >
        {faceInner}
      </motion.span>
    );

  if (status === "error") {
    return (
      <button
        type="button"
        title={title}
        aria-label={`${title}. Retry save`}
        onClick={onRetry}
        className="flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2.5 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span role={statusRole}>{face}</span>
      </button>
    );
  }
  // Conflict AND divergence are actionable: surface the resolution path
  // instead of stranding the author on a read-only status. Without a handler
  // it stays status text.
  if ((diverged || status === "conflict") && onReviewConflict) {
    return (
      <button
        type="button"
        title={title}
        aria-label={`${title}. ${diverged ? "Review newer version" : "Review changes"}`}
        onClick={onReviewConflict}
        className={
          "flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
          (diverged ? "hover:bg-amber-50" : "hover:bg-destructive/10")
        }
      >
        <span role={statusRole}>{face}</span>
      </button>
    );
  }
  return (
    <span title={title} aria-label={title} role={statusRole} aria-hidden={hideSuccess || undefined} data-save-hidden={hideSuccess || undefined} className={"flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2.5 motion-safe:transition-opacity " + (hideSuccess ? "opacity-0" : "opacity-100")}> 
      {face}
    </span>
  );
}
