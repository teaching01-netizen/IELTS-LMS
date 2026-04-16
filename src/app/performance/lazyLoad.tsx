/**
 * Lazy loading utilities for code splitting
 * Provides React.lazy with loading states and error boundaries
 */

import { Suspense, lazy, type ComponentType, type ReactElement } from 'react';
import { ErrorBoundary } from '../error/ErrorBoundary';

/**
 * Loading fallback component
 */
interface LoadingFallbackProps {
  message?: string | undefined;
}

export function LoadingFallback({ message = 'Loading...' }: LoadingFallbackProps): ReactElement {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4" />
        <p className="text-gray-600 text-sm">{message}</p>
      </div>
    </div>
  );
}

/**
 * Error fallback component for lazy-loaded components
 */
interface LazyErrorFallbackProps {
  error: Error;
  retry: () => void;
}

function LazyErrorFallback({ error, retry }: LazyErrorFallbackProps): ReactElement {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="text-red-600 mb-4">
          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Failed to load component</h3>
        <p className="text-gray-600 text-sm mb-4">{error.message}</p>
        <button
          onClick={retry}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

/**
 * Lazy load a component with loading and error states
 * @param importFn - Function that imports the component
 * @param loadingMessage - Custom loading message
 * @param componentName - Component name for error boundary
 */
export function lazyLoad<TProps extends object>(
  importFn: () => Promise<{ default: ComponentType<TProps> }>,
  loadingMessage?: string,
  componentName?: string
): ComponentType<TProps> {
  const LazyComponent = lazy(() => importFn());

  const WrappedComponent = (props: TProps): ReactElement => (
    <ErrorBoundary
      fallback={({ error, reset }) => <LazyErrorFallback error={error} retry={reset} />}
    >
      <Suspense fallback={<LoadingFallback {...(loadingMessage ? { message: loadingMessage } : {})} />}>
        <LazyComponent {...props} />
      </Suspense>
    </ErrorBoundary>
  );

  WrappedComponent.displayName = componentName ?? 'LazyLoad(Component)';

  return WrappedComponent;
}

/**
 * Lazy load a component without error boundary (use when parent has one)
 */
export function lazyLoadNoBoundary<TProps extends object>(
  importFn: () => Promise<{ default: ComponentType<TProps> }>,
  loadingMessage?: string
): ComponentType<TProps> {
  const LazyComponent = lazy(() => importFn());

  const WrappedComponent = (props: TProps): ReactElement => (
    <Suspense fallback={<LoadingFallback {...(loadingMessage ? { message: loadingMessage } : {})} />}>
      <LazyComponent {...props} />
    </Suspense>
  );

  return WrappedComponent;
}

/**
 * Preload a lazy component
 * Useful for preloading components before they're needed
 */
export function preloadLazyComponent<TProps extends object>(
  importFn: () => Promise<{ default: ComponentType<TProps> }>
): void {
  importFn();
}

/**
 * Create a lazy-loaded modal component
 */
export function lazyLoadModal<TProps extends object>(
  importFn: () => Promise<{ default: ComponentType<TProps> }>,
  componentName?: string
): ComponentType<TProps> {
  return lazyLoad(importFn, 'Loading modal...', componentName);
}

/**
 * Create a lazy-loaded chart component
 */
export function lazyLoadChart<TProps extends object>(
  importFn: () => Promise<{ default: ComponentType<TProps> }>,
  componentName?: string
): ComponentType<TProps> {
  return lazyLoad(importFn, 'Loading chart...', componentName);
}

/**
 * Create a lazy-loaded form component
 */
export function lazyLoadForm<TProps extends object>(
  importFn: () => Promise<{ default: ComponentType<TProps> }>,
  componentName?: string
): ComponentType<TProps> {
  return lazyLoad(importFn, 'Loading form...', componentName);
}
