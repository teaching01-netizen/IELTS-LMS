import { useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw, Rocket, Settings2 } from "lucide-react";
import { SatInlineError } from "@/src/products/sat/ui/SatPage";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/src/components/ui/sheet";
import type { ExamEntity } from "../../../../types/domain";
import { useExamQuery } from "../../api/examQueries";
import type { AssessmentValidationIssue, SatPublishScope } from "../../contracts/assessment";
import {
  MAX_PUBLISH_NOTES_LENGTH,
  SAT_PUBLISH_SCOPE_OPTIONS,
  candidateSecondsForSection,
  candidateSecondsForShell,
  canPublishFromBlockers,
  formatDuration,
  getFreshWarnings,
  getPublishBlockers,
  getSATPublishBlockers,
  isReadinessFresh,
  isSATPublishReadinessIssue,
  isSATPublishReadinessValid,
  normalizePublishNotes,
  publishMediaIssueDiagnostic,
  satPublishScopeLabel,
  toUserFacingPublishError,
} from "../release/releaseSelectors";
import { useReleaseOnline } from "../release/releaseUi";
import { AuthoringConfirmDialog } from "../authoringPrimitives";
import { DeliverySettingsPanel } from "../settings/DeliverySettingsPanel";
import type { DeliveryTarget } from "../shell/examLifecycle";
import { useSatPublish } from "./useSatPublish";

export interface ExamPublishSheetProps {
  examId: string;
  open: boolean;
  onClose: () => void;
  /** Opens the question + field a blocking check names. */
  onOpenIssue: (issue: AssessmentValidationIssue) => void;
  /** Opens room setup for the version just published (pinned to it even if another author publishes again). */
  onOpenStudentAccess: (target?: DeliveryTarget) => void;
  /** Optional: when omitted, timing and routing are edited inside this sheet instead of on another page. */
  onOpenSettings?: (() => void) | undefined;
}

const BUTTON = "sat-btn sat-press";

/**
 * One focused publish surface that opens over ANY exam surface. It owns no
 * publishing rules: `useSatPublish` is the single implementation shared with the
 * full release page, so confirmed saves, revision checks and the retry-safe
 * operation key behave identically here.
 */
export function ExamPublishSheet(props: ExamPublishSheetProps) {
  const examQuery = useExamQuery(props.examId);
  const [view, setView] = useState<"publish" | "settings">("publish");
  const [dirtyCount, setDirtyCount] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => {
    if (dirtyCount > 0) setConfirmClose(true);
    else props.onClose();
  };
  return (
    <>
      <Sheet open={props.open} onOpenChange={(next) => !next && requestClose()}>
        <SheetContent side="right" className={`sat-product sat-staff-root flex flex-col gap-0 p-0 ${view === "settings" ? "w-[min(96vw,720px)] max-w-[720px] sm:max-w-[720px]" : "w-[min(96vw,560px)] max-w-[560px] sm:max-w-[560px]"}`}>
          <SheetHeader className="border-b border-[var(--sat-staff-border-hairline)] px-6 py-5 text-left">
            <SheetTitle className="text-[20px] leading-7 tracking-[-0.015em]">{view === "settings" ? "Exam settings" : "Publish version"}</SheetTitle>
            <SheetDescription>
              {view === "settings"
                ? "Change timing, breaks and routing without leaving publishing. Saved changes re-run the checks."
                : "Review the checks, then release a new student-facing version. Existing rooms and attempts keep their version."}
            </SheetDescription>
          </SheetHeader>
          {examQuery.data ? (
            <PublishSheetBody
              {...props}
              exam={examQuery.data}
              onExamRefresh={() => examQuery.refetch()}
              view={view}
              setView={setView}
              dirtyCount={dirtyCount}
              setDirtyCount={setDirtyCount}
            />
          ) : examQuery.error ? (
            <div className="p-6">
              <SatInlineError title="Publishing is unavailable" description="The exam could not be loaded." onRetry={() => void examQuery.refetch()} />
            </div>
          ) : (
            <p role="status" className="p-6 text-sm text-muted-foreground">
              Loading publish details…
            </p>
          )}
        </SheetContent>
      </Sheet>
      <AuthoringConfirmDialog
        open={confirmClose}
        title="Close with unsaved changes?"
        description="Your timing changes have not been saved. Closing now discards them."
        confirmLabel="Discard changes"
        destructive
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          props.onClose();
        }}
      />
    </>
  );
}

