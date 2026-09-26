import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, Rocket } from "lucide-react";
import type {
  AssessmentAuthoringShell,
  AssessmentValidationIssue,
  SatPublishScope,
} from "../../contracts/assessment";
import {
  MAX_PUBLISH_NOTES_LENGTH,
  candidateSecondsForSection,
  formatDuration,
  normalizePublishNotes,
  publishMediaIssueDiagnostic,
  toUserFacingPublishError,
} from "./releaseSelectors";
import { releaseDisabledButtonClass } from "./releaseUi";
import { AuthoringDialog } from "../authoringPrimitives";

interface PublishAssessmentDialogProps {
  open: boolean;
  examTitle: string;
  shell: AssessmentAuthoringShell;
  blockerCount: number;
  warningCount: number;
  candidateSeconds: number;
  publishScope: SatPublishScope;
  candidateEstimateStale: boolean;
  isPublishing: boolean;
  /** The draft read that Publish must trust is still in flight. */
  draftBusy?: boolean;
  isUpdate: boolean;
  currentPublishedVersionNumber: number | null;
  onClose: () => void;
  onConfirm: (scope: SatPublishScope, publishNotes?: string) => Promise<void>;
  /** Opens the question a failing publish check named (media gate 422). */
  onOpenIssue?: ((issue: AssessmentValidationIssue) => void) | undefined;
}

export function PublishAssessmentDialog({
  open,
  examTitle,
  shell,
  blockerCount,
  candidateSeconds,
  publishScope,
  candidateEstimateStale,
  isPublishing,
  draftBusy = false,
  isUpdate,
  currentPublishedVersionNumber,
  onClose,
  onConfirm,
  onOpenIssue,
}: PublishAssessmentDialogProps) {
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [issueTarget, setIssueTarget] = useState<AssessmentValidationIssue | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setNotes("");
      setLocalError(null);
      setIssueTarget(null);
      submittingRef.current = false;
    }
  }, [open ]);

  const submit = async () => {
    // One in-flight publish per dialog: the ref covers a double click before a
    // re-render, the props cover the same state arriving from the parent.
    if (blockerCount > 0 || isPublishing || draftBusy || submittingRef.current) return;
    submittingRef.current = true;
    setLocalError(null);
    setIssueTarget(null);
    try {
      await onConfirm(publishScope, normalizePublishNotes(notes));
      onClose();
    } catch (error) {
      // A 422 media rejection names the question holding the missing object.
      // Showing it as an action (not a retry) is the only way the author can
      // fix it; a retry would send the identical, still-invalid draft.
      const diagnostic = publishMediaIssueDiagnostic(error);
      setLocalError(diagnostic?.message ?? toUserFacingPublishError(error));
      setIssueTarget(diagnostic?.issue ?? null);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <AuthoringDialog
      open={open}
      title={`Publish ${publishScope === "full" ? "Full SAT" : publishScope === "math" ? "Math" : "Reading & Writing"}${publishScope === "full" ? "" : " only"}?`}
      description={
        isUpdate && currentPublishedVersionNumber
          ? `Students continue to receive Version ${currentPublishedVersionNumber} until this update is published.`
          : `${examTitle} will be available to students in this release scope.`
      }
      onClose={onClose}
      closeDisabled={isPublishing}
      contentClassName="w-[min(94vw,620px)] max-h-[88vh] overflow-y-auto rounded-2xl p-0"
    >
      <div className="p-5 pt-2 sm:p-6 sm:pt-3">
        <div className="flex items-center gap-3 rounded-2xl bg-muted p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Rocket size={19} aria-hidden="true" />
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Review delivery details and add optional notes before creating the immutable
            release.
          </p>
        </div>

        <div className="mt-5 rounded-2xl bg-muted p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              Candidate time{candidateEstimateStale ? " (draft estimate \u2014 save first)" : ""}
            </span>
            <span className="font-semibold text-foreground">{formatDuration(candidateSeconds)}</span>
          </div>
          <div className="mt-3 border-t border-border pt-3">
            {shell.sections
              .filter((section) => publishScope === "full" || section.sectionKey === publishScope)
              .map((section, index, sections) => (
              <div
                key={section.id}
                className="flex items-center justify-between gap-3 py-1.5 text-xs"
              >
                <span className="text-muted-foreground">{section.title}</span>
                <span className="font-semibold text-foreground">
                  {formatDuration(candidateSecondsForSection({
                    ...section,
                    breakAfterSeconds: index === sections.length - 1 ? 0 : section.breakAfterSeconds,
                  }))}
                </span>
              </div>
              ))}
          </div>
        </div>

        {publishScope !== "full" ? (
          <div className="mt-4 rounded-2xl border border-border p-4 text-sm leading-6">
            <p className="font-semibold text-foreground">Not included</p>
            <p className="text-muted-foreground">{publishScope === "math" ? "Reading & Writing" : "Math"}</p>
            <p className="mt-2 text-muted-foreground">Students using this release will only receive the selected section.</p>
          </div>
        ) : null}

        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-border p-4">
          {blockerCount === 0 ? (
            <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-green-800" aria-hidden="true" />
          ) : (
            <AlertTriangle size={17} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div className="text-sm leading-6 text-muted-foreground">
            <p className="font-semibold text-foreground">
              {blockerCount === 0
                ? "Release checks passed"
                : `${blockerCount} blocking issue${blockerCount === 1 ? "" : "s"}`}
            </p>
            <p>
              {blockerCount === 0
                ? "Question text, answer choices, module count, and correct answers are complete."
                : "Resolve the required publish checks before publishing."}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-baseline justify-between gap-3">
          <span id="sat-publish-notes-label" className="block text-xs font-medium text-muted-foreground">
            Publish notes <span className="font-normal text-muted-foreground">Optional</span>
          </span>
          <span id="sat-publish-notes-count" aria-live="polite" className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {notes.length}/{MAX_PUBLISH_NOTES_LENGTH}
          </span>
        </div>
          <textarea
            id="sat-publish-notes"
            aria-labelledby="sat-publish-notes-label"
            aria-describedby="sat-publish-notes-count"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            maxLength={MAX_PUBLISH_NOTES_LENGTH}
            placeholder="What changed in this release?"
            className="mt-1.5 w-full resize-y rounded-xl border border-border px-3 py-2.5 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/15"
          />

        {localError ? (
          <div
            role="alert"
            className="mt-3 rounded-xl bg-destructive/10 p-3 text-xs leading-5 text-destructive"
          >
            <p data-publish-error>{localError}</p>
            {issueTarget && onOpenIssue ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenIssue(issueTarget);
                }}
                className="mt-2 font-semibold underline underline-offset-2"
              >
                Open this question
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isPublishing}
            data-dialog-initial-focus
            className={`min-h-11 rounded-xl bg-muted px-4 text-sm font-semibold text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${releaseDisabledButtonClass}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={blockerCount > 0 || isPublishing || draftBusy}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${releaseDisabledButtonClass}`}
          >
            {isPublishing ? (
              <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Rocket size={15} aria-hidden="true" />
            )}
            {isPublishing
              ? "Publishing\u2026"
              : `Publish ${publishScope === "full" ? "Full SAT" : publishScope === "math" ? "Math" : "Reading & Writing"}`}
          </button>
        </div>
      </div>
    </AuthoringDialog>
  );
}
