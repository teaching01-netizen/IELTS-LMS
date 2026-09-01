import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { ErrorSurface } from '@components/ui/ErrorSurface';
import { LoadingSurface } from '@components/ui/LoadingSurface';
import { SatAuthoringLoadingSurface } from '../ui/SatAuthoringStateSurfaces';
import { useExamQuery } from '../api/examQueries';

const ExamConfigRoute = lazy(() =>
  import('../../builder/routes/ExamConfigRoute').then((module) => ({
    default: module.ExamConfigRoute,
  })),
);
const SatAuthoringRoute = lazy(() =>
  import('./SatAuthoringRoute').then((module) => ({
    default: module.SatAuthoringRoute,
  })),
);

export function ProviderBuilderRoute() {
  const { examId } = useParams<{ examId: string }>();
  const examQuery = useExamQuery(examId);

  if (examQuery.isLoading) return <LoadingSurface label="Loading exam…" />;
  if (examQuery.error) {
    return <ErrorSurface title="Unable to load exam" description={examQuery.error instanceof Error ? examQuery.error.message : 'The exam could not be loaded.'} actionLabel="Retry" onAction={() => void examQuery.refetch()} />;
  }
  if (examQuery.data?.providerKey === 'sat') {
    return (
      <Suspense fallback={<SatAuthoringLoadingSurface label="Loading SAT authoring…" />}>
        <SatAuthoringRoute examId={examQuery.data.id} examTitle={examQuery.data.title} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<LoadingSurface label="Loading authoring…" />}>
      <ExamConfigRoute />
    </Suspense>
  );
}
