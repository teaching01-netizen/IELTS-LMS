import { useParams } from "react-router-dom";
import { ErrorSurface } from "@components/ui/ErrorSurface";
import { LoadingSurface } from "@components/ui/LoadingSurface";
import { ExamPreviewRoute } from "../../builder/routes/ExamPreviewRoute";
import { useExamQuery } from "../api/examQueries";
import { SatPreviewRoute } from "../../student-delivery/routes/SatPreviewRoute";

/**
 * The provider exam preview.
 *
 * Its content comes from the committed projection (`assessmentAuthoringApi.
 * getPreview`), so the room's flush is what makes this screen current. The exam
 * DETAIL it renders around that content is a react-query read with a five
 * minute staleTime: a fresh-looking cache entry is never refetched on mount, so
 * the screen would otherwise describe the exam as it was when the builder first
 * loaded it. An entry marked stale by the authoring route's pre-navigation
 * invalidation is therefore held on the loading surface until the refetch that
 * the default `refetchOnMount` performs actually lands.
 */
export function ProviderPreviewRoute() {
  const { examId } = useParams<{ examId: string }>();
  const examQuery = useExamQuery(examId);

  if (examQuery.isLoading || (examQuery.isStale && examQuery.isFetching)) {
    return <LoadingSurface label="Loading preview…" />;
  }
  if (examQuery.error) {
    return (
      <ErrorSurface
        title="Unable to load exam preview"
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
    return <SatPreviewRoute examId={examQuery.data.id} />;
  }
  return <ExamPreviewRoute />;
}
