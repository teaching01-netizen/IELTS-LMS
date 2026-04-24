/**
 * API Client Abstraction
 * Centralized HTTP communication with interceptors, error handling, and retry logic
 */

import { AuthError, NetworkError, ServiceUnavailableError } from '../error/errorTypes';
import { logError, logInfo, logWarn } from '../error/errorLogger';

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly backendCode: string | undefined;
  public readonly backendDetails: Record<string, unknown> | undefined;
  public readonly backendRequestId: string | undefined;

  constructor(args: {
    message: string;
    statusCode: number;
    backendCode: string | undefined;
    backendDetails: Record<string, unknown> | undefined;
    backendRequestId: string | undefined;
  }) {
    super(args.message);
    this.name = 'ApiClientError';
    this.statusCode = args.statusCode;
    this.backendCode = args.backendCode;
    this.backendDetails = args.backendDetails;
    this.backendRequestId = args.backendRequestId;
  }
}

export interface ApiRequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
  signal?: AbortSignal;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T | undefined;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown> | undefined;
  };
  metadata?: {
    timestamp: string;
    requestId?: string | undefined;
  };
}

type StatusError = Error & { statusCode?: number };

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const prefix = `${name}=`;
  const match = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));

  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function getCsrfCookieToken(): string | null {
  const configuredName = import.meta.env['VITE_AUTH_CSRF_COOKIE_NAME'];
  const cookieNames = [
    typeof configuredName === 'string' ? configuredName : null,
    '__Host-csrf',
    'csrf',
  ].filter((value): value is string => Boolean(value));

  for (const cookieName of cookieNames) {
    const token = readCookie(cookieName);
    if (token) {
      return token;
    }
  }

  return null;
}

class ApiClient {
  private baseURL: string;
  private defaultHeaders: Record<string, string>;
  private defaultTimeout: number;
  private unauthorizedHandler: ((context: { endpoint: string; method: string; requestId: string }) => void | Promise<void>) | null;

  constructor(baseURL: string = '/api', defaultTimeout: number = 30000) {
    this.baseURL = baseURL;
    this.defaultTimeout = defaultTimeout;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
    this.unauthorizedHandler = null;
  }

  /**
   * Register a global handler for 401 Unauthorized responses.
   * Useful to immediately clear local auth/session state and redirect to /login.
   */
  setUnauthorizedHandler(
    handler: ((context: { endpoint: string; method: string; requestId: string }) => void | Promise<void>) | null,
  ): void {
    this.unauthorizedHandler = handler;
  }

  /**
   * Set default headers for all requests
   */
  setDefaultHeaders(headers: Record<string, string>): void {
    this.defaultHeaders = { ...this.defaultHeaders, ...headers };
  }

  /**
   * Set CSRF token header for cookie-authenticated mutations.
   */
  setCsrfToken(token: string): void {
    this.defaultHeaders = {
      ...this.defaultHeaders,
      'x-csrf-token': token,
    };
  }

