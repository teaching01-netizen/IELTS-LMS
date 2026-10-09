import { AlertTriangle, Link2, Rocket } from "lucide-react";
import type { AssessmentReleaseState } from "../../contracts/release";
import { formatDuration, formatPublishedDate, satPublishScopeCopy } from "./releaseSelectors";
import { releaseSurfaceClass } from "./releaseUi";

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
              detail={`${satPublishScopeCopy(published.publishScope)} · ${publishedCurrent ? `Published ${formatPublishedDate(published.publishedAt)}` : "Unchanged until you publish"}`}
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
              detail={
                blockerCount === 0
                  ? "Question text, answer choices, module count, and correct answers pass"
                  : "Resolve the required publish checks"
              }
            />
          )}
        </dl>
        <div className="p-5">
          {!online ? (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-faint)] p-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              You are offline. Saving and publishing are paused until you reconnect.
            </div>
          ) : null}
          {dirtyCount > 0 ? (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-warning-tint)] p-3 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              Save all delivery changes before publishing.
            </div>
          ) : null}
          {publishedCurrent ? (
            <button type="button" onClick={onOpenStudentAccess} className="sat-btn sat-btn--primary sat-btn--block sat-press">
              <Link2 size={16} aria-hidden="true" />
              Open rooms
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onPublish}
                disabled={!canPublish || isPublishing}
                aria-busy={isPublishing || undefined}
                aria-describedby={publishBlockers.length > 0 ? "release-publish-reasons" : undefined}
                className="sat-btn sat-btn--primary sat-btn--block sat-press"
              >
                {isPublishing ? <span aria-hidden="true" className="sat-btn__spinner" /> : <Rocket size={16} aria-hidden="true" />}
                {isPublishing ? "Publishing\u2026" : isUpdate ? "Publish new version" : "Publish version"}
              </button>
              {publishBlockers.length > 0 ? (
                <ul id="release-publish-reasons" aria-label="Why publishing is unavailable" className="mt-3 list-disc space-y-1 pl-5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
                  {publishBlockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          {published && !publishedCurrent ? (
            <button type="button" onClick={onOpenStudentAccess} className="sat-btn sat-btn--quiet sat-btn--block sat-press mt-2">
              Open rooms
            </button>
          ) : null}
          {publishError ? <p role="alert" className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{publishError}</p> : null}
          <p className="mt-3 text-center text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            {publishedCurrent ? "Existing rooms stay on the version they were created for." : "Publishing creates a new immutable version. Existing rooms never change automatically."}
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
