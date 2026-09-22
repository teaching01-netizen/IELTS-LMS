import { useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import type { AssessmentValidationIssue, AssessmentValidationReport } from "../../contracts/assessment";
import {
  getSATPublishBlockers,
  SAT_PUBLISH_READINESS_FAMILIES,
  readinessFamilyForIssue,
} from "./releaseSelectors";
import { releaseDisabledButtonClass, releaseSurfaceClass, readinessToneClass } from "./releaseUi";

interface ReadinessPanelProps {
  readiness: AssessmentValidationReport | null;
  isChecking: boolean;
  error: string | null;
  staleBanner: string | null;
  readOnlyPassedLabel?: string | null;
  onRefresh: () => Promise<unknown>;
  onIssueClick: (issue: AssessmentValidationIssue) => void;
}

export function ReadinessPanel({
  readiness,
  isChecking,
  error,
  staleBanner,
  readOnlyPassedLabel,
  onRefresh,
  onIssueClick,
}: ReadinessPanelProps) {
  const blockers = getSATPublishBlockers(readiness, true);
  const familyCounts = SAT_PUBLISH_READINESS_FAMILIES.map((family) => ({
    ...family,
    count: blockers.filter((issue) => readinessFamilyForIssue(issue)?.id === family.id).length,
  }));
  const publishReady = Boolean(readiness && blockers.length === 0);
  return (
    <section aria-label="Release checks" aria-busy={isChecking} className={`${releaseSurfaceClass} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Publish readiness
          </p>
          <h2 className="mt-1 text-[19px] font-semibold tracking-[-0.02em] text-foreground">
            Release checks
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            Checks are evaluated by the SAT provider against the exact draft revision shown on
            this page.
          </p>
        </div>
        {readOnlyPassedLabel ? null : (
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={isChecking}
            className={`flex min-h-11 items-center gap-2 rounded-xl bg-muted px-3.5 text-sm font-semibold text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${releaseDisabledButtonClass}`}
          >
            {isChecking ? (
              <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <RefreshCw size={15} aria-hidden="true" />
            )}
            {isChecking ? "Checking\u2026" : "Run checks"}
          </button>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {staleBanner ? (
        <p role="status" className="mt-4 rounded-xl bg-amber-100 p-3 text-sm leading-6 text-amber-800">
          {staleBanner}
        </p>
      ) : null}
      {readOnlyPassedLabel ? (
        <p role="status" className="mt-4 rounded-xl bg-muted p-3 text-sm leading-6 text-muted-foreground">
          {readOnlyPassedLabel}
        </p>
      ) : null}
      {!readiness && !isChecking && !readOnlyPassedLabel ? (
        <div className="mt-5 rounded-2xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
          Publish checks have not completed for this draft revision yet.
        </div>
      ) : null}

      {readiness ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2" aria-live="polite">
          {familyCounts.map((family) => {
            const passed = family.count === 0;
            return (
              <div
                key={family.id}
                className={`flex items-center justify-between rounded-2xl px-4 py-3 ${readinessToneClass[passed ? "success" : "danger"]}`}
              >
                <div className="flex items-center gap-2">
                  {passed ? (
                    <CheckCircle2 size={17} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={17} aria-hidden="true" />
                  )}
                  <span className="text-sm font-medium">{family.label}</span>
                </div>
                <span className="text-xs font-semibold">
                  {passed ? "Complete" : `${family.count} issue${family.count === 1 ? "" : "s"}`}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {blockers.length > 0 ? (
        <IssueList
          title="Fix before publishing"
          issues={blockers}
          onIssueClick={onIssueClick}
        />
      ) : publishReady ? (
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-green-100 px-4 py-3 text-sm font-medium text-green-800">
          <CheckCircle2 size={17} aria-hidden="true" /> Ready to publish.
        </div>
      ) : readiness ? (
        <div role="alert" className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Publish checks are failing. Run checks again.
        </div>
      ) : null}
    </section>
  );
}

const INITIAL_ISSUE_LIMIT = 20;

function IssueList({
  title,
  issues,
  onIssueClick,
}: {
  title: string;
  issues: AssessmentValidationIssue[];
  onIssueClick: (issue: AssessmentValidationIssue) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? issues : issues.slice(0, INITIAL_ISSUE_LIMIT);
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-semibold text-foreground">{title}</p>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {visible.map((issue, index) => {
          const questionIssue = issue.path.startsWith("examQuestion:");
          return (
            <button
              key={`${issue.code}::${issue.path}::${issue.message}::${index}`}
              type="button"
              onClick={() => onIssueClick(issue)}
              className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{issue.message}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {questionIssue ? "Open question in Builder \u2192" : issue.path}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {issues.length > INITIAL_ISSUE_LIMIT ? (
        expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="mt-2 min-h-11 rounded-xl px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Show fewer issues
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded="false"
            className="mt-2 min-h-11 rounded-xl px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Show all {issues.length} issues
          </button>
        )
      ) : null}
    </div>
  );
}
