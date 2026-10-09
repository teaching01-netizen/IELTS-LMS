import { useState, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { SatInlineError } from "@/src/products/sat/ui/SatPage";
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
  /** Re-reads the release state after a load failure. */
  onRetryLoad?: () => void;
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
  const { exam, shell, releaseState, isLoading, loadError, onBackToExams, onRetryLoad, onSelectTab, saveSlot, collaborationSlot, presenceSlot } = props;
  const online = useReleaseOnline();
  const role = useOptionalAuthSession()?.session?.user.role ?? null;

  if (isLoading) {
    return <ReleaseLoadingSurface />;
  }

  if (loadError || !shell || !releaseState) {
    // The failure keeps the exam's location: same header, same tabs, and a
    // retry beside the message instead of a page that only leads away.
    return (
      <div className="sat-product min-h-screen bg-[var(--sat-staff-canvas,#f7f7f8)] text-foreground">
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
        <main className="mx-auto w-full max-w-[920px] px-4 pb-20 pt-8 sm:px-6">
          <SatInlineError
            title="Publish review could not load"
            description={loadError ?? "The current release state is unavailable."}
            {...(onRetryLoad ? { onRetry: onRetryLoad } : {})}
          />
        </main>
      </div>
    );
  }

  return <ReleasePageBody {...props} shell={shell} releaseState={releaseState} online={online} role={role} />;
}

function ReleasePageBody(
  props: SatDeliveryReleasePageProps & {
    shell: AssessmentAuthoringShell;
    releaseState: AssessmentReleaseState;
    online: boolean;
    role: string | null;
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
    role,
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
    <div className="sat-product min-h-screen bg-[var(--sat-staff-canvas,#f7f7f8)] text-foreground">
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
                eyebrow="Scope"
                title="What this version includes"
                description="The scope decides which sections students receive and which checks must pass."
              />
              <fieldset className="mt-4">
                <legend className="sr-only">Content to publish</legend>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Content to publish">
                  {[
                    { value: "full", label: "Full SAT" },
                    { value: "reading-writing", label: "Reading & Writing" },
                    { value: "math", label: "Math" },
                  ].map((option) => {
                    const selected = publishScope === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex min-h-12 cursor-pointer items-center gap-2.5 rounded-[var(--sat-staff-radius-control,10px)] border px-3 text-[14px] font-semibold leading-5 transition-colors focus-within:ring-[3px] focus-within:ring-[var(--sat-staff-accent-ring)] ${selected ? "border-[var(--sat-staff-accent,#0071e3)] bg-[var(--sat-staff-accent-tint)] text-[var(--sat-staff-text-primary,#1d1d1f)]" : "border-[var(--sat-staff-border-strong)] bg-white text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-faint)]"}`}
                      >
                        <input
                          type="radio"
                          name="sat-publish-scope"
                          value={option.value}
                          checked={selected}
                          onChange={() => onPublishScopeChange(option.value as SatPublishScope)}
                          className="h-4 w-4 accent-[var(--sat-staff-accent,#0071e3)]"
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {publishScope !== "full" ? (
                <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
                  Only {publishScope === "math" ? "Math" : "Reading & Writing"} will be included. The other section and its publish issues will be ignored for this release.
                </p>
              ) : null}
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

            <section className={`${releaseSurfaceClass} p-5 sm:p-6`} aria-label="Delivery plan summary">
              <SectionHeading
                eyebrow="Delivery plan"
                title="Timing & adaptive routing"
                description="Configured in Settings. This is what the selected scope will deliver."
              />
              <ul className="mt-4 divide-y divide-[var(--sat-staff-border-hairline)] rounded-[var(--sat-staff-radius-control,10px)] border border-[var(--sat-staff-border-hairline)]">
                {includedSections.map((section, index) => (
                  <li key={section.id} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-[14px] leading-5">
                    <span className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">{section.title}</span>
                    <span className="tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">
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
                <li className="flex min-h-11 items-center justify-between gap-3 bg-[var(--sat-staff-fill-faint)] px-4 py-2.5 text-[14px] leading-5">
                  <span className="font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Longest sitting</span>
                  <span className="font-semibold tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{formatDuration(totalCandidateSeconds)}</span>
                </li>
              </ul>
              <button type="button" onClick={() => onSelectTab("settings")} className="sat-btn sat-btn--secondary sat-press mt-4">
                <Settings2 size={16} aria-hidden="true" />
                Edit timing in Settings
              </button>
            </section>

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
