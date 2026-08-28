import { useParams } from 'react-router-dom';
import { ErrorSurface } from '@components/ui/ErrorSurface';
import { AuthoringWorkspace } from '../ui/AuthoringWorkspace';

export interface SatAuthoringRouteProps {
  examId?: string;
  examTitle?: string;
}

export function SatAuthoringRoute({ examId: propExamId, examTitle }: SatAuthoringRouteProps = {}) {
  const { examId: routeExamId } = useParams<{ examId: string }>();
  const examId = propExamId ?? routeExamId;
  if (!examId) {
    return <ErrorSurface title="SAT exam not found" description="A valid exam is required to open authoring." />;
  }
  return <AuthoringWorkspace examId={examId} examTitle={examTitle ?? 'Digital SAT'} />;
}