  /**
   * Clear CSRF token header.
   */
  clearCsrfToken(): void {
    const { 'x-csrf-token': _csrf, ...rest } = this.defaultHeaders;
    this.defaultHeaders = rest;
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string): void {
    this.defaultHeaders = {
      ...this.defaultHeaders,
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Clear authentication token
   */
  clearAuthToken(): void {
    const { Authorization: _authorization, ...rest } = this.defaultHeaders;
    this.defaultHeaders = rest;
  }

  /**
   * Make an HTTP request with retry logic
   */
  private async request<T>(
    endpoint: string,
    config: ApiRequestConfig = {}
  ): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      headers = {},
      body,
      timeout = this.defaultTimeout,
      retries = 3,
      signal,
    } = config;

    const url = `${this.baseURL}${endpoint}`;
    const requestId = this.generateRequestId();

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        // Combine external signal with timeout signal
        if (signal) {
          signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        const requestHeaders = { ...this.defaultHeaders, ...headers };
        if (
          method !== 'GET' &&
          requestHeaders['x-csrf-token'] === undefined
        ) {
          const cookieToken = getCsrfCookieToken();
          if (cookieToken) {
            requestHeaders['x-csrf-token'] = cookieToken;
          }
        }

        const requestInit: RequestInit = {
          method,
          credentials: 'same-origin',
          headers: requestHeaders,
          signal: controller.signal,
        };

        if (body !== undefined) {
          requestInit.body = JSON.stringify(body);
        }

        let response: Response;
        try {
          response = await fetch(url, requestInit);
        } catch (fetchError) {
          // Some test environments ship an AbortController/AbortSignal implementation that is
          // incompatible with the fetch implementation (e.g. jsdom + undici), causing fetch() to
          // throw synchronously when `signal` is provided. Fall back to a no-signal request.
          if (
            fetchError instanceof TypeError &&
            typeof fetchError.message === 'string' &&
            fetchError.message.includes('Expected signal')
          ) {
            const { signal: _signal, ...withoutSignal } = requestInit;
            response = await fetch(url, withoutSignal);
          } else {
            throw fetchError;
          }
        }

        clearTimeout(timeoutId);

        // Log request
        logInfo(`API ${method} ${endpoint}`, {
          requestId,
          attempt: attempt + 1,
          status: response.status,
        });

        if (!response.ok) {
          if (response.status === 401 && this.unauthorizedHandler) {
            try {
              await this.unauthorizedHandler({ endpoint, method, requestId });
            } catch (handlerError) {
              logError(
                handlerError instanceof Error
                  ? handlerError
                  : new Error('Unauthorized handler failed'),
                { scope: 'apiClient.unauthorizedHandler' },
              );
            }
          }

          const errorData = await this.parseErrorResponse(response);
          throw this.createErrorFromResponse(response, errorData);
        }

        const data = await this.parseResponseBody<T>(response);
        
        const apiResponse: ApiResponse<T> = {
          success: true,
          metadata: {
            timestamp: new Date().toISOString(),
            requestId,
          },
        };

        if (data !== undefined) {
          apiResponse.data = data;
        }

        return apiResponse;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on abort or certain status codes
        if (error instanceof Error && error.name === 'AbortError') {
          break;
        }

        if (error instanceof Error && this.shouldNotRetry(error)) {
          break;
        }

        // Log retry
        if (attempt < retries) {
          const delay = this.calculateRetryDelay(attempt);
          logWarn(`Retrying request ${attempt + 1}/${retries} after ${delay}ms`, {
            endpoint,
            requestId,
          });
          await this.delay(delay);
        }
      }
    }

