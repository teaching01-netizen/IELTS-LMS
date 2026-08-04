import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {RouterProvider} from 'react-router-dom';
import {QueryClientProvider} from '@tanstack/react-query';
import {router} from './routes';
import {ErrorBoundary} from './app/error/ErrorBoundary';
import {queryClient} from './app/data/queryClient';
import {AuthSessionProvider} from './features/auth/authSession';
import {pruneStudentAttemptCache} from './services/studentAttemptRepository';
import './index.css';

// M3: purge expired/compacted attempt-cache records (including expired
// pending submissions) at app bootstrap. Best-effort and non-blocking; a
// storage throw at startup must not produce an unhandled rejection.
void pruneStudentAttemptCache().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthSessionProvider>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <RouterProvider router={router} />
        </ErrorBoundary>
      </QueryClientProvider>
    </AuthSessionProvider>
  </StrictMode>,
);
