import { canPublishFromBlockers, getPublishBlockers } from "../release/releaseSelectors";

export interface ReleaseGateCardProps {
  readinessFresh: boolean;
  readinessValid: boolean;
  dirtyCount: number;
  isPublishing: boolean;
  blockerCount: number;
  releaseHref: string;
  canEdit?: boolean;
  canPublishExam?: boolean;
  lifecycleState?: "never_published" | "published_current" | "unpublished_changes" | null;
  onOpenRelease: () => void;
}

/**
 * Forward release gating: delegates to the shared getPublishBlockers
 * selector so this card can never drift from SatDeliveryReleasePage.
 * No publish logic lives here — the card links to /release where the
 * authoritative flow runs.
 */
export function ReleaseGateCard({
  readinessFresh,
  readinessValid,
  dirtyCount,
  isPublishing,
  blockerCount,
  releaseHref,
  canEdit = true,
  canPublishExam = true,
  lifecycleState = null,
  onOpenRelease,
}: ReleaseGateCardProps) {
  const reasons = getPublishBlockers({
    lifecycleState,
    readinessFresh,
    readinessValid,
    blockerCount,
    dirtyCount,
    isPublishing,
    canEdit,
    canPublishExam,
  });
  const canPublish = canPublishFromBlockers(reasons);

  return (
    <section aria-label="Release readiness" className="spine-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Release</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {canPublish
          ? "Publish checks pass. Open delivery and release to publish."
          : "Release is unavailable until every precondition below is met."}
      </p>
      {canPublish ? null : (
        <ul aria-label="Release preconditions" className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <a
        href={releaseHref}
        onClick={(event) => {
          if (!canPublish) event.preventDefault();
          else onOpenRelease();
        }}
        aria-disabled={canPublish ? undefined : "true"}
        aria-describedby={canPublish ? undefined : "spine-release-reasons"}
        className={`mt-3 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${canPublish ? "bg-primary text-primary-foreground hover:bg-primary/90" : "cursor-not-allowed bg-muted text-muted-foreground"}`}
      >
        Open delivery &amp; release
      </a>
      <span id="spine-release-reasons" className="sr-only">
        {canPublish ? "Release preconditions met." : reasons.join(". ")}
      </span>
    </section>
  );
}
