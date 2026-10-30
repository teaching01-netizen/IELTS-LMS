import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {RouterProvider} from 'react-router-dom';
import {QueryClientProvider} from '@tanstack/react-query';
import {MotionConfig} from 'motion/react';
import {router} from './app/router/createRouter';
import {ErrorBoundary} from './app/error/ErrorBoundary';
import {queryClient} from './app/data/queryClient';
import {AuthSessionProvider, onAuthIdentityFenced, onAuthIdentityResolved} from './features/auth/authSession';
import {bindIeltsOfflinePackagesToAuth} from './features/student/infrastructure/ieltsOfflinePackageStore';
import {ConnectionRecoveryNotice} from './app/ConnectionRecoveryNotice';
import './index.css';

// Reset transient UI chrome (scroll, focus) on navigation so a new route
// never inherits scroll position or a stale focused control.
let lastLocationKey: string | null = null;
router.subscribe((state) => {
  const location = state.location;
  const key = location.pathname + location.search + location.hash;
  if (lastLocationKey !== null && lastLocationKey !== key) {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }
  lastLocationKey = key;
});

// Offline IELTS packages follow the account: a logout blocks them (never deletes unsent work).
bindIeltsOfflinePackagesToAuth({onAuthIdentityFenced, onAuthIdentityResolved});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <AuthSessionProvider>
          <QueryClientProvider client={queryClient}>
            <ConnectionRecoveryNotice />
            <RouterProvider router={router} />
          </QueryClientProvider>
        </AuthSessionProvider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
