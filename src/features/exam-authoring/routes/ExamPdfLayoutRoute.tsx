import { useNavigate, useParams } from "react-router-dom";
import { SatPageError, SatPageLoading } from "../../../products/sat/ui/SatPage";
import { useExamQuery } from "../api/examQueries";
import { examWorkspacePath } from "../ui/shell/examLifecycle";
import { ExamPdfLayoutWorkspace } from "../ui/settings/pdf-layout/ExamPdfLayoutWorkspace";

export function ExamPdfLayoutRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const examQuery = useExamQuery(examId);

  if (examQuery.isLoading) return <SatPageLoading label="Opening PDF editor…" />;
  const exam = examQuery.data;
  if (examQuery.error || !exam || exam.providerKey !== "sat") {
    return (
      <SatPageError
        title="PDF editor unavailable"
        description={examQuery.error instanceof Error ? examQuery.error.message : "Choose a SAT exam to open its PDF editor."}
        retryLabel={examQuery.error ? "Retry" : "Back to Exams"}
        onRetry={() => {
          if (examQuery.error) void examQuery.refetch();
          else void navigate("/sat/exams");
        }}
      />
    );
  }

  return (
    <ExamPdfLayoutWorkspace
      key={exam.id}
      examId={exam.id}
      examTitle={exam.title}
      canEdit={exam.canEdit}
      settingsPath={examWorkspacePath(exam.id, "settings") + "?panel=scoring"}
    />
  );
}
