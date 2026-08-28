import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ExamEntity } from "../../../types/domain";
import {
  useAssessmentReleaseReadiness,
  useAuthoringShell,
  usePublishAssessment,
} from "../api/assessmentQueries";
import type {
  AssessmentValidationIssue,
  PublishedAssessmentVersion,
} from "../contracts/assessment";
import { SatDeliveryReleasePage } from "../ui/SatDeliveryReleasePage";

interface SatDeliveryReleaseRouteProps {
  exam: ExamEntity;
  onExamRefresh: () => Promise<unknown>;
}

export function SatDeliveryReleaseRoute({ exam, onExamRefresh }: SatDeliveryReleaseRouteProps) {
  const navigate = useNavigate();
  const shellQuery = useAuthoringShell(exam.id);
  const publishMutation = usePublishAssessment(exam.id);
  const [publishedVersion, setPublishedVersion] = useState<PublishedAssessmentVersion | null>(null);
  const shell = shellQuery.data;
  const readinessQuery = useAssessmentReleaseReadiness(
    exam.id,
    shell?.versionId,
    shell?.versionRevision
  );

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

    const published = await publishMutation.mutateAsync({
      revision: exam.revision,
      expectedDraftVersionId: shell.versionId,
      expectedDraftRevision: shell.versionRevision,
      ...(publishNotes?.trim() ? { publishNotes: publishNotes.trim() } : {}),
    });
    setPublishedVersion(published);
    await onExamRefresh();
  };

  const handleIssue = (issue: AssessmentValidationIssue) => {
    const match = /^examQuestion:([^:]+):(.*)$/.exec(issue.path);
    const params = new URLSearchParams();
    if (match?.[1]) params.set("question", match[1]);
    if (match?.[2]) params.set("field", match[2]);
    navigate(`/builder/${exam.id}${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const handleCreateSchedule = () => {
    navigate("/admin/scheduling", {
      state: {
        initialScheduleDraft: {
          examId: exam.id,
          openCreateModal: true,
        },
      },
    });
  };

  return (
    <SatDeliveryReleasePage
      exam={exam}
      shell={shell ?? null}
      isLoading={shellQuery.isLoading}
      loadError={shellQuery.error instanceof Error ? shellQuery.error.message : null}
      readiness={readinessQuery.data ?? null}
      isChecking={readinessQuery.isFetching}
      readinessError={readinessQuery.error instanceof Error ? readinessQuery.error.message : null}
      publishedVersion={publishedVersion}
      isPublishing={publishMutation.isPending}
      publishError={publishMutation.error instanceof Error ? publishMutation.error.message : null}
      onBackToBuilder={() => navigate(`/builder/${exam.id}`)}
      onBackToExams={() => navigate("/admin/exams")}
      onRefreshReadiness={() => readinessQuery.refetch()}
      onPublish={handlePublish}
      onIssueClick={handleIssue}
      onCreateSchedule={handleCreateSchedule}
    />
  );
}