function PublishSheetBody({
  exam,
  onClose,
  onOpenIssue,
  onOpenStudentAccess,
  onOpenSettings,
  onExamRefresh,
  view,
  setView,
  dirtyCount,
  setDirtyCount,
}: ExamPublishSheetProps & {
  exam: ExamEntity;
  onExamRefresh: () => Promise<unknown>;
  view: "publish" | "settings";
  setView: (view: "publish" | "settings") => void;
  dirtyCount: number;
  setDirtyCount: (count: number) => void;
}) {
  const {
    shell, shellLoadError, releaseState, readinessQuery, publishScope, setPublishScope,
    isPublishing, publishError, draftBusy, publish,
  } = useSatPublish(exam, onExamRefresh);
  const online = useReleaseOnline();
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [issueTarget, setIssueTarget] = useState<AssessmentValidationIssue | null>(null);
  const [didPublish, setDidPublish] = useState(false);
  const [publishedTarget, setPublishedTarget] = useState<DeliveryTarget | null>(null);
  const submitting = useRef(false);

  if (didPublish) {
    const version = publishedTarget?.versionNumber ?? releaseState?.currentPublishedVersion?.versionNumber ?? null;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-6">
        <div role="status" className="flex items-start gap-3 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-success-tint)] p-4">
          <CheckCircle2 size={20} className="sat-pop mt-0.5 shrink-0 text-green-700" aria-hidden="true" />
          <div>
            <p className="text-base font-semibold text-foreground">
              {version ? `Version ${version} published.` : "Published."} Create a room to give students access.
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Existing rooms keep the version they were created with.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={`${BUTTON} sat-btn--primary`}
            onClick={() => {
              onClose();
              onOpenStudentAccess(publishedTarget ?? undefined);
            }}
          >
            Create room
          </button>
          <button type="button" className={`${BUTTON} sat-btn--quiet`} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }
  if (view === "settings") {
    return (
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
        <button
          type="button"
          disabled={dirtyCount > 0}
          onClick={() => {
            setView("publish");
            // Timing changes revise the draft: re-run the checks against it.
            void readinessQuery.refetch();
          }}
          className="sat-btn sat-btn--quiet sat-press -ml-3 px-3"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to publish
        </button>
        {dirtyCount > 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Save your changes to return to publishing.
          </p>
        ) : null}
        <DeliverySettingsPanel exam={exam} onDirtyCountChange={setDirtyCount} />
      </div>
    );
  }

  if (shellLoadError) {
    return (
      <p role="alert" className="p-6 text-sm text-destructive">
        {shellLoadError}
      </p>
    );
  }
  if (!shell || !releaseState) {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Loading the latest saved draft…
      </p>
    );
  }

  const readiness = readinessQuery.data ?? null;
  const fresh = isReadinessFresh(readiness, shell, publishScope);
  const blockers = getSATPublishBlockers(readiness, fresh);
  const warnings = getFreshWarnings(readiness, fresh).filter(isSATPublishReadinessIssue);
  const valid = isSATPublishReadinessValid(readiness, fresh, publishScope);
  const checking = readinessQuery.isFetching;
  const gate = getPublishBlockers({
    lifecycleState: releaseState.state,
    readinessFresh: fresh,
    readinessValid: valid,
    blockerCount: blockers.length,
    dirtyCount: 0,
    isPublishing,
    canEdit: exam.canEdit,
    canPublishExam: exam.canPublish,
  });
  const canPublish = online && !draftBusy && canPublishFromBlockers(gate);
  // The shared gate words staleness for the full release page; here the fix is
  // the "Run checks" button directly above, so say that instead.
  const gateReasons = gate.map((entry) =>
    entry.startsWith("Publish checks are stale") ? "Run checks to review the latest draft" : entry
  );
  const reason = !online
    ? "You are offline — reconnect to publish"
    : draftBusy
      ? "Your latest changes are still being saved"
      : gateReasons[0] ?? null;
  const included = shell.sections.filter(
    (section) => publishScope === "full" || section.sectionKey === publishScope
  );

  const submit = async () => {
    if (!canPublish || submitting.current) return;
    submitting.current = true;
    setLocalError(null);
    setIssueTarget(null);
    try {
      // The version this publish returned is the one access setup targets, even if
      // someone else publishes again before the author continues.
      const published = await publish(publishScope, normalizePublishNotes(notes));
      setPublishedTarget(published);
      setDidPublish(true);
    } catch (error) {
      const diagnostic = publishMediaIssueDiagnostic(error);
      setLocalError(diagnostic?.message ?? toUserFacingPublishError(error));
      setIssueTarget(diagnostic?.issue ?? null);
    } finally {
      submitting.current = false;
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        <fieldset>
          <legend className="text-sm font-semibold text-foreground">What to publish</legend>
          <div className="mt-2 grid gap-2" role="radiogroup" aria-label="Content to publish">
            {SAT_PUBLISH_SCOPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--sat-staff-radius-control,10px)] border px-3 text-[14px] font-semibold focus-within:ring-[3px] focus-within:ring-[var(--sat-staff-accent-ring)] ${publishScope === option.value ? "border-[var(--sat-staff-accent,#0071e3)] bg-[var(--sat-staff-accent-tint)] text-[var(--sat-staff-text-primary,#1d1d1f)]" : "border-[var(--sat-staff-border-strong)] text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-faint)]"}`}
              >
                <input
                  type="radio"
                  name="sat-publish-sheet-scope"
                  value={option.value}
                  checked={publishScope === option.value}
                  disabled={isPublishing}
                  onChange={() => setPublishScope(option.value as SatPublishScope)}
                  className="h-4 w-4 accent-[var(--sat-staff-accent,#0071e3)]"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <section aria-label="Publish checks" aria-busy={checking}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Checks</h3>
            <button
              type="button"
              onClick={() => void readinessQuery.refetch()}
              disabled={checking}
              className={`${BUTTON} sat-btn--secondary`}
            >
              {checking ? (
                <span aria-hidden="true" className="sat-btn__spinner" />
              ) : (
                <RefreshCw size={15} aria-hidden="true" />
              )}
              {checking ? "Checking…" : "Run checks"}
            </button>
          </div>
          {readinessQuery.error ? (
            <p role="alert" className="mt-3 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-danger-tint)] p-3 text-[14px] text-[var(--sat-staff-danger,#b42318)] text-destructive">
              {readinessQuery.error instanceof Error ? readinessQuery.error.message : "Checks could not run."}
            </p>
          ) : checking && !fresh ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Running checks on your latest saved draft…
            </p>
          ) : !fresh ? (
            <p className="mt-3 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-warning-tint)] p-3 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
              These checks are out of date. Run checks to review the latest draft.
            </p>
          ) : blockers.length === 0 ? (
            <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-muted-foreground">
              <CheckCircle2 size={17} className="mt-1 shrink-0 text-green-700" aria-hidden="true" />
              <span>
                <span className="font-semibold text-foreground">All checks passed.</span>
                {warnings.length > 0 ? ` ${warnings.length} optional ${warnings.length === 1 ? "suggestion" : "suggestions"} remain.` : ""}
              </span>
            </p>
          ) : (
            <div className="mt-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertTriangle size={16} className="text-destructive" aria-hidden="true" />
                {blockers.length} {blockers.length === 1 ? "issue" : "issues"} to fix before publishing
              </p>
              <ul className="mt-2 space-y-2">
                {blockers.map((issue, index) => (
                  <li key={`${issue.path}-${index}`} className="flex items-start justify-between gap-3 rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline)] p-3 text-[14px]">
                    <span className="min-w-0 leading-6 text-foreground">{issue.message}</span>
                    <button
                      type="button"
                      className={`${BUTTON} sat-btn--secondary shrink-0`}
                      onClick={() => {
                        onClose();
                        onOpenIssue(issue);
                      }}
                    >
                      Fix
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section aria-label="Included content" className="rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-faint)] p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Candidate time</span>
            <span className="font-semibold text-foreground">
              {formatDuration(candidateSecondsForShell(shell, publishScope))}
            </span>
          </div>
          <ul className="mt-3 border-t border-border pt-3">
            {included.map((section, index) => (
              <li key={section.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="text-muted-foreground">{section.title}</span>
                <span className="font-semibold text-foreground">
                  {formatDuration(
                    candidateSecondsForSection({
                      ...section,
                      breakAfterSeconds: index === included.length - 1 ? 0 : section.breakAfterSeconds,
                    })
                  )}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              if (onOpenSettings) {
                onClose();
                onOpenSettings();
              } else {
                setView("settings");
              }
            }}
            className="sat-btn sat-btn--secondary sat-press mt-3"
          >
            <Settings2 size={15} aria-hidden="true" />
            {onOpenSettings ? "Edit timing and routing in Settings" : "Edit timing and routing"}
          </button>
        </section>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="sat-publish-sheet-notes" className="text-sm font-semibold text-foreground">
              Publish notes <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
              {notes.length}/{MAX_PUBLISH_NOTES_LENGTH}
            </span>
          </div>
          <textarea
            id="sat-publish-sheet-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={MAX_PUBLISH_NOTES_LENGTH}
            placeholder="What changed in this release?"
            className="sat-input mt-2 resize-y"
          />
        </div>

        {localError || publishError ? (
          <div role="alert" className="rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-danger-tint)] p-3 text-[14px] text-[var(--sat-staff-danger,#b42318)] leading-6 text-destructive">
            <p data-publish-error>{localError ?? publishError}</p>
            {issueTarget ? (
              <button
                type="button"
                className="mt-2 min-h-11 font-semibold underline underline-offset-2"
                onClick={() => {
                  onClose();
                  onOpenIssue(issueTarget);
                }}
              >
                Open this question
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border bg-card px-6 py-4">
        {!canPublish && reason ? (
          <p role="status" className="mb-3 text-sm text-muted-foreground">
            {reason}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            className={`${BUTTON} sat-btn--quiet`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canPublish}
            aria-busy={isPublishing}
            className={`${BUTTON} sat-btn--primary`}
          >
            {isPublishing ? (
              <span aria-hidden="true" className="sat-btn__spinner" />
            ) : (
              <Rocket size={15} aria-hidden="true" />
            )}
            {isPublishing ? "Publishing…" : `Publish ${satPublishScopeLabel(publishScope)}`}
          </button>
        </div>
      </div>
    </>
  );
}
