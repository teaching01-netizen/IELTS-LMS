export interface ReleaseGateCardProps {
  readinessFresh: boolean;
  readinessValid: boolean;
  dirtyCount: number;
  isPublishing: boolean;
  blockerCount: number;
  releaseHref: string;
  onOpenRelease: () => void;
}

/**
 * Forward release gating (plan Phase 6): mirrors the
 * SatDeliveryReleasePage `canPublish` inputs and enumerates every unmet
 * precondition inline. No publish logic is duplicated — the card links to
 * /release where the authoritative flow lives.
 */
export function ReleaseGateCard({
  readinessFresh,
  readinessValid,
  dirtyCount,
  isPublishing,
  blockerCount,
  releaseHref,
  onOpenRelease,
}: ReleaseGateCardProps) {
  const reasons: string[] = [];
  if (blockerCount > 0) reasons.push(`${blockerCount} blocking issue${blockerCount === 1 ? "" : "s"} to resolve`);
  if (!readinessFresh) reasons.push("Publish checks are stale — refresh them on the release page");
  else if (!readinessValid) reasons.push("Publish checks are failing — resolve the flagged items");
  if (dirtyCount > 0) reasons.push(`${dirtyCount} unsaved delivery section${dirtyCount === 1 ? "" : "s"}`);
  if (isPublishing) reasons.push("Publishing is in progress");
  const canPublish = reasons.length === 0;

  return (
    <section aria-label="Release readiness" className="rounded-lg border border-border bg-card p-4">
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
        className={`mt-3 inline-flex min-h-10 items-center rounded-md px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${canPublish ? "bg-primary text-primary-foreground hover:bg-primary/90" : "cursor-not-allowed bg-muted text-muted-foreground"}`}
      >
        Open delivery & release
      </a>
      <span id="spine-release-reasons" className="sr-only">
        {canPublish ? "Release preconditions met." : reasons.join(". ")}
      </span>
    </section>
  );
}
