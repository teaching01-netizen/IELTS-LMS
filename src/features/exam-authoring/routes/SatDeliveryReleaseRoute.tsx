import { useNavigate, useSearchParams } from "react-router-dom";
import type { ExamEntity } from "../../../types/domain";
import {
  useAssessmentReleaseReadiness,
  useAssessmentReleaseState,
  useAuthoringShell,
  usePublishAssessment,
} from "../api/assessmentQueries";
import { useAccessDistributionOverview } from "../api/assessmentAccessLinkQueries";
import type { AssessmentValidationIssue } from "../contracts/assessment";
import { SatDeliveryReleasePage } from "../ui/SatDeliveryReleasePage";
import { StudentLinksDashboard } from "../ui/access-links/StudentLinksDashboard";

interface SatDeliveryReleaseRouteProps {
  exam: ExamEntity;
  onExamRefresh: () => Promise<unknown>;
}

export function SatDeliveryReleaseRoute({ exam, onExamRefresh }: SatDeliveryReleaseRouteProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const shellQuery = useAuthoringShell(exam.id);
  const publishMutation = usePublishAssessment(exam.id);
  const releaseQuery = useAssessmentReleaseState(exam.id);
  const distributionQuery = useAccessDistributionOverview(exam.id);
  const shell = shellQuery.data;
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

    await publishMutation.mutateAsync({
      revision: exam.revision,
      expectedDraftVersionId: shell.versionId,
      expectedDraftRevision: shell.versionRevision,
      ...(publishNotes?.trim() ? { publishNotes: publishNotes.trim() } : {}),
    });
    await Promise.all([onExamRefresh(), releaseQuery.refetch(), distributionQuery.refetch()]);
    openStudentAccess();
  };

  const handleIssue = (issue: AssessmentValidationIssue) => {
    const match = /^examQuestion:([^:]+):(.*)$/.exec(issue.path);
    const params = new URLSearchParams();
    if (match?.[1]) params.set("question", match[1]);
    if (match?.[2]) params.set("field", match[2]);
    navigate(`/builder/${exam.id}${params.toString() ? `?${params.toString()}` : ""}`);
  };



  if (showStudentAccess) {
    return (
      <StudentLinksDashboard
        exam={exam}
        overview={distributionQuery.data ?? null}
        isLoading={distributionQuery.isLoading && !distributionQuery.data}
        error={distributionQuery.error instanceof Error ? distributionQuery.error.message : null}
        onRefresh={() => distributionQuery.refetch()}
        onBackToRelease={openRelease}
      />
    );
  }

  return (
    <SatDeliveryReleasePage
      exam={exam}
      shell={shell ?? null}
      releaseState={releaseState}
      isLoading={shellQuery.isLoading || releaseQuery.isLoading}
      loadError={
        shellQuery.error instanceof Error
          ? shellQuery.error.message
          : releaseQuery.error instanceof Error
            ? releaseQuery.error.message
            : null
      }
      readiness={readinessQuery.data ?? null}
      isChecking={readinessQuery.isFetching}
      readinessError={readinessQuery.error instanceof Error ? readinessQuery.error.message : null}
      onOpenStudentAccess={openStudentAccess}
      isPublishing={publishMutation.isPending}
      publishError={publishMutation.error instanceof Error ? publishMutation.error.message : null}
      onBackToBuilder={() => navigate(`/builder/${exam.id}`)}
      onBackToExams={() => navigate("/admin/exams")}
      onRefreshReadiness={() => readinessQuery.refetch()}
      onPublish={handlePublish}
      onIssueClick={handleIssue}
    />
  );
}
