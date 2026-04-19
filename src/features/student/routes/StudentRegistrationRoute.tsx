import { Navigate, useLocation, useParams } from 'react-router-dom';

export function StudentRegistrationRoute() {
  // Legacy compatibility route: redirect to the new student entry flow.
  // Preserve schedule id and allow optional wcode prefill via querystring.
  // `/student/:scheduleId/register` -> `/student/:scheduleId`
  const { scheduleId } = useParams<{ scheduleId: string }>();
  const location = useLocation();
  const target = scheduleId ? `/student/${scheduleId}${location.search}` : '/student';
  return <Navigate to={target} replace />;
}
