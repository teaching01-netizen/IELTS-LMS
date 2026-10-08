import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import type { AssessmentAccessLink } from "../../contracts/accessLinks";
import { satRunSheetTimingPlan } from "../../../../products/sat/ui/sessionRunSheet";
import { AuthoringDialog } from "../authoringPrimitives";
import { satPublishScopeCopy } from "../release/releaseSelectors";
import { ENTRY_STATE, type AccessSessionInfo } from "./sessionState";

export interface StartSessionReviewDialogProps {
  open: boolean;
  link: AssessmentAccessLink;
  info: AccessSessionInfo | null;
  joined: number;
  disabledReason?: string | null;
  onRefresh?: () => void;
  onCancel: () => void;
  /** Starts THIS group's session; rejects with a readable error to keep the dialog open for a retry. */
  onConfirm: () => Promise<void>;
}

/**
 * One short review before a session starts. Starting is always about a single
 * access group, so the dialog names the group, its version and scope, who has
 * joined, and what the stored timing model means for late arrivals.
 */
export function StartSessionReviewDialog({ open, link, info, joined, disabledReason, onRefresh, onCancel, onConfirm }: StartSessionReviewDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const plan = satRunSheetTimingPlan(info?.timingModel);

  useEffect(() => {
    if (!open) {
      setError(null);
      setPending(false);
      submitting.current = false;
    }
  }, [open]);

  const confirm = async () => {
    if (submitting.current || disabledReason) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The session could not be started.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <AuthoringDialog
      open={open}
      title={`Start ${link.name}?`}
      description={`${link.examTitle} · Version ${link.versionNumber} · ${satPublishScopeCopy(link.publishScope)}`}
      onClose={onCancel}
      closeDisabled={pending}
    >
      <div className="space-y-4 p-5 pt-2">
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-4 text-sm">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Students registered</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{joined}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Student entry</dt>
            <dd className="mt-0.5 text-base font-semibold text-foreground">{ENTRY_STATE[link.status]}</dd>
          </div>
        </dl>
        <div className="text-sm leading-6 text-muted-foreground">
          {plan ? (
            <>
              <p className="font-semibold text-foreground">{plan.label}</p>
              <p className="mt-0.5">{plan.perCandidate ? "Each student receives the full configured time. Module and break timers run individually." : "Students share the session clock. Late arrivals receive the time remaining in the current window."}</p>
            </>
          ) : (
            <p>
              The timing model for this session is not reported yet. Start timing is described in the session room once it
              opens.
            </p>
          )}
        </div>
        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            {error}
            <span className="mt-1 block">We could not confirm the start. Check the current status before retrying.</span>
          </p>
        ) : null}
        {disabledReason ? <p role="status" className="text-sm text-amber-800">{disabledReason}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            data-dialog-initial-focus
            className="min-h-11 rounded-xl bg-muted px-4 text-sm font-semibold text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            Cancel
          </button>
          {onRefresh && (error || disabledReason) ? (
            <button type="button" onClick={onRefresh} disabled={pending} className="min-h-11 rounded-xl bg-muted px-4 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Refresh status</button>
          ) : null}
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={pending || Boolean(disabledReason)}
            aria-busy={pending || undefined}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            {pending ? "Starting…" : "Start and open session"}
          </button>
        </div>
      </div>
    </AuthoringDialog>
  );
}
