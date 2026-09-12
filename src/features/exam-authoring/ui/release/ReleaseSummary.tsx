import { AlertTriangle, Link2, LoaderCircle, Rocket } from "lucide-react";
import type { AssessmentReleaseState } from "../../contracts/release";
import { formatDuration, formatPublishedDate } from "./releaseSelectors";
import { releaseDisabledButtonClass, releaseSurfaceClass } from "./releaseUi";

interface ReleaseSummaryProps {
  examTitle: string;
  releaseState: AssessmentReleaseState;
  blockerCount: number;
  warningCount: number;
  dirtyCount: number;
  publishBlockers: string[];
  canPublish: boolean;
  isPublishing: boolean;
  publishError: string | null;
  online: boolean;
  onPublish: () => void;
  onOpenStudentAccess: () => void;
}

export function ReleaseSummary({
  examTitle,
  releaseState,
  blockerCount,
  warningCount,
  dirtyCount,
  publishBlockers,
  canPublish,
  isPublishing,
  publishError,
  online,
  onPublish,
  onOpenStudentAccess,
}: ReleaseSummaryProps) {
  const published = releaseState.currentPublishedVersion;
  const publishedCurrent = releaseState.state === "published_current" && dirtyCount === 0;
  const isUpdate = releaseState.state === "unpublished_changes" || (published !== null && dirtyCount > 0);
  const { summary, access } = releaseState;

  return (
    <aside aria-label="Release summary" className="xl:sticky xl:top-[92px]">
      <div className={`${releaseSurfaceClass} overflow-hidden`}>
        <div className="border-b border-border p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {publishedCurrent ? "Published" : isUpdate ? "Next release" : "Release summary"}
          </p>
          <h2 className="mt-1 truncate text-[18px] font-semibold tracking-[-0.02em] text-foreground">{examTitle}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {publishedCurrent && published
              ? `Version ${published.versionNumber} is available to students.`
              : isUpdate && published
                ? `Students still receive Version ${published.versionNumber} until you publish these changes.`
                : "Publish once the exam is ready for students."}
          </p>
        </div>
        <dl className="divide-y divide-border px-5">
          {published ? (
            <SummaryRow
              label="Current release"
              value={`Version ${published.versionNumber}`}
              detail={publishedCurrent ? `Published ${formatPublishedDate(published.publishedAt)}` : "Unchanged until you publish"}
            />
          ) : null}
          <SummaryRow label="Candidate time" value={formatDuration(summary.candidateDurationSeconds)} />
          <SummaryRow
            label="Questions"
            value={`${summary.deliveredQuestionCount} delivered max`}
            detail={`${summary.authoredQuestionCount} authored across all branches; one candidate sees base + one branch per section`}
          />
          {publishedCurrent ? (
            <SummaryRow
              label="Student access"
              value={`${access.totalLinks} link${access.totalLinks === 1 ? "" : "s"}`}
              detail={access.liveLinks > 0 ? `${access.liveLinks} live · ${access.upcomingLinks} upcoming` : "No live links"}
            />
          ) : (
            <SummaryRow
              label="Readiness"
              value={`${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`}
              detail={`${warningCount} recommendation${warningCount === 1 ? "" : "s"}`}
            />
          )}
        </dl>
        <div className="p-5">
          {!online ? (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-xl bg-muted p-3 text-xs leading-5 text-muted-foreground">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              You are offline. Saving and publishing are paused until you reconnect.
            </div>
          ) : null}
          {dirtyCount > 0 ? (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-xl bg-amber-100 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              Save all delivery changes before publishing.
            </div>
          ) : null}
          {publishedCurrent ? (
            <button
              type="button"
              onClick={onOpenStudentAccess}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Link2 size={16} aria-hidden="true" />
              Student Access
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onPublish}
                disabled={!canPublish || isPublishing}
                aria-describedby={publishBlockers.length > 0 ? "release-publish-reasons" : undefined}
                className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${releaseDisabledButtonClass}`}
              >
                {isPublishing ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Rocket size={16} aria-hidden="true" />}
                {isPublishing ? "Publishing\u2026" : isUpdate ? "Publish Update" : "Publish"}
              </button>
              {publishBlockers.length > 0 ? (
                <ul id="release-publish-reasons" aria-label="Why publishing is unavailable" className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
                  {publishBlockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          {published && !publishedCurrent ? (
            <button type="button" onClick={onOpenStudentAccess} className="mt-2 min-h-11 w-full rounded-xl text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Student Access
            </button>
          ) : null}
          {publishError ? <p role="alert" className="mt-3 text-xs leading-5 text-destructive">{publishError}</p> : null}
          <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
            {publishedCurrent ? "Existing links remain on the release they were created for." : "Publishing creates an immutable release. Existing links never change automatically."}
          </p>
        </div>
      </div>
    </aside>
  );
}

function SummaryRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-semibold text-foreground">
        {value}
        {detail ? (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{detail}</span>
        ) : null}
      </dd>
    </div>
  );
}
