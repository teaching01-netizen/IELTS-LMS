/**
 * React hook for component-level error handling
 * Provides consistent error state management and user feedback
 */

import { useState, useCallback } from 'react';
import { logError } from './errorLogger';
import { isAppError, getErrorMessage } from './errorTypes';

export interface ErrorState {
  error: Error | null;
  isError: boolean;
  errorMessage: string;
  errorCode?: string | undefined;
}

export interface UseErrorHandlerReturn extends ErrorState {
  setError: (error: Error | null) => void;
  clearError: () => void;
  handleError: (error: unknown, context?: Record<string, unknown>) => void;
  executeWithErrorHandling: <T>(
    fn: () => Promise<T> | T,
    context?: Record<string, unknown>
  ) => Promise<T | null>;
}

/**
 * Hook for handling errors in components
 * Provides error state and error handling utilities
 */
export function useErrorHandler(): UseErrorHandlerReturn {
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const handleError = useCallback((error: unknown, context?: Record<string, unknown>) => {
    // Convert unknown error to Error if needed
    let errorObj: Error;
    
    if (isAppError(error)) {
      errorObj = error;
    } else if (error instanceof Error) {
      errorObj = error;
    } else if (typeof error === 'string') {
      errorObj = new Error(error);
    } else {
      errorObj = new Error('An unknown error occurred');
    }

    // Log the error
    logError(errorObj, context);

    // Update state
    setError(errorObj);
  }, []);

  const executeWithErrorHandling = useCallback(
    async <T,>(
      fn: () => Promise<T> | T,
      context?: Record<string, unknown>
    ): Promise<T | null> => {
      try {
        clearError();
        const result = await fn();
        return result;
      } catch (error) {
        handleError(error, context);
        return null;
      }
    },
    [handleError, clearError]
  );

  return {
    error,
    isError: error !== null,
    errorMessage: error ? getErrorMessage(error) : '',
    errorCode: error && isAppError(error) ? error.code : undefined,
    setError,
    clearError,
    handleError,
    executeWithErrorHandling,
  };
}

/**
 * Hook for handling async operations with error state
 * Provides loading state along with error handling
 */
export interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  isError: boolean;
  errorMessage: string;
}

export interface UseAsyncHandlerReturn<T> extends AsyncState<T> {
  execute: (fn: () => Promise<T>) => Promise<void>;
  reset: () => void;
}

export function useAsyncHandler<T = unknown>(): UseAsyncHandlerReturn<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    isLoading: false,
    error: null,
    isError: false,
    errorMessage: '',
  });

  const execute = useCallback(async (fn: () => Promise<T>) => {
    setState({ data: null, isLoading: true, error: null, isError: false, errorMessage: '' });
    
    try {
      const result = await fn();
      setState({
        data: result,
        isLoading: false,
        error: null,
        isError: false,
        errorMessage: '',
      });
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error('An error occurred');
      logError(errorObj);
      setState({
        data: null,
        isLoading: false,
        error: errorObj,
        isError: true,
        errorMessage: getErrorMessage(errorObj),
      });
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      data: null,
      isLoading: false,
      error: null,
      isError: false,
      errorMessage: '',
    });
  }, []);

  return {
    ...state,
    execute,
    reset,
  };
}
