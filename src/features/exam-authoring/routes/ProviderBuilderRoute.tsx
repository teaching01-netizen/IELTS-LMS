import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { ErrorSurface } from '@components/ui/ErrorSurface';
import { LoadingSurface } from '@components/ui/LoadingSurface';
import { SatAuthoringLoadingSurface } from '../ui/SatAuthoringStateSurfaces';
import { useExamQuery } from '../api/examQueries';
import {
  SatAuthoringCollaborationBoundary,
  useSatAuthoringCollaboration,
} from '../realtime/coedit';

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
  const existingCollaboration = useSatAuthoringCollaboration();
  const examQuery = useExamQuery(examId);

  if (examQuery.isLoading) return <LoadingSurface label="Loading exam…" />;
  if (examQuery.error) {
    return <ErrorSurface title="Unable to load exam" description={examQuery.error instanceof Error ? examQuery.error.message : 'The exam could not be loaded.'} actionLabel="Retry" onAction={() => void examQuery.refetch()} />;
  }
  if (examQuery.data?.providerKey === 'sat') {
    const content = <SatAuthoringRoute examId={examQuery.data.id} examTitle={examQuery.data.title} />;
    return (
      <Suspense fallback={<SatAuthoringLoadingSurface label="Loading SAT authoring…" />}>
        {existingCollaboration ? content : (
          <SatAuthoringCollaborationBoundary examId={examQuery.data.id}>
            {content}
          </SatAuthoringCollaborationBoundary>
        )}
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<LoadingSurface label="Loading authoring…" />}>
      <ExamConfigRoute />
    </Suspense>
  );
}
