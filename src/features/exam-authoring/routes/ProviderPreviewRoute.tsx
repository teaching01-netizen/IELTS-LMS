import { useParams } from "react-router-dom";
import { ErrorSurface } from "@components/ui/ErrorSurface";
import { LoadingSurface } from "@components/ui/LoadingSurface";
import { ExamPreviewRoute } from "../../builder/routes/ExamPreviewRoute";
import { useExamQuery } from "../api/examQueries";
import { SatPreviewRoute } from "../../student-delivery/routes/SatPreviewRoute";

export function ProviderPreviewRoute() {
  const { examId } = useParams<{ examId: string }>();
  const examQuery = useExamQuery(examId);

  if (examQuery.isLoading) return <LoadingSurface label="Loading preview…" />;
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
