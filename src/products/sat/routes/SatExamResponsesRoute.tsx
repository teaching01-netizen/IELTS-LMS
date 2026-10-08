import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useExamQuery } from '../../../features/exam-authoring/api/examQueries';
import { ExamSettingsSheet } from '../../../features/exam-authoring/ui/settings/ExamSettingsSheet';
import { ExamWorkspaceHeader } from '../../../features/exam-authoring/ui/shell/ExamWorkspaceHeader';
import { deliveryDestination, examWorkspacePath } from '../../../features/exam-authoring/ui/shell/examLifecycle';
import { useExamWorkspaceChrome } from '../../../features/exam-authoring/ui/shell/useExamWorkspaceChrome';
import { SatEmptyState, SatPageError, SatPageLoading, SatPrimaryButton } from '../ui/SatPage';
import { satListReturnTarget } from '../ui/useSatListReturn';
import { SatResultsContent } from './SatResultsRoute';

/**
 * `/sat/exams/:examId/responses` — the exam workspace's Responses tab. It is the
 * existing exam-scoped results content under the shared exam header, so staff
 * never have to search for their exam again. Admin-only (see the route table):
 * builders can author but have never been able to read results.
 */
export function SatExamResponsesRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const examQuery = useExamQuery(examId);
  const chrome = useExamWorkspaceChrome(examId ?? '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const backToLibrary = () => {
    const back = satListReturnTarget('/sat/exams');
    navigate(back.to, back.state ? { state: back.state } : undefined);
  };

  if (!examId) {
    return <SatPageError title="Responses could not load" description="A valid SAT exam is required." retryLabel="Back to Exam Library" onRetry={backToLibrary} />;
  }
  if (examQuery.isLoading) return <SatPageLoading label="Opening exam responses…" />;
  if (examQuery.error || !examQuery.data) {
    return <SatPageError title="Responses could not load" description={examQuery.error instanceof Error ? examQuery.error.message : 'The SAT exam is unavailable.'} retryLabel="Back to Exam Library" onRetry={backToLibrary} />;
  }
  const exam = examQuery.data;
  if (exam.providerKey !== 'sat') {
    return <SatPageError title="This is not a SAT exam" description="Open this exam from its IELTS workspace instead." retryLabel="Back to Exam Library" onRetry={backToLibrary} />;
  }
  const accessPath = `/sat/exams/${encodeURIComponent(exam.id)}/access`;
  return (
    <div className="sat-product min-h-screen bg-[var(--sat-staff-canvas,var(--sat-canvas))]">
      <ExamWorkspaceHeader
        examTitle={exam.title}
        lifecycle={chrome.lifecycle}
        activeTab="responses"
        showResponses={chrome.showResponses}
        onSelectTab={(tab) => {
          if (tab !== 'responses') navigate(examWorkspacePath(exam.id, tab));
        }}
        onQuickSettings={() => setSettingsOpen(true)}
        onBack={backToLibrary}
        onPreview={() => navigate(`/sat/exams/${encodeURIComponent(exam.id)}/preview`)}
        {...(chrome.canCreateSession ? { onCreateSession: () => navigate(deliveryDestination(exam.id)) } : {})}
      />
      <SatResultsContent
        lockedExamId={exam.id}
        basePath={examWorkspacePath(exam.id, 'responses')}
        emptyState={
          <SatEmptyState
            icon={<BarChart3 size={18} aria-hidden="true" />}
            title="No results yet"
            hint="Results appear here once students check in to a session for this exam."
            action={<SatPrimaryButton onClick={() => navigate(chrome.canCreateSession ? deliveryDestination(exam.id) : accessPath)}>{chrome.canCreateSession ? 'Create session' : 'Open sessions'}</SatPrimaryButton>}
          />
        }
      />
      {settingsOpen ? <ExamSettingsSheet examId={exam.id} open onClose={() => setSettingsOpen(false)} onEditExam={() => navigate(examWorkspacePath(exam.id, 'questions'))} /> : null}
    </div>
  );
}
