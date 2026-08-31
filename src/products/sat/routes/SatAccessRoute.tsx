import { useNavigate, useParams } from 'react-router-dom';
import { ErrorSurface } from '../../../components/ui/ErrorSurface';
import { LoadingSurface } from '../../../components/ui/LoadingSurface';
import { useAccessDistributionOverview } from '../../../features/exam-authoring/api/assessmentAccessLinkQueries';
import { useExamQuery } from '../../../features/exam-authoring/api/examQueries';
import { StudentLinksDashboard } from '../../../features/exam-authoring/ui/access-links/StudentLinksDashboard';

export function SatAccessRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const examQuery = useExamQuery(examId);
  const distributionQuery = useAccessDistributionOverview(examId ?? '');

  if (examQuery.isLoading) return <LoadingSurface label="Opening Student Access…" />;
  if (examQuery.error || !examQuery.data) {
    return <ErrorSurface title="Student Access could not load" description={examQuery.error instanceof Error ? examQuery.error.message : 'The SAT exam is unavailable.'} actionLabel="Back to Exam Library" onAction={() => navigate('/sat/exams')} />;
  }
  const exam = examQuery.data;
  if (exam.providerKey !== 'sat') {
    return <ErrorSurface title="This is not a SAT exam" description="Open this exam from its IELTS workspace instead." actionLabel="Back to Exam Library" onAction={() => navigate('/sat/exams')} />;
  }

  return (
    <StudentLinksDashboard
      exam={exam}
      overview={distributionQuery.data ?? null}
      isLoading={distributionQuery.isLoading && !distributionQuery.data}
      error={distributionQuery.error instanceof Error ? distributionQuery.error.message : null}
      onRefresh={() => distributionQuery.refetch()}
      onBackToRelease={() => navigate(`/sat/exams/${exam.id}/release`)}
    />
  );
}
