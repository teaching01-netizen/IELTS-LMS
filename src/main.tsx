import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {RouterProvider} from 'react-router-dom';
import {QueryClientProvider} from '@tanstack/react-query';
import {router} from './app/router/createRouter';
import {ErrorBoundary} from './app/error/ErrorBoundary';
import {queryClient} from './app/data/queryClient';
import {AuthSessionProvider} from './features/auth/authSession';
import './index.css';

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
