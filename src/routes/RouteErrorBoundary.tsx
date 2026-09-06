import { useEffect } from 'react';
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';

import { ErrorSurface } from '../components/ui/ErrorSurface';
import { logError } from '../app/error/errorLogger';

function getRouteErrorDescription(error: unknown) {
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return 'The page you requested could not be found. Check the URL or return to your dashboard.';
    }
    if (error.status === 401 || error.status === 403) {
      return 'You are not authorized to view this page. Sign in with an account that has access.';
    }
    if (error.status >= 500) {
      return 'The server hit an unexpected error while loading this page. Try again in a moment.';
    }
    return error.statusText || 'Request failed with status ' + error.status;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected routing error occurred.';
}

function isChunkLoadFailure(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /chunk|loading.*module|dynamically imported/i.test(message);
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  useEffect(() => {
    // Route errors have no class boundary above them in this tree, so log
    // them explicitly for observability.
    if (error !== undefined && error !== null) {
      logError(error instanceof Error ? error : new Error(getRouteErrorDescription(error)), {
        scope: 'RouteErrorBoundary',
        status: isRouteErrorResponse(error) ? error.status : undefined,
      });
    }
  }, [error]);

  return (
    <ErrorSurface
      title="Something went wrong"
      description={getRouteErrorDescription(error)}
      actionLabel="Try again"
      onAction={() => {
        // Retry through the router (preserves history); chunk-load failures
        // need a hard reload to fetch the new bundle.
        if (isChunkLoadFailure(error)) {
          window.location.reload();
          return;
        }
        void navigate(0);
      }}
    />
  );
}
