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

export function RequireAuth({ allowedRoles, children }: RequireAuthProps) {
  const location = useLocation();
  const { session, status } = useAuthSession();

  if (status === 'loading') {
    return <LoadingSurface label="Loading Session..." />;
  }

  // Allow student routes without web auth - students authenticate via wcode, not session
  const isStudentRoute = location.pathname.startsWith('/student/') && location.pathname.split('/').length >= 4;
  if (!session && !isStudentRoute) {
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
