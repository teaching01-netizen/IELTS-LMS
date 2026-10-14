import { Navigate, useLocation, useParams } from "react-router-dom";
import { ErrorSurface } from "@components/ui/ErrorSurface";
import { LoadingSurface } from "@components/ui/LoadingSurface";
import { ExamReviewRoute } from "../../builder/routes/ExamReviewRoute";
import { useExamQuery } from "../api/examQueries";
import { examWorkspacePath } from "../ui/shell/examLifecycle";

/**
 * IELTS keeps its review page. A SAT exam has no manual publish step: a room
 * captures the latest saved exam, so the legacy release URL (old bookmarks and
 * deep links) lands on Settings, or on Rooms for the old student-access view.
 */
export function ProviderReviewRoute() {
  const { examId } = useParams<{ examId: string }>();
  const location = useLocation();
  const examQuery = useExamQuery(examId);

  if (examQuery.isLoading) return <LoadingSurface label="Loading exam…" />;
  if (examQuery.error) {
    return (
      <ErrorSurface
        title="Unable to load exam"
        description={
          examQuery.error instanceof Error
            ? examQuery.error.message
            : "The exam could not be loaded."
        }
        actionLabel="Retry"
        onAction={() => void examQuery.refetch()}
      />
    );
  }
  if (!examQuery.data) {
    return <ErrorSurface title="Exam not found" description="The requested exam does not exist." />;
  }

  if (examQuery.data.providerKey === "sat") {
    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    const tab = view === "access" || view === "links" ? "delivery" : "settings";
    params.delete("view");
    const search = params.toString();
    return <Navigate replace to={`${examWorkspacePath(examQuery.data.id, tab)}${search ? `?${search}` : ""}`} />;
  }

  return <ExamReviewRoute />;
}
