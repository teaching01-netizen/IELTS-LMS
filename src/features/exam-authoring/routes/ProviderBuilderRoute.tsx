import { useParams } from 'react-router-dom';
import { ErrorSurface } from '@components/ui/ErrorSurface';
import { LoadingSurface } from '@components/ui/LoadingSurface';
import { ExamConfigRoute } from '../../builder/routes/ExamConfigRoute';
import { useExamQuery } from '../api/examQueries';
import { SatAuthoringRoute } from './SatAuthoringRoute';

export function ProviderBuilderRoute() {
  const { examId } = useParams<{ examId: string }>();
  const examQuery = useExamQuery(examId);

  if (examQuery.isLoading) return <LoadingSurface label="Loading exam…" />;
  if (examQuery.error) {
    return <ErrorSurface title="Unable to load exam" description={examQuery.error instanceof Error ? examQuery.error.message : 'The exam could not be loaded.'} actionLabel="Retry" onAction={() => void examQuery.refetch()} />;
  }
  if (examQuery.data?.providerKey === 'sat') {
    return <SatAuthoringRoute examId={examQuery.data.id} examTitle={examQuery.data.title} />;
  }
  return <ExamConfigRoute />;
}
