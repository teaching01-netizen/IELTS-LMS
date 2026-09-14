import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ExamEntity } from "../../../types/domain";
import type {
  AssessmentAuthoringShell,
  AssessmentValidationIssue,
  AssessmentValidationReport,
} from "../contracts/assessment";
import type { AssessmentReleaseState } from "../contracts/release";
import { AuthoringConfirmDialog } from "./authoringPrimitives";
import { PublishAssessmentDialog } from "./release/PublishAssessmentDialog";
import { ReadinessPanel } from "./release/ReadinessPanel";
import { ReleaseHeader } from "./release/ReleaseHeader";
import { ReleaseStatusHero } from "./release/ReleaseStatusHero";
import { ReleaseSummary } from "./release/ReleaseSummary";
import { RuntimePolicyPanel } from "./release/RuntimePolicyPanel";
import { SectionDeliveryEditor } from "./release/SectionDeliveryEditor";
import { SectionHeading, ReleaseLoadingSurface } from "./release/releaseChrome";
import {
  candidateSecondsForShell,
  canPublishFromBlockers,
  getFreshBlockers,
  getFreshWarnings,
  getPublishBlockers,
  isReadinessFresh,
  summarizeStaleReadiness,
} from "./release/releaseSelectors";
import { releaseSurfaceClass, useReleaseOnline } from "./release/releaseUi";

export interface SatDeliveryReleasePageProps {
  exam: ExamEntity;
  shell: AssessmentAuthoringShell | null;
  releaseState: AssessmentReleaseState | null;
  isLoading: boolean;
  loadError: string | null;
  readiness: AssessmentValidationReport | null;
  isChecking: boolean;
  readinessError: string | null;
  isPublishing: boolean;
  publishError: string | null;
  onBackToBuilder: () => void;
  onBackToExams: () => void;
  onRefreshReadiness: () => Promise<unknown>;
  onPublish: (publishNotes?: string) => Promise<void>;
  onIssueClick: (issue: AssessmentValidationIssue) => void;
  onOpenStudentAccess: () => void;
  presenceSlot?: ReactNode;
  saveSlot?: ReactNode;
  collaborationSlot?: ReactNode;
}

