import { useState, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import type { ExamEntity } from "../../../types/domain";
import type {
  AssessmentAuthoringShell,
  AssessmentValidationIssue,
  AssessmentValidationReport,
  SatPublishScope,
} from "../contracts/assessment";
import type { AssessmentReleaseState } from "../contracts/release";
import { useOptionalAuthSession } from "../../auth/api/authSession";
import { PublishAssessmentDialog } from "./release/PublishAssessmentDialog";
import { ReadinessPanel } from "./release/ReadinessPanel";
import { ReleaseStatusHero } from "./release/ReleaseStatusHero";
import { ReleaseSummary } from "./release/ReleaseSummary";
import { RuntimePolicyPanel } from "./release/RuntimePolicyPanel";
import { SectionHeading, ReleaseLoadingSurface } from "./release/releaseChrome";
import {
  candidateSecondsForSection,
  candidateSecondsForShell,
  canPublishFromBlockers,
  formatDuration,
  getSATPublishBlockers,
  getFreshWarnings,
  getPublishBlockers,
  isReadinessFresh,
  isSATPublishReadinessIssue,
  isSATPublishReadinessValid,
  summarizeStaleReadiness,
} from "./release/releaseSelectors";
import { releaseSurfaceClass, useReleaseOnline } from "./release/releaseUi";
import { ExamWorkspaceHeader } from "./shell/ExamWorkspaceHeader";
import {
  canViewExamResponses,
  describeExamLifecycle,
  type ExamWorkspaceTab,
} from "./shell/examLifecycle";

export interface SatDeliveryReleasePageProps {
  exam: ExamEntity;
  shell: AssessmentAuthoringShell | null;
  releaseState: AssessmentReleaseState | null;
  isLoading: boolean;
  loadError: string | null;
  readiness: AssessmentValidationReport | null;
  isChecking: boolean;
  readinessError: string | null;
  publishScope: SatPublishScope;
  isPublishing: boolean;
  /**
   * A draft read is in flight. Publishing before it lands would validate and
   * send the revision this page last saw, so the action waits.
   */
  draftBusy?: boolean;
  publishError: string | null;
  onBackToExams: () => void;
  onRefreshReadiness: () => Promise<unknown>;
  onPublishScopeChange: (scope: SatPublishScope) => void;
  onPublish: (scope: SatPublishScope, publishNotes?: string) => Promise<void>;
  onIssueClick: (issue: AssessmentValidationIssue) => void;
  onOpenStudentAccess: () => void;
  /** Header tab navigation (Questions / Settings / Responses). */
  onSelectTab: (tab: ExamWorkspaceTab) => void;
  presenceSlot?: ReactNode;
  saveSlot?: ReactNode;
  collaborationSlot?: ReactNode;
}

export function SatDeliveryReleasePage(props: SatDeliveryReleasePageProps) {
  const { shell, releaseState, isLoading, loadError, onBackToExams } = props;
  const online = useReleaseOnline();

  if (isLoading) {
    return <ReleaseLoadingSurface />;
  }

  if (loadError || !shell || !releaseState) {
    return (
      <div className="sat-product min-h-screen bg-background px-6 py-12">
        <div className="authoring-surface mx-auto max-w-2xl p-6">
          <p className="text-base font-semibold text-foreground">
            Delivery &amp; Release could not load
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {loadError ?? "The current SAT release state is unavailable."}
          </p>
          <button
            type="button"
            onClick={onBackToExams}
            className="mt-5 min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Exam Library
          </button>
        </div>
      </div>
    );
  }

  return <ReleasePageBody {...props} shell={shell} releaseState={releaseState} online={online} />;
}

function ReleasePageBody(
  props: SatDeliveryReleasePageProps & {
    shell: AssessmentAuthoringShell;
    releaseState: AssessmentReleaseState;
    online: boolean;
  }
) {
  const {
    exam,
    shell,
    releaseState,
    readiness,
    isChecking,
    readinessError,
    publishScope,
    isPublishing,
    draftBusy = false,
    publishError,
    online,
    onBackToExams,
    onRefreshReadiness,
    onPublishScopeChange,
    onPublish,
    onIssueClick,
    onOpenStudentAccess,
    onSelectTab,
    presenceSlot,
    saveSlot,
    collaborationSlot,
  } = props;
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const role = useOptionalAuthSession()?.session?.user.role ?? null;

  const readinessFresh = isReadinessFresh(readiness, shell, publishScope);
  const blockers = getSATPublishBlockers(readiness, readinessFresh);
  const warnings = getFreshWarnings(readiness, readinessFresh).filter(isSATPublishReadinessIssue);
  const readinessValid = isSATPublishReadinessValid(readiness, readinessFresh, publishScope);
  const stale = summarizeStaleReadiness(readiness, shell, publishScope);
  // Candidate time = base M1 + the longer M2 branch + break per section.
  // section.durationSeconds sums every authored module, which overstates the
  // longest real sitting (see candidateSecondsForShell).
  const totalCandidateSeconds = candidateSecondsForShell(shell, publishScope);
  // Delivery settings are edited on the Settings tab, so nothing on this page
  // can be unsaved: the gate's "dirty sections" input is always zero here.
  const publishBlockers = getPublishBlockers({
    lifecycleState: releaseState.state,
    readinessFresh,
    readinessValid,
    blockerCount: blockers.length,
    dirtyCount: 0,
    isPublishing,
    canEdit: exam.canEdit,
    canPublishExam: exam.canPublish,
  });
  // One reason for both causes: Publish reads the committed draft, so it waits
  // while this page is still reading it AND while this tab still holds changes
  // the room has not confirmed.
  const draftReadBlocker = draftBusy
    ? "Your latest changes are still being saved \u2014 publishing now could release an earlier draft"
    : null;
  const offlineBlocker = online ? null : "You are offline — reconnect to publish";
  const allPublishBlockers = [
    ...publishBlockers,
    ...(draftReadBlocker ? [draftReadBlocker] : []),
    ...(offlineBlocker ? [offlineBlocker] : []),
  ];
  const canPublish = online && !draftBusy && canPublishFromBlockers(publishBlockers);
  const isPublishedCurrentView = releaseState.state === "published_current";
  const includedSections = shell.sections.filter(
    (section) => publishScope === "full" || section.sectionKey === publishScope
  );

  return (
    <div className="sat-product min-h-screen bg-background text-foreground">
      <ExamWorkspaceHeader
        examTitle={exam.title}
        lifecycle={describeExamLifecycle(releaseState)}
        activeTab={null}
        showResponses={canViewExamResponses(role)}
        onSelectTab={onSelectTab}
        onBack={onBackToExams}
        contextLine="Publish review"
        saveSlot={saveSlot}
        collaborationSlot={collaborationSlot ?? presenceSlot}
      />
      <main className="mx-auto w-full max-w-[1240px] px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        <ReleaseStatusHero
          releaseState={releaseState}
          readiness={readinessFresh ? readiness : null}
          readinessValid={readinessValid}
          isChecking={isChecking}
          dirtyCount={0}
        />

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <section className={`${releaseSurfaceClass} p-5 sm:p-6`}>
              <SectionHeading
                eyebrow="Content to publish"
                title="Choose release scope"
                description="The selected scope controls publish checks and the sections students can receive."
              />
              <fieldset className="mt-4">
                <legend className="sr-only">Content to publish</legend>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Content to publish">
                  {[
                    { value: "full", label: "Full SAT" },
                    { value: "reading-writing", label: "Reading & Writing" },
                    { value: "math", label: "Math" },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ${publishScope === option.value ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-muted/70"}`}
                    >
                      <input
                        type="radio"
                        name="sat-publish-scope"
                        value={option.value}
                        checked={publishScope === option.value}
                        onChange={() => onPublishScopeChange(option.value as SatPublishScope)}
                        className="accent-primary"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {publishScope !== "full" ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Only {publishScope === "math" ? "Math" : "Reading & Writing"} will be included. The other section and its publish issues will be ignored for this release.
                </p>
              ) : null}
            </section>

            <section className={`${releaseSurfaceClass} p-5 sm:p-6`} aria-label="Delivery plan summary">
              <SectionHeading
                eyebrow="Delivery plan"
                title="Timing & adaptive routing"
                description="Timing, breaks and adaptive routing are configured in Settings. This is what the selected scope will deliver."
              />
              <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
                {includedSections.map((section, index) => (
                  <li key={section.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="font-semibold text-foreground">{section.title}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatDuration(
                        candidateSecondsForSection({
                          ...section,
                          breakAfterSeconds:
                            index === includedSections.length - 1 ? 0 : section.breakAfterSeconds,
                        })
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => onSelectTab("settings")}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-muted px-4 text-sm font-semibold text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Settings2 size={16} aria-hidden="true" />
                Edit timing and routing in Settings
              </button>
            </section>

            {isPublishedCurrentView ? (
              <ReadinessPanel
                readiness={null}
                isChecking={false}
                error={null}
                staleBanner={null}
                readOnlyPassedLabel={`Release checks passed for Version ${releaseState.currentPublishedVersion?.versionNumber ?? "—"}. Edit delivery settings to start a new draft.`}
                onRefresh={onRefreshReadiness}
                publishScope={publishScope}
                onIssueClick={onIssueClick}
              />
            ) : (
              <ReadinessPanel
                readiness={readinessFresh ? readiness : null}
                isChecking={isChecking}
                error={readinessError}
                staleBanner={stale.fresh ? null : stale.checkedLabel}
                onRefresh={onRefreshReadiness}
                publishScope={publishScope}
                onIssueClick={onIssueClick}
              />
            )}

            <RuntimePolicyPanel />
          </div>

          <ReleaseSummary
            examTitle={exam.title}
            releaseState={releaseState}
            blockerCount={blockers.length}
            warningCount={warnings.length}
            dirtyCount={0}
            publishBlockers={allPublishBlockers}
            canPublish={canPublish}
            isPublishing={isPublishing}
            publishError={publishError}
            online={online}
            onPublish={() => setShowPublishDialog(true)}
            onOpenStudentAccess={onOpenStudentAccess}
          />
        </div>
      </main>

      <PublishAssessmentDialog
        open={showPublishDialog}
        examTitle={exam.title}
        shell={shell}
        blockerCount={blockers.length}
        warningCount={warnings.length}
        candidateSeconds={totalCandidateSeconds}
        publishScope={publishScope}
        candidateEstimateStale={false}
        isPublishing={isPublishing}
        draftBusy={draftBusy}
        isUpdate={releaseState.state === "unpublished_changes"}
        currentPublishedVersionNumber={releaseState.currentPublishedVersion?.versionNumber ?? null}
        onClose={() => setShowPublishDialog(false)}
        onConfirm={onPublish}
        onOpenIssue={onIssueClick}
      />
    </div>
  );
}
