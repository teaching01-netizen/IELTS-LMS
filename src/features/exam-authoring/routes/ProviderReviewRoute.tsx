import { useParams } from "react-router-dom";
import { ErrorSurface } from "@components/ui/ErrorSurface";
import { LoadingSurface } from "@components/ui/LoadingSurface";
import { ExamReviewRoute } from "../../builder/routes/ExamReviewRoute";
import { useExamQuery } from "../api/examQueries";
import { SatDeliveryReleaseRoute } from "./SatDeliveryReleaseRoute";

export function ProviderReviewRoute() {
  const { examId } = useParams<{ examId: string }>();
  const examQuery = useExamQuery(examId);

  if (examQuery.isLoading) return <LoadingSurface label="Loading release workspace…" />;
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
    return (
      <SatDeliveryReleaseRoute exam={examQuery.data} onExamRefresh={() => examQuery.refetch()} />
    );
  }

  return <ExamReviewRoute />;
}
