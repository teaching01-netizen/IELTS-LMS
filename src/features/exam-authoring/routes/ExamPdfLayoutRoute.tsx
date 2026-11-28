import { useNavigate, useParams } from "react-router-dom";
import { SatPageError, SatPageLoading } from "../../../products/sat/ui/SatPage";
import { useExamQuery } from "../api/examQueries";
import { examWorkspacePath } from "../ui/shell/examLifecycle";
import { ExamWorkspaceHeader } from "../ui/shell/ExamWorkspaceHeader";
import { useExamWorkspaceChrome } from "../ui/shell/useExamWorkspaceChrome";
import { CollaborationHeaderCluster } from "../ui/collaboration/CollaborationHeaderCluster";
import { ExamPdfLayoutWorkspace } from "../ui/settings/pdf-layout/ExamPdfLayoutWorkspace";

export function ExamPdfLayoutRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const examQuery = useExamQuery(examId);
  const chrome = useExamWorkspaceChrome(examId ?? "");

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
    <div className="sat-product min-h-screen bg-[var(--sat-staff-canvas,#f7f7f8)] text-[var(--sat-staff-text-primary,var(--sat-label))]">
      {/* The exam workspace chrome never changes shape between exam pages. The
          PDF layout editor is a tab of Settings, so it keeps the same header
          and tabs as the settings page it was opened from. */}
      <ExamWorkspaceHeader
        examTitle={exam.title}
        lifecycle={chrome.lifecycle}
        activeTab="settings"
        showResponses={chrome.showResponses}
        onSelectTab={(tab) => {
          if (tab !== "settings") navigate(examWorkspacePath(exam.id, tab));
        }}
        onBack={() => navigate("/sat/exams")}
        collaborationSlot={<CollaborationHeaderCluster surface="release" />}
      />
      <ExamPdfLayoutWorkspace
        key={exam.id}
        examId={exam.id}
        examTitle={exam.title}
        canEdit={exam.canEdit}
        settingsPath={examWorkspacePath(exam.id, "settings") + "?panel=scoring"}
      />
    </div>
  );
}
