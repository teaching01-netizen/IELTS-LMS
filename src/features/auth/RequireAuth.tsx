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
 * Student entry is free by default: any non-empty access code
 * (`W123456`, `alice`, `guest-alpha_01`, … — see `normalizeAccessCode` in
 * `StudentEntryRoute`) may unlock anonymous student delivery. Only reserved
 * route words (e.g. `/student/:id/precheck`, `/student/:id/register`) must
 * not render protected children without a session.
 */
const RESERVED_STUDENT_PATH_SEGMENTS = new Set(['register', 'precheck', 'lobby', 'exam', 'complete']);

function isStudentAccessCode(value: string | undefined): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const trimmed = decoded.trim();
  if (!trimmed) {
    return false;
  }
  return !RESERVED_STUDENT_PATH_SEGMENTS.has(trimmed.toLocaleLowerCase());
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
      // Allow student access when the route carries any non-empty access
      // code (e.g. `/student/:scheduleId/alice`). Anonymous renders of
      // reserved phases (`/student/:id/precheck`, …) still bypass protection.
      if (
        isStudentAccessCode(studentPath.wcode) &&
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
