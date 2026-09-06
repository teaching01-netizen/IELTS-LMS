import React, { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LoadingSurface } from '@components/ui';
import { resolveRoleLandingPath, useAuthSession } from './authSession';
import type { AuthUserRole } from './api/authGateway';

interface RequireAuthProps {
  allowedRoles?: AuthUserRole[] | undefined;
  children: ReactNode;
}

function buildNextPath(location: ReturnType<typeof useLocation>) {
  return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * Student wcodes look like `W123456` (see `normalizeAccessCode` in
 * `StudentEntryRoute`). Only a well-formed wcode may unlock anonymous student
 * delivery — anything else (e.g. `/student/:id/precheck`) must not render
 * protected children without a session.
 */
const STUDENT_WCODE_PATTERN = /^W\d{6}$/;

function isStudentWcode(value: string | undefined): value is string {
  return typeof value === 'string' && STUDENT_WCODE_PATTERN.test(value.trim());
}

function parseStudentPath(pathname: string): { scheduleId: string; wcode?: string } | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'student') {
    return null;
  }

  const scheduleId = segments[1];
  if (!scheduleId) {
    return null;
  }

  const wcode = segments[2];
  if (wcode) {
    return { scheduleId, wcode };
  }

  return { scheduleId };
}

export function RequireAuth({ allowedRoles, children }: RequireAuthProps) {
  const location = useLocation();
  const { session, status } = useAuthSession();

  if (status === 'loading') {
    return <LoadingSurface label="Loading Session..." />;
  }

  if (!session) {
    const studentPath = parseStudentPath(location.pathname);
    if (studentPath) {
      // Allow student access only when the route carries a well-formed
      // registration wcode (e.g. `/student/:scheduleId/W250334`). Anonymous
      // renders of any other `/student/...` path would bypass protection.
      if (
        isStudentWcode(studentPath.wcode) &&
        allowedRoles?.includes('student')
      ) {
        return <>{children}</>;
      }

      // Allow check-in without auth for schedule entry routes.
      const isEntryRoute = location.pathname === `/student/${studentPath.scheduleId}`;
      if (isEntryRoute) {
        return <>{children}</>;
      }

      return <Navigate to={`/student/${studentPath.scheduleId}`} replace />;
    }

    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(buildNextPath(location))}`}
        replace
      />
    );
  }

  // If user has a session, validate their role
  if (session && allowedRoles && !allowedRoles.includes(session.user.role)) {
    return <Navigate to={resolveRoleLandingPath(session.user.role)} replace />;
  }

  return <>{children}</>;
}
