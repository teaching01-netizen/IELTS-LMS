import { useNavigate, useParams } from 'react-router-dom';
import { SatPageError, SatPageLoading } from '../ui/SatPage';
import { useAccessDistributionOverview } from '../../../features/exam-authoring/api/assessmentAccessLinkQueries';
import { useExamQuery } from '../../../features/exam-authoring/api/examQueries';
import { StudentLinksDashboard } from '../../../features/exam-authoring/ui/access-links/StudentLinksDashboard';
import {
  SatAuthoringCollaborationBoundary,
  useSatAuthoringCollaboration,
} from '../../../features/exam-authoring/realtime/coedit';

export function SatAccessRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const existingCollaboration = useSatAuthoringCollaboration();
  const examQuery = useExamQuery(examId ?? '');
  const distributionQuery = useAccessDistributionOverview(examId ?? '');
  if (!examId) {
    return <SatPageError title="Student Access could not load" description="A valid SAT exam is required." retryLabel="Back to Exam Library" onRetry={() => navigate('/sat/exams')} />;
  }

  if (examQuery.isLoading) return <SatPageLoading label="Opening Student Access…" />;
  if (examQuery.error || !examQuery.data) {
    return <SatPageError title="Student Access could not load" description={examQuery.error instanceof Error ? examQuery.error.message : 'The SAT exam is unavailable.'} retryLabel="Back to Exam Library" onRetry={() => navigate('/sat/exams')} />;
  }
  const exam = examQuery.data;
  if (exam.providerKey !== 'sat') {
    return <SatPageError title="This is not a SAT exam" description="Open this exam from its IELTS workspace instead." retryLabel="Back to Exam Library" onRetry={() => navigate('/sat/exams')} />;
  }

  const content = (
    <StudentLinksDashboard
      exam={exam}
      overview={distributionQuery.data ?? null}
      isLoading={distributionQuery.isLoading && !distributionQuery.data}
      error={distributionQuery.error instanceof Error ? distributionQuery.error.message : null}
      onRefresh={() => distributionQuery.refetch()}
      onBackToRelease={() => navigate(`/sat/exams/${exam.id}/release`)}
    />
  );
  return existingCollaboration ? content : (
    <SatAuthoringCollaborationBoundary examId={exam.id}>
      {content}
    </SatAuthoringCollaborationBoundary>
  );
}
