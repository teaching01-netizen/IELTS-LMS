/**
 * Higher-order function for wrapping service methods with error handling
 * Provides consistent error transformation and logging across the service layer
 */

import { logError } from './errorLogger';
import {
  AppError,
  NetworkError,
  ValidationError,
  AuthError,
  NotFoundError,
  ConflictError,
  isAppError,
} from './errorTypes';

export type ServiceMethod<T = unknown, Args extends unknown[] = unknown[]> = (
  ...args: Args
) => Promise<T>;

export type ServiceResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
};

/**
 * Wraps a service method with error handling
 * Converts errors to ServiceResult format for consistent API
 */
export function withErrorHandling<T, Args extends unknown[]>(
  method: ServiceMethod<T, Args>,
  context?: string
): ServiceMethod<ServiceResult<T>, Args> {
  return async (...args: Args): Promise<ServiceResult<T>> => {
    try {
      const result = await method(...args);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error, context);
    }
  };
}

/**
 * Handles service errors and converts to ServiceResult
 */
function handleServiceError(error: unknown, context?: string): ServiceResult<never> {
  // Log the error with context
  logError(error, { context, serviceLayer: true });

  // If already an AppError, return it directly
  if (isAppError(error)) {
    return {
      success: false,
      error: error.message,
      errorCode: error.code,
    };
  }

  // Convert generic errors to AppErrors
  if (error instanceof Error) {
    // Network-related errors
    if (error.message.includes('fetch') || error.message.includes('network')) {
      const networkError = new NetworkError(error.message, error);
      return {
        success: false,
        error: networkError.message,
        errorCode: networkError.code,
      };
    }

    // Validation errors
    if (error.message.includes('validation') || error.message.includes('invalid')) {
      const validationError = new ValidationError(error.message);
      return {
        success: false,
        error: validationError.message,
        errorCode: validationError.code,
      };
    }

    // Not found errors
    if (error.message.includes('not found') || error.message.includes('404')) {
      const notFoundError = new NotFoundError();
      return {
        success: false,
        error: notFoundError.message,
        errorCode: notFoundError.code,
      };
    }

    // Generic error
    return {
      success: false,
      error: error.message,
      errorCode: 'UNKNOWN_ERROR',
    };
  }

  // Unknown error type
  return {
    success: false,
    error: 'An unknown error occurred',
    errorCode: 'UNKNOWN_ERROR',
  };
}

/**
 * Wraps multiple service methods with error handling
 * Useful for service classes
 */
export function withErrorHandlingClass<T extends Record<string, ServiceMethod>>(
  serviceClass: T,
  contextPrefix?: string
): T {
  const wrapped = {} as T;

  for (const key in serviceClass) {
    const method = serviceClass[key];
    if (typeof method === 'function') {
      wrapped[key] = withErrorHandling(
        method,
        contextPrefix ? `${contextPrefix}.${key}` : key
      ) as T[Extract<keyof T, string>];
    } else {
      wrapped[key] = method;
    }
  }

  return wrapped;
}

/**
 * Creates a typed error thrower for service methods
 * Use this to throw typed errors from service methods
 */
export function createServiceErrorThrower(_context: string) {
  return {
    network: (message?: string, originalError?: Error) => {
      throw new NetworkError(message, originalError);
    },
    validation: (message: string, field?: string, value?: unknown) => {
      throw new ValidationError(message, field, value);
    },
    auth: (message?: string) => {
      throw new AuthError(message);
    },
    notFound: (resource?: string) => {
      throw new NotFoundError(resource);
    },
    conflict: (message?: string) => {
      throw new ConflictError(message);
    },
    generic: (message: string) => {
      throw new AppError(message, 'SERVICE_ERROR', 500);
    },
  };
}

/**
 * Type guard to check if a result is an error result
 */
export function isServiceError<T>(result: ServiceResult<T>): result is ServiceResult<never> {
  return !result.success;
}

/**
 * Extract data from a service result, throwing if error
 * Useful when you want to handle errors at a higher level
 */
export function unwrapServiceResult<T>(result: ServiceResult<T>): T {
  if (isServiceError(result)) {
    throw new Error(result.error || 'Service operation failed');
  }
  return result.data as T;
}
