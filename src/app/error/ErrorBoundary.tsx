/**
 * React Error Boundary Component
 * Catches JavaScript errors in component tree, logs them, and displays a fallback UI
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logError } from './errorLogger';
import { getErrorMessage, getErrorCode } from './errorTypes';

type ErrorBoundaryFallback = (props: { error: Error; reset: () => void }) => ReactNode;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ErrorBoundaryFallback;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: Array<string | number>;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary Component
 * Wraps component tree to catch and handle errors gracefully
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error
    logError(error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
    });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Store error info in state
    this.setState({
      error,
      errorInfo,
    });
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    const { hasError } = this.state;
    const { resetKeys } = this.props;

    // Reset error boundary when reset keys change
    if (hasError && resetKeys && resetKeys.length > 0) {
      const hasResetKeyChanged = resetKeys.some(
        (key) => prevProps.resetKeys?.[prevProps.resetKeys.indexOf(key)] !== key
      );

      if (hasResetKeyChanged) {
        this.reset();
      }
    }
  }

  reset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  override render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        if (typeof fallback === 'function') {
          return fallback({
            error: error!,
            reset: this.reset,
          });
        }
        return fallback;
      }

      // Default fallback UI
      return <ErrorFallback error={error} errorInfo={errorInfo} reset={this.reset} />;
    }

    return children;
  }
}

/**
 * Default Error Fallback UI
 * Displays error information with retry option
 */
interface ErrorFallbackProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  reset: () => void;
}

function ErrorFallback({ error, errorInfo, reset }: ErrorFallbackProps): React.ReactElement {
  const errorMessage = error ? getErrorMessage(error) : 'An unexpected error occurred';
  const errorCode = error ? getErrorCode(error) : 'UNKNOWN_ERROR';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4">
            <svg
              className="h-8 w-8 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-gray-600 mb-6">{errorMessage}</p>

          <div className="bg-gray-50 rounded-md p-4 mb-6 text-left">
            <p className="text-xs font-semibold text-gray-500 mb-2">Error Code: {errorCode}</p>
            {error && (
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer font-semibold mb-2">Error Details</summary>
                <pre className="whitespace-pre-wrap break-all">{error.message}</pre>
                {error.stack && import.meta.env.DEV && (
                  <pre className="whitespace-pre-wrap break-all mt-2 text-gray-500">{error.stack}</pre>
                )}
              </details>
            )}
            {errorInfo && import.meta.env.DEV && (
              <details className="text-xs text-gray-600 mt-2">
                <summary className="cursor-pointer font-semibold mb-2">Component Stack</summary>
                <pre className="whitespace-pre-wrap break-all">{errorInfo.componentStack}</pre>
              </details>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={reset}
              className="inline-flex justify-center items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.href = '/'}
              className="inline-flex justify-center items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Go to Home
            </button>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            If this problem persists, please contact support with the error code above.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Higher-order component to wrap a component with error boundary
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
): React.ComponentType<P> {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}