export function SatDeliveryReleasePage(props: SatDeliveryReleasePageProps) {
  const {
    exam,
    shell,
    releaseState,
    isLoading,
    loadError,
    readiness,
    isChecking,
    readinessError,
    isPublishing,
    publishError,
    onBackToBuilder,
    onBackToExams,
    onRefreshReadiness,
    onPublish,
    onIssueClick,
    onOpenStudentAccess,
    presenceSlot,
    saveSlot,
    collaborationSlot,
  } = props;
  const [dirtySections, setDirtySections] = useState<Set<string>>(() => new Set());
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const online = useReleaseOnline();

  const setSectionDirty = useCallback((sectionId: string, dirty: boolean) => {
    setDirtySections((current) => {
      if (current.has(sectionId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(sectionId);
      else next.delete(sectionId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || dirtySections.size === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirtySections.size]);

  const requestBackToBuilder = useCallback(() => {
    if (dirtySections.size > 0) {
      setShowLeaveDialog(true);
      return;
    }
    onBackToBuilder();
  }, [dirtySections.size, onBackToBuilder]);

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

  return (
    <ReleasePageBody
      exam={exam}
      shell={shell}
      releaseState={releaseState}
      readiness={readiness}
      isChecking={isChecking}
      readinessError={readinessError}
      isPublishing={isPublishing}
      publishError={publishError}
      dirtySections={dirtySections}
      showPublishDialog={showPublishDialog}
      showLeaveDialog={showLeaveDialog}
      online={online}
      onBackToBuilder={onBackToBuilder}
      onRefreshReadiness={onRefreshReadiness}
      onPublish={onPublish}
      onIssueClick={onIssueClick}
      onOpenStudentAccess={onOpenStudentAccess}
      onDirtyChange={setSectionDirty}
      onRequestBack={requestBackToBuilder}
      onOpenPublishDialog={() => setShowPublishDialog(true)}
      onClosePublishDialog={() => setShowPublishDialog(false)}
      onOpenLeaveDialog={() => setShowLeaveDialog(true)}
      onCloseLeaveDialog={() => setShowLeaveDialog(false)}
      presenceSlot={presenceSlot}
      saveSlot={saveSlot}
      collaborationSlot={collaborationSlot}
    />
  );
}

function ReleasePageBody(props: {
  exam: ExamEntity;
  shell: AssessmentAuthoringShell;
  releaseState: AssessmentReleaseState;
  readiness: AssessmentValidationReport | null;
  isChecking: boolean;
  readinessError: string | null;
  isPublishing: boolean;
  publishError: string | null;
  dirtySections: Set<string>;
  showPublishDialog: boolean;
  showLeaveDialog: boolean;
  online: boolean;
  onBackToBuilder: () => void;
  onRefreshReadiness: () => Promise<unknown>;
  onPublish: (publishNotes?: string) => Promise<void>;
  onIssueClick: (issue: AssessmentValidationIssue) => void;
  onOpenStudentAccess: () => void;
  onDirtyChange: (sectionId: string, dirty: boolean) => void;
  onRequestBack: () => void;
  onOpenPublishDialog: () => void;
  onClosePublishDialog: () => void;
  onOpenLeaveDialog: () => void;
  onCloseLeaveDialog: () => void;
  presenceSlot?: ReactNode;
  saveSlot?: ReactNode;
  collaborationSlot?: ReactNode;
}) {
  const {
    exam,
    shell,
    releaseState,
    readiness,
    isChecking,
    readinessError,
    isPublishing,
    publishError,
    dirtySections,
    showPublishDialog,
    showLeaveDialog,
    online,
    onBackToBuilder,
    onRefreshReadiness,
    onPublish,
    onIssueClick,
    onOpenStudentAccess,
    onDirtyChange,
    onRequestBack,
    onOpenPublishDialog,
    onClosePublishDialog,
    onCloseLeaveDialog,
    presenceSlot,
    saveSlot,
    collaborationSlot,
  } = props;

  const readinessFresh = isReadinessFresh(readiness, shell);
  const blockers = getFreshBlockers(readiness, readinessFresh);
  const warnings = getFreshWarnings(readiness, readinessFresh);
  const stale = summarizeStaleReadiness(readiness, shell);
  // Candidate time = base M1 + the longer M2 branch + break per section.
  // section.durationSeconds sums every authored module, which overstates the
  // longest real sitting (see candidateSecondsForShell).
  const totalCandidateSeconds = candidateSecondsForShell(shell);
  // Single source of truth shared with ReleaseGateCard: the page no longer
  // computes canPublish inline. Authz comes from the exam capabilities; the
  // offline guard is appended (connectivity is not a selector concern).
  const publishBlockers = getPublishBlockers({
    lifecycleState: releaseState.state,
    readinessFresh,
    readinessValid: Boolean(readinessFresh && readiness?.valid),
    blockerCount: blockers.length,
    dirtyCount: dirtySections.size,
    isPublishing,
    canEdit: exam.canEdit,
    canPublishExam: exam.canPublish,
  });
  const offlineBlocker = online ? null : "You are offline — reconnect to publish";
  const allPublishBlockers = offlineBlocker
    ? [...publishBlockers, offlineBlocker]
    : publishBlockers;
  const canPublish = online && canPublishFromBlockers(publishBlockers);
  const isPublishedCurrentView =
    releaseState.state === "published_current" && dirtySections.size === 0;

  return (
    <div className="sat-product min-h-screen bg-background text-foreground">
      <ReleaseHeader
        examTitle={exam.title}
        onBack={onRequestBack}
        onOpenStudentAccess={releaseState.currentPublishedVersion ? onOpenStudentAccess : undefined}
        presenceSlot={presenceSlot}
        saveSlot={saveSlot}
        collaborationSlot={collaborationSlot}
      />
      <main className="mx-auto w-full max-w-[1240px] px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        <ReleaseStatusHero
          releaseState={releaseState}
          readiness={readinessFresh ? readiness : null}
          isChecking={isChecking}
          dirtyCount={dirtySections.size}
        />

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <section className={`${releaseSurfaceClass} p-5 sm:p-6`}>
              <SectionHeading
                eyebrow="Delivery plan"
                title="Timing & adaptive routing"
                description="Configure the server-authoritative path a candidate can take. Each section saves independently with optimistic concurrency protection. The runtime routes each candidate to the base module plus exactly one branch — any branch preview here is a staff inspection tool, not the live adaptive decision."
              />
              <div className="mt-6 space-y-4">
                {shell.sections.map((section) => (
                  <SectionDeliveryEditor
                    key={section.id}
                    examId={exam.id}
                    section={section}
                    canEdit={exam.canEdit}
                    onDirtyChange={onDirtyChange}
                  />
                ))}
              </div>
            </section>

            {isPublishedCurrentView ? (
              <ReadinessPanel
                readiness={null}
                isChecking={false}
                error={null}
                staleBanner={null}
                readOnlyPassedLabel={`Release checks passed for Version ${releaseState.currentPublishedVersion?.versionNumber ?? "—"}. Edit delivery settings to start a new draft.`}
                onRefresh={onRefreshReadiness}
                onIssueClick={onIssueClick}
              />
            ) : (
              <ReadinessPanel
                readiness={readinessFresh ? readiness : null}
                isChecking={isChecking}
                error={readinessError}
                staleBanner={stale.fresh ? null : stale.checkedLabel}
                onRefresh={onRefreshReadiness}
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
            dirtyCount={dirtySections.size}
            publishBlockers={allPublishBlockers}
            canPublish={canPublish}
            isPublishing={isPublishing}
            publishError={publishError}
            online={online}
            onPublish={onOpenPublishDialog}
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
        candidateEstimateStale={dirtySections.size > 0}
        isPublishing={isPublishing}
        isUpdate={releaseState.state === "unpublished_changes"}
        currentPublishedVersionNumber={releaseState.currentPublishedVersion?.versionNumber ?? null}
        onClose={onClosePublishDialog}
        onConfirm={onPublish}
      />
      <AuthoringConfirmDialog
        open={showLeaveDialog}
        title="Leave with unsaved changes?"
        description="Your delivery settings have not been saved. Leaving now discards those changes."
        confirmLabel="Leave without saving"
        onCancel={onCloseLeaveDialog}
        onConfirm={() => {
          onCloseLeaveDialog();
          onBackToBuilder();
        }}
      />
    </div>
  );
}
