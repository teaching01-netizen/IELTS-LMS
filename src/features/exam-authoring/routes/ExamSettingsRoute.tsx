import { useNavigate, useParams } from "react-router-dom";
import { SatPageError, SatPageLoading } from "../../../products/sat/ui/SatPage";
import { useExamQuery } from "../api/examQueries";
import {
  SatAuthoringCollaborationBoundary,
  useSatAuthoringCollaboration,
} from "../realtime/coedit";
import { ExamSettingsPage } from "../ui/settings/ExamSettingsPage";

/** `/sat/exams/:examId/settings` — the Settings tab of the exam workspace. */
export function ExamSettingsRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const existingCollaboration = useSatAuthoringCollaboration();
  const examQuery = useExamQuery(examId);
  const backToLibrary = () => navigate("/sat/exams");

  if (!examId) {
    return (
      <SatPageError
        title="Settings could not load"
        description="A valid SAT exam is required."
        retryLabel="Back to Tests"
        onRetry={backToLibrary}
      />
    );
  }
  if (examQuery.isLoading) return <SatPageLoading label="Opening exam settings…" />;
  if (examQuery.error || !examQuery.data) {
    return (
      <SatPageError
        title="Settings could not load"
        description={examQuery.error instanceof Error ? examQuery.error.message : "The SAT exam is unavailable."}
        retryLabel="Back to Tests"
        onRetry={backToLibrary}
      />
    );
  }
  const exam = examQuery.data;
  if (exam.providerKey !== "sat") {
    return (
      <SatPageError
        title="This is not a SAT exam"
        description="Open this exam from its IELTS workspace instead."
        retryLabel="Back to Tests"
        onRetry={backToLibrary}
      />
    );
  }
  const content = <ExamSettingsPage exam={exam} />;
  return existingCollaboration ? (
    content
  ) : (
    <SatAuthoringCollaborationBoundary examId={exam.id}>{content}</SatAuthoringCollaborationBoundary>
  );
}
