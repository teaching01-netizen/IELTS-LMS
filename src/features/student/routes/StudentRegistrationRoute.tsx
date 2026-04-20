import { StudentEntryRoute } from './StudentEntryRoute';

export function StudentRegistrationRoute() {
  // Public student check-in route. This issues a session cookie via `/api/v1/auth/student-entry`
  // then navigates into the authenticated student session route.
  return <StudentEntryRoute />;
}
