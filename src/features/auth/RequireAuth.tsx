import React, { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LoadingSurface } from '@components/ui';
import { resolveRoleLandingPath, useAuthSession } from './authSession';
import type { AuthUserRole } from '../../services/authService';

interface RequireAuthProps {
  allowedRoles?: AuthUserRole[] | undefined;
  children: ReactNode;
}

function buildNextPath(location: ReturnType<typeof useLocation>) {
  return `${location.pathname}${location.search}${location.hash}`;
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
      // Allow check-in without auth, but require a session for active exam delivery routes.
      const isEntryRoute = location.pathname === `/student/${studentPath.scheduleId}`;
      if (isEntryRoute) {
        return <>{children}</>;
      }

      if (studentPath.wcode) {
        const query = new URLSearchParams({ wcode: studentPath.wcode });
        return <Navigate to={`/student/${studentPath.scheduleId}?${query.toString()}`} replace />;
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
