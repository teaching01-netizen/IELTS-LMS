import { lazy, Suspense } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { ExamEntity } from "../../../types/domain";
import { requestAuthoringDraftOnEntry } from "../application/authoringEntryIntent";
import type { AssessmentValidationIssue, SatPublishScope } from "../contracts/assessment";
import { parseIssueLink } from "../ui/release/releaseSelectors";
import { SatDeliveryReleasePage } from "../ui/SatDeliveryReleasePage";
import { CollaborationHeaderCluster } from "../ui/collaboration/CollaborationHeaderCluster";
import { useSatPublish } from "../ui/publish/useSatPublish";
import { canViewExamResponses, deliveryDestination, describeExamLifecycle, examWorkspacePath } from "../ui/shell/examLifecycle";
import { useOptionalAuthSession } from "../../auth/api/authSession";
import { satListReturnTarget } from "@/src/products/sat/ui/useSatListReturn";

const StudentLinksDashboard = lazy(() =>
  import("../ui/access-links/StudentLinksDashboard").then((module) => ({
    default: module.StudentLinksDashboard,
  })),
);

interface SatDeliveryReleaseRouteProps {
  exam: ExamEntity;
  onExamRefresh: () => Promise<unknown>;
}

export function SatDeliveryReleaseRoute({ exam, onExamRefresh }: SatDeliveryReleaseRouteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const inSatWorkspace = location.pathname.startsWith("/sat/");
  const {
    shellState,
    shell,
    shellLoadError,
    releaseQuery,
    releaseState,
    distributionQuery,
    readinessQuery,
    publishScope,
    setPublishScope,
    isPublishing,
    publishError,
    draftBusy,
    publish,
  } = useSatPublish(exam, onExamRefresh);
  const view = searchParams.get("view");
  const showStudentAccess = view === "access" || view === "links";
  const role = useOptionalAuthSession()?.session?.user.role ?? null;

  const openStudentAccess = () => {
    if (inSatWorkspace) {
      navigate(`/sat/exams/${encodeURIComponent(exam.id)}/access`);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("view", "access");
    setSearchParams(next, { replace: true });
  };
  const openRelease = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("view");
    setSearchParams(next, { replace: true });
  };

  const handlePublish = async (scope: SatPublishScope, publishNotes?: string) => {
    const published = await publish(scope, publishNotes);
    // In the SAT workspace the next step is configuring access for the exact
    // version that was just published, not hunting for the New Student Link button.
    if (inSatWorkspace) navigate(deliveryDestination(exam.id, published));
    else openStudentAccess();
  };

  /**
   * The ONE way out of Release back into the editor: "Back to builder", and a
   * clicked release blocker (which adds the deep-link `search` for the question
   * and field to fix).
   *
   * Both are the author saying "let me keep editing" — the same gesture as
   * choosing the exam in the Exam Library — and both matter for the same
   * reason: publishing SEALS the draft, so a published exam answers NO_DRAFT and
   * these clicks must continue from the published version instead of stopping at
   * the wall.
   *
   * The gesture is armed only for the SAT workspace, because that is the only
   * surface that consumes it. The legacy builder path is left alone: it heals
   * its own draft (`ReopenDraft`) and arming a slot nothing there can spend
   * would only leave a stale gesture behind.
   */
  const openBuilder = (examId: string, search?: string) => {
    const base = inSatWorkspace
      ? `/sat/exams/${encodeURIComponent(examId)}`
      : `/builder/${encodeURIComponent(examId)}`;
    if (inSatWorkspace) requestAuthoringDraftOnEntry(examId);
    navigate(search ? `${base}?${search}` : base);
  };

  const handleIssue = (issue: AssessmentValidationIssue) => {
    const { questionId, field } = parseIssueLink(issue.path);
    if (!questionId && !field) return;
    const params = new URLSearchParams();
    if (questionId) params.set("question", questionId);
    if (field) params.set("field", field);
    openBuilder(exam.id, params.toString());
  };

  if (showStudentAccess) {
    return (
      <Suspense
        fallback={
          <div className="sat-product min-h-screen bg-background px-6 py-12" aria-busy="true" aria-label="Loading student access">
            <div className="mx-auto max-w-2xl animate-pulse rounded-2xl bg-card p-6 motion-reduce:animate-none">
              <div className="h-5 w-48 rounded-full bg-muted" />
              <div className="mt-3 h-4 w-full rounded-full bg-muted" />
            </div>
          </div>
        }
      >
        <StudentLinksDashboard
          exam={exam}
          overview={distributionQuery.data ?? null}
          isLoading={distributionQuery.isLoading && !distributionQuery.data}
          error={distributionQuery.error instanceof Error ? distributionQuery.error.message : null}
          onRefresh={() => distributionQuery.refetch()}
          onBackToRelease={openRelease}
          shell={{
            lifecycle: describeExamLifecycle(releaseState),
            showResponses: canViewExamResponses(role),
            onSelectTab: (tab) =>
              tab === "questions" ? openBuilder(exam.id) : navigate(examWorkspacePath(exam.id, tab)),
            onBack: () => navigate(inSatWorkspace ? satListReturnTarget("/sat/exams").to : "/admin/exams"),
            onPreview: () => navigate(`/sat/exams/${encodeURIComponent(exam.id)}/preview`),
          }}
        />
      </Suspense>
    );
  }

  return (
    <SatDeliveryReleasePage
      exam={exam}
      shell={shell}
      releaseState={releaseState}
      isLoading={shellState.kind === "loading" || releaseQuery.isLoading}
      loadError={
        shellLoadError ??
        (releaseQuery.error instanceof Error ? releaseQuery.error.message : null)
      }
      readiness={readinessQuery.data ?? null}
      isChecking={readinessQuery.isFetching}
      readinessError={readinessQuery.error instanceof Error ? readinessQuery.error.message : null}
      publishScope={publishScope}
      onPublishScopeChange={setPublishScope}
      onOpenStudentAccess={openStudentAccess}
      isPublishing={isPublishing}
      draftBusy={draftBusy}
      publishError={publishError}
      onSelectTab={(tab) =>
        tab === "questions" ? openBuilder(exam.id) : navigate(examWorkspacePath(exam.id, tab))
      }
      onBackToExams={() => navigate(inSatWorkspace ? satListReturnTarget("/sat/exams").to : "/admin/exams")}
      onRetryLoad={() => { void releaseQuery.refetch(); }}
      onRefreshReadiness={() => readinessQuery.refetch()}
      onPublish={handlePublish}
      onIssueClick={handleIssue}
      collaborationSlot={<CollaborationHeaderCluster surface="release" />}
    />
  );
}
