import { lazy, Suspense } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { ExamEntity } from "../../../types/domain";
import {
  useAssessmentReleaseReadiness,
  useAssessmentReleaseState,
  usePublishAssessment,
} from "../api/assessmentQueries";
import { useAuthoringShellLifecycle } from "../application/authoringShellLifecycle";
import { useAccessDistributionOverview } from "../api/assessmentAccessLinkQueries";
import type { AssessmentValidationIssue } from "../contracts/assessment";
import { parseIssueLink } from "../ui/release/releaseSelectors";
import { SatDeliveryReleasePage } from "../ui/SatDeliveryReleasePage";
import { CollaborationHeaderCluster } from "../ui/collaboration/CollaborationHeaderCluster";

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
  const shellLifecycle = useAuthoringShellLifecycle(exam.id);
  const publishMutation = usePublishAssessment(exam.id);
  const releaseQuery = useAssessmentReleaseState(exam.id);
  const distributionQuery = useAccessDistributionOverview(exam.id);
  const shellState = shellLifecycle.state;
  // Publish needs READY. Every other lifecycle state is reported through
  // loadError instead of being passed off as a missing draft.
  const shell = shellState.kind === "ready" ? shellState.shell : null;
  const shellLoadError =
    shellState.kind === "error"
      ? shellState.error.message
      : shellState.kind === "exam-not-found"
        ? "This exam does not exist."
        : shellState.kind === "forbidden"
          ? "You do not have permission to view this exam."
          : null;
  const releaseState = releaseQuery.data ?? null;
  const shouldCheckReadiness = releaseState?.state !== "published_current";
  const readinessQuery = useAssessmentReleaseReadiness(
    exam.id,
    shell?.versionId,
    shell?.versionRevision,
    shouldCheckReadiness
  );
  const view = searchParams.get("view");
  const showStudentAccess = view === "access" || view === "links";

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

  const handlePublish = async (publishNotes?: string) => {
    if (!shell) throw new Error("The SAT draft is not loaded.");
    if (typeof exam.revision !== "number" || !Number.isInteger(exam.revision)) {
      throw new Error(
        "The latest exam revision is unavailable. Refresh the release page before publishing."
      );
    }
    const readiness = readinessQuery.data;
    if (!readiness || !readiness.valid) {
      throw new Error("Run publish checks and resolve all blocking issues first.");
    }
    if (
      readiness.versionId !== shell.versionId ||
      readiness.versionRevision !== shell.versionRevision
    ) {
      await readinessQuery.refetch();
      throw new Error("The SAT draft changed. Publish checks were refreshed; review them again.");
    }

    const trimmedNotes = (publishNotes ?? "").trim();
    // One key per publish confirmation: a double-click or lost response
    // replays the same release instead of sealing a second version.
    await publishMutation.mutateAsync({
      revision: exam.revision,
      expectedDraftVersionId: shell.versionId,
      expectedDraftRevision: shell.versionRevision,
      ...(trimmedNotes ? { publishNotes: trimmedNotes.slice(0, 1000) } : {}),
      operationKey: crypto.randomUUID(),
    });
    // Refetch failures must never block navigation: the publish already
    // succeeded, so settle every refresh independently and continue.
    const settled = await Promise.allSettled([
      onExamRefresh(),
      releaseQuery.refetch(),
      distributionQuery.refetch(),
    ]);
    for (const result of settled) {
      if (result.status === "rejected") {
        console.error("[sat-release] post-publish refresh failed", result.reason);
      }
    }
    openStudentAccess();
  };

  const handleIssue = (issue: AssessmentValidationIssue) => {
    const { questionId, field } = parseIssueLink(issue.path);
    if (!questionId && !field) return;
    const params = new URLSearchParams();
    if (questionId) params.set("question", questionId);
    if (field) params.set("field", field);
    const base = inSatWorkspace
      ? `/sat/exams/${encodeURIComponent(exam.id)}`
      : `/builder/${encodeURIComponent(exam.id)}`;
    navigate(params.toString() ? `${base}?${params.toString()}` : base);
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
      onOpenStudentAccess={openStudentAccess}
      isPublishing={publishMutation.isPending}
      publishError={publishMutation.error instanceof Error ? publishMutation.error.message : null}
      onBackToBuilder={() => navigate(inSatWorkspace ? `/sat/exams/${encodeURIComponent(exam.id)}` : `/builder/${encodeURIComponent(exam.id)}`)}
      onBackToExams={() => navigate(inSatWorkspace ? "/sat/exams" : "/admin/exams")}
      onRefreshReadiness={() => readinessQuery.refetch()}
      onPublish={handlePublish}
      onIssueClick={handleIssue}
      collaborationSlot={<CollaborationHeaderCluster surface="release" />}
    />
  );
}