    // All retries failed
    const statusCode = this.getStatusCode(lastError || new Error('Request failed'));
    // Log 401 as warning since it's expected for unauthenticated requests
    if (statusCode === 401) {
      logWarn('Request failed with 401 Unauthorized', {
        endpoint,
        requestId,
        attempts: retries + 1,
      });
    } else if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      logWarn(lastError?.message ?? 'Request failed', {
        endpoint,
        requestId,
        attempts: retries + 1,
        error: lastError?.message,
      });
    } else {
      logError(lastError || new Error('Request failed after retries'), {
        endpoint,
        requestId,
        attempts: retries + 1,
      });
    }

    if (lastError) {
      throw lastError;
    }

    throw new NetworkError('Request failed');
  }

  /**
   * Parse a successful response body.
   * 204/205 or empty responses resolve to undefined instead of throwing.
   */
  private async parseResponseBody<T>(response: Response): Promise<T | undefined> {
    if (response.status === 204 || response.status === 205) {
      return undefined;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength === '0') {
      return undefined;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return undefined;
    }

    return (await response.json()) as T;
  }

  /**
   * Parse error response from server
   */
  private async parseErrorResponse(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return { message: response.statusText };
    }
  }

  /**
   * Create typed error from HTTP response
   */
  private createErrorFromResponse(response: Response, errorData: unknown): Error {
    const status = response.status;
    const parsed = this.extractBackendErrorEnvelope(errorData);
    const message = parsed.message ?? this.extractErrorMessage(errorData, response.statusText);

    if (status === 401) {
      return new AuthError(message);
    }

    if (status === 503) {
      return new ServiceUnavailableError(message);
    }

    if (status >= 500) {
      return new NetworkError(message);
    }

    return new ApiClientError({
      message,
      statusCode: status,
      backendCode: parsed.code,
      backendDetails: parsed.details,
      backendRequestId: parsed.requestId,
    });
  }

  private extractErrorMessage(errorData: unknown, fallback: string): string {
    if (!errorData || typeof errorData !== 'object') {
      return fallback;
    }

    if ('message' in errorData) {
      const value = (errorData as { message?: unknown }).message;
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }

    if ('error' in errorData) {
      const nested = (errorData as { error?: unknown }).error;
      if (nested && typeof nested === 'object' && 'message' in nested) {
        const value = (nested as { message?: unknown }).message;
        if (typeof value === 'string' && value.trim().length > 0) {
          return value;
        }
      }
    }

    return fallback;
  }

  private extractBackendErrorEnvelope(errorData: unknown): {
    code: string | undefined;
    message: string | undefined;
    details: Record<string, unknown> | undefined;
    requestId: string | undefined;
  } {
    if (!errorData || typeof errorData !== 'object') {
      return { code: undefined, message: undefined, details: undefined, requestId: undefined };
    }

    const root = errorData as {
      error?: unknown;
      metadata?: unknown;
    };

    const error = root.error;
    const metadata = root.metadata;

    const code =
      error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? ((error as { code: string }).code as string)
        : undefined;

    const message =
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
        ? ((error as { message: string }).message as string)
        : undefined;

    const detailsRaw =
      error && typeof error === 'object' && 'details' in error ? (error as { details?: unknown }).details : undefined;
    const details =
      detailsRaw && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw)
        ? (detailsRaw as Record<string, unknown>)
        : undefined;

    const requestId =
      metadata &&
      typeof metadata === 'object' &&
      'requestId' in metadata &&
      typeof (metadata as { requestId?: unknown }).requestId === 'string'
        ? ((metadata as { requestId: string }).requestId as string)
        : undefined;

    return { code, message, details, requestId };
  }

  /**
   * Determine if error should not be retried
   */
  private shouldNotRetry(error: Error): boolean {
    const statusCode = this.getStatusCode(error);

    // Don't retry on client errors (4xx)
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return true;
    }

    // Don't retry on abort
    if (error.name === 'AbortError') {
      return true;
    }

    return false;
  }

  private withStatusCode(error: Error, statusCode: number): StatusError {
    const typedError = error as StatusError;
    typedError.statusCode = statusCode;
    return typedError;
  }

  private getStatusCode(error: Error): number | undefined {
    return (error as StatusError).statusCode;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateRetryDelay(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, 30000);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'POST', body });
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'PUT', body });
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'PATCH', body });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'DELETE' });
  }
}

// Singleton instance
export const apiClient = new ApiClient();

/**
 * Convenience function for GET requests
 */
export async function get<T>(endpoint: string, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
  return apiClient.get<T>(endpoint, config);
}

/**
 * Convenience function for POST requests
 */
export async function post<T>(endpoint: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
  return apiClient.post<T>(endpoint, body, config);
}

/**
 * Convenience function for PUT requests
 */
export async function put<T>(endpoint: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
  return apiClient.put<T>(endpoint, body, config);
}

/**
 * Convenience function for PATCH requests
 */
export async function patch<T>(endpoint: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
  return apiClient.patch<T>(endpoint, body, config);
}

/**
 * Convenience function for DELETE requests
 */
export async function del<T>(endpoint: string, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
  return apiClient.delete<T>(endpoint, config);
}
