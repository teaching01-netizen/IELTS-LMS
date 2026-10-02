/**
 * API Client Abstraction
 * Centralized HTTP communication with interceptors, error handling, and retry logic
 */

import { ApiError } from "../api-client/errors";
import { connectionRecovery } from "./connectionRecovery";
import { logError, logInfo, logWarn } from "../observability/errorLogger";

/**
 * @deprecated Use {@link ApiError} from "../api-client/errors" instead.
 * Kept as a subclass alias so existing `instanceof ApiClientError` guards keep
 * matching errors thrown by this client.
 */
export class ApiClientError extends ApiError {
  constructor(args: {
    message: string;
    statusCode: number;
    backendCode?: string | undefined;
    backendDetails?: Record<string, unknown> | undefined;
    backendRequestId?: string | undefined;
  }) {
    super({
      code: args.backendCode ?? "UNKNOWN",
      message: args.message,
      status: args.statusCode,
      details: args.backendDetails,
      requestId: args.backendRequestId,
    });
    this.name = "ApiClientError";
  }
}

export interface ApiRequestConfig {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
  /** Writes may retry only with an existing backend idempotency guarantee.
   * The caller must create the operation identifier before this request. */
  retrySafe?: boolean;
  signal?: AbortSignal;
  skipUnauthorizedHandler?: boolean;
  /**
   * Per-request bearer token. Merged as an `Authorization` header without
   * mutating the client's default headers.
   */
  token?: string;
  /**
   * Per-request CSRF token. Takes precedence over the cookie-derived token
   * and any configured `x-csrf-token` default header.
   */
  csrf?: string;
  /**
   * Statuses this caller handles as data rather than as a failure.
   *
   * Some answers are states: "this exam has no editable draft yet" is a 404 the
   * surface renders as a first-class screen, not an outage. The ApiError still
   * reaches the caller and the attempt is still logged, but the client does not
   * add a failure warning for a status the caller asked for — otherwise a
   * normal state reads in the console as a broken app.
   */
  expectedStatuses?: number[];
}

/** Request options accepted by the legacy `apiRequest` wrapper. */
export interface RequestOpts {
  method?: string;
  token?: string;
  csrf?: string;
  body?: unknown;
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
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));

  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function getCsrfCookieToken(): string | null {
  const configuredName = import.meta.env["VITE_AUTH_CSRF_COOKIE_NAME"];
  const cookieNames = [
    typeof configuredName === "string" ? configuredName : null,
    "__Host-csrf",
    "csrf",
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
  private unauthorizedHandler:
    | ((context: { endpoint: string; method: string; requestId: string }) => void | Promise<void>)
    | null;

  constructor(baseURL: string = "/api", defaultTimeout: number = 30000) {
    this.baseURL = baseURL;
    this.defaultTimeout = defaultTimeout;
    this.defaultHeaders = {
      "Content-Type": "application/json",
    };
    this.unauthorizedHandler = null;
  }

  /**
   * Register a global handler for 401 Unauthorized responses.
   * Useful to immediately clear local auth/session state and redirect to /login.
   */
  setUnauthorizedHandler(
    handler:
      | ((context: { endpoint: string; method: string; requestId: string }) => void | Promise<void>)
      | null
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
      "x-csrf-token": token,
    };
  }

  /**
   * Clear CSRF token header.
   */
  clearCsrfToken(): void {
    const { "x-csrf-token": _csrf, ...rest } = this.defaultHeaders;
    this.defaultHeaders = rest;
  }

  /**
   * Return the current CSRF token for raw same-origin requests that cannot use
   * the JSON request path (for example, a binary media upload).
   */
  getCsrfToken(): string | null {
    return getCsrfCookieToken() ?? this.defaultHeaders["x-csrf-token"] ?? null;
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
   * Make an HTTP request with retry logic.
   * Public for the `apiRequest` adapter; prefer the typed verb helpers.
   */
  async request<T>(endpoint: string, config: ApiRequestConfig = {}): Promise<ApiResponse<T>> {
    const {
      method = "GET",
      headers = {},
      body,
      timeout = this.defaultTimeout,
      retries: requestedRetries = 3,
      signal,
      skipUnauthorizedHandler = false,
    } = config;

    const url = endpoint.startsWith("/api/") ? endpoint : `${this.baseURL}${endpoint}`;
    const requestId = this.generateRequestId();

    const retries =
      method === "GET" || config.retrySafe === true
        ? Math.min(3, Math.max(0, Math.floor(requestedRetries)))
        : 0;
    const deadline = Date.now() + 60_000;
    const serializedBody =
      body === undefined
        ? undefined
        : typeof FormData !== "undefined" && body instanceof FormData
          ? body
          : JSON.stringify(body);
    let recovering = false;
    let transient = false;
    let lastError: Error | null = null;
    let completedAttempts = 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) {
        lastError = new DOMException("Request cancelled", "AbortError");
        transient = false;
        break;
      }
      const controller = new AbortController();
      let timedOut = false;
      const remaining = Math.max(1, deadline - Date.now());
      const timeoutId = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.min(timeout, remaining)
      );
      // Named handler so the external-signal subscription can be removed in
      // `finally`: an anonymous `{ once: true }` listener is never removed on
      // the non-abort path and leaks a closure per attempt on reused signals.
      const forwardExternalAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener("abort", forwardExternalAbort, { once: true });
        }
      }

      try {
        const requestHeaders: Record<string, string> = { ...this.defaultHeaders, ...headers };
        if (config.token) {
          requestHeaders["Authorization"] = `Bearer ${config.token}`;
        }
        // Double-submit CSRF: the per-session csrf cookie is the live,
        // authoritative value for cookie-authenticated mutations, so prefer
        // it over the default `x-csrf-token` header whenever it is readable.
        // The default header is only refreshed when a login/session payload
        // carries a csrfToken; after the session rotates (a new login in
        // another tab, backend session re-issue, backend cutover) it can hold
        // a stale token, and then every mutation is rejected with 403
        // CSRF_REJECTED even though the session cookie is valid. An explicit
        // per-request `csrf` still wins (flows whose token never rides a
        // cookie). When no cookie is readable the default header is kept as a
        // fallback.
        const isStateChangingMethod = method !== "GET";
        if (config.csrf) {
          requestHeaders["x-csrf-token"] = config.csrf;
        } else if (isStateChangingMethod) {
          const cookieToken = getCsrfCookieToken();
          if (cookieToken) {
            requestHeaders["x-csrf-token"] = cookieToken;
          }
        }
        const isFormDataBody = typeof FormData !== "undefined" && body instanceof FormData;
        if (isFormDataBody) {
          for (const key of Object.keys(requestHeaders)) {
            if (key.toLowerCase() === "content-type") delete requestHeaders[key];
          }
        }

        const requestInit: RequestInit = {
          method,
          credentials: "same-origin",
          headers: requestHeaders,
          signal: controller.signal,
        };

        if (serializedBody !== undefined) {
          requestInit.body = serializedBody;
        }

        const response = await fetch(url, requestInit);

        // Timeout always cleared exactly once, on every path (success,
        // HTTP error, thrown fetch, abort) via the finally below.

        // Log request
        logInfo(`API ${method} ${endpoint}`, {
          requestId,
          attempt: attempt + 1,
          status: response.status,
        });

        if (!response.ok) {
          if (response.status === 401 && this.unauthorizedHandler && !skipUnauthorizedHandler) {
            try {
              await this.unauthorizedHandler({ endpoint, method, requestId });
            } catch (handlerError) {
              logError(
                handlerError instanceof Error
                  ? handlerError
                  : new Error("Unauthorized handler failed"),
                { scope: "apiClient.unauthorizedHandler" }
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

        if (method === "GET") connectionRecovery.finish(requestId, endpoint, false);
        return apiResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Request failed");
        const cancelled = signal?.aborted || (lastError.name === "AbortError" && !timedOut);
        if (!cancelled && (timedOut || lastError instanceof TypeError)) {
          lastError = new ApiClientError({
            message: timedOut ? "Connection timed out." : "Unable to connect.",
            statusCode: 0,
            backendCode: "NETWORK_ERROR",
          });
          (lastError as ApiError).category = "network";
        }
        transient = !cancelled && !this.shouldNotRetry(lastError);
        if (!transient || attempt >= retries || Date.now() >= deadline) break;
      } finally {
        completedAttempts += 1;
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", forwardExternalAbort);
      }
      const delay = this.calculateRetryDelay(attempt);
      if (Date.now() + delay >= deadline) break;
      if (method === "GET") {
        connectionRecovery.begin(requestId, endpoint);
        recovering = true;
      }
      logWarn(`Retrying request ${attempt + 1}/${retries} after ${delay}ms`, {
        endpoint,
        requestId,
      });
      try {
        await this.delay(delay, signal);
      } catch (error) {
        lastError = error as Error;
        transient = false;
        break;
      }
    }
    if (lastError instanceof ApiError) {
      lastError.transportRetryHandled = true;
      lastError.requestMethod = method;
    }
    if (method === "GET" && (recovering || retries > 0)) {
      connectionRecovery.finish(requestId, endpoint, transient);
    }

    // All retries failed
    const statusCode = ApiClient.getStatusCode(lastError || new Error("Request failed"));
    // A status the caller named up front is an answer, not a failure: the
    // classified ApiError below is still thrown, it just does not warn.
    const expectedByCaller =
      statusCode !== undefined && (config.expectedStatuses?.includes(statusCode) ?? false);
    if (!expectedByCaller) {
      // Log 401 as warning since it's expected for unauthenticated requests
      if (statusCode === 401) {
        logWarn("Request failed with 401 Unauthorized", {
          endpoint,
          requestId,
          attempts: completedAttempts,
        });
      } else if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
        logWarn(lastError?.message ?? "Request failed", {
          endpoint,
          requestId,
          attempts: completedAttempts,
          error: lastError?.message,
        });
      } else {
        logError(lastError || new Error("Request failed after retries"), {
          endpoint,
          requestId,
          attempts: completedAttempts,
        });
      }
    }

    if (lastError) {
      throw lastError;
    }

    // Unreachable: the loop always sets lastError before falling through,
    // but keep a typed network error for exhaustiveness.
    const networkError = new ApiError({
      code: "NETWORK_ERROR",
      message: "Request failed",
      status: 0,
    });
    networkError.category = "network";
    throw networkError;
  }

  /**
   * Parse a successful response body.
   * 204/205 or empty responses resolve to undefined instead of throwing.
   */
  private async parseResponseBody<T>(response: Response): Promise<T | undefined> {
    if (response.status === 204 || response.status === 205) {
      return undefined;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength === "0") {
      return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      if (!text) {
        return undefined;
      }
      throw new ApiError({
        code: "UNEXPECTED_CONTENT_TYPE",
        message: `Expected a JSON response but received ${contentType || "an unknown content type"}.`,
        status: response.status,
      });
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
    const headerRequestId =
      response.headers.get("X-Request-Id") ?? response.headers.get("x-request-id") ?? undefined;
    // Plan C3/D3: the entry gate speaks 429 + Retry-After +
    // {retryAfterSeconds}. Some 429s carry no JSON details, so the header is
    // folded into details — without it bounded retry has no cadence and
    // clients tight-retry the storm the gate absorbed. Header wins only when
    // details lack either the canonical or legacy field.
    let details = parsed.details;
    if (status === 429) {
      const headerRetry =
        response.headers.get("Retry-After") ?? response.headers.get("retry-after");
      const retrySecs = headerRetry !== null ? Number(headerRetry) : NaN;
      if (Number.isFinite(retrySecs) && retrySecs > 0) {
        const merged: Record<string, unknown> = { ...(details ?? {}) };
        if (merged["retryAfterSeconds"] === undefined && merged["retryAfterSecs"] === undefined) {
          merged["retryAfterSeconds"] = Math.floor(retrySecs);
        }
        details = merged;
      }
    }

    return new ApiClientError({
      message,
      statusCode: status,
      backendCode: parsed.code ?? "UNKNOWN",
      backendDetails: details,
      backendRequestId: parsed.requestId ?? headerRequestId,
    });
  }

  private extractErrorMessage(errorData: unknown, fallback: string): string {
    if (!errorData || typeof errorData !== "object") {
      return fallback;
    }

    if ("message" in errorData) {
      const value = (errorData as { message?: unknown }).message;
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }

    if ("error" in errorData) {
      const nested = (errorData as { error?: unknown }).error;
      if (nested && typeof nested === "object" && "message" in nested) {
        const value = (nested as { message?: unknown }).message;
        if (typeof value === "string" && value.trim().length > 0) {
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
    if (!errorData || typeof errorData !== "object") {
      return { code: undefined, message: undefined, details: undefined, requestId: undefined };
    }

    const root = errorData as {
      error?: unknown;
      metadata?: unknown;
    };

    // Two wire shapes reach this client:
    //   legacy  {success:false, error:{code,message,details}, metadata:{requestId}}
    //   current {code, message, details, requestId}   (Go apperrors.Envelope)
    // The envelope fields are read from the nested `error` object when the
    // body has one, and from the root otherwise. Reading only the nested
    // shape turned every current-backend code into UNKNOWN and dropped
    // `details` — so no caller could tell CONTROL_EPOCH_STALE, LEASE_FENCED
    // or VERSION_COLLISION apart from a transient failure, and the durability
    // engine re-sent a stale control epoch in a loop during a live exam.
    const nested = root.error;
    const envelope: Record<string, unknown> =
      nested && typeof nested === "object" && !Array.isArray(nested)
        ? (nested as Record<string, unknown>)
        : (errorData as Record<string, unknown>);
    const metadata = root.metadata;

    const code = typeof envelope["code"] === "string" ? (envelope["code"] as string) : undefined;

    const message =
      typeof envelope["message"] === "string" ? (envelope["message"] as string) : undefined;

    const detailsRaw = envelope["details"];
    const details =
      detailsRaw && typeof detailsRaw === "object" && !Array.isArray(detailsRaw)
        ? (detailsRaw as Record<string, unknown>)
        : Array.isArray(detailsRaw)
          ? { items: detailsRaw }
          : undefined;

    const requestIdFromMetadata =
      metadata &&
      typeof metadata === "object" &&
      "requestId" in metadata &&
      typeof (metadata as { requestId?: unknown }).requestId === "string"
        ? ((metadata as { requestId: string }).requestId as string)
        : undefined;
    const requestIdFromEnvelope =
      typeof envelope["requestId"] === "string" ? (envelope["requestId"] as string) : undefined;
    const requestId = requestIdFromMetadata ?? requestIdFromEnvelope;

    return { code, message, details, requestId };
  }

  /**
   * Determine if error should not be retried
   */
  private shouldNotRetry(error: Error): boolean {
    const statusCode = ApiClient.getStatusCode(error);

    return (
      error.name === "AbortError" ||
      !(statusCode === 0 || statusCode === 502 || statusCode === 503 || statusCode === 504)
    );
  }

  private static getStatusCode(error: Error): number | undefined {
    if (error instanceof ApiError) {
      return error.status;
    }
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
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(new DOMException("Request cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, ms);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
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
    return this.request<T>(endpoint, { ...config, method: "GET" });
  }

  /**
   * POST request
   */
  async post<T>(
    endpoint: string,
    body?: unknown,
    config?: ApiRequestConfig
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: "POST", body });
  }

  /**
   * PUT request
   */
  async put<T>(
    endpoint: string,
    body?: unknown,
    config?: ApiRequestConfig
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: "PUT", body });
  }

  /**
   * PATCH request
   */
  async patch<T>(
    endpoint: string,
    body?: unknown,
    config?: ApiRequestConfig
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: "PATCH", body });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: "DELETE" });
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
export async function post<T>(
  endpoint: string,
  body?: unknown,
  config?: ApiRequestConfig
): Promise<ApiResponse<T>> {
  return apiClient.post<T>(endpoint, body, config);
}

/**
 * Convenience function for PUT requests
 */
export async function put<T>(
  endpoint: string,
  body?: unknown,
  config?: ApiRequestConfig
): Promise<ApiResponse<T>> {
  return apiClient.put<T>(endpoint, body, config);
}

/**
 * Convenience function for PATCH requests
 */
export async function patch<T>(
  endpoint: string,
  body?: unknown,
  config?: ApiRequestConfig
): Promise<ApiResponse<T>> {
  return apiClient.patch<T>(endpoint, body, config);
}

/**
 * Convenience function for DELETE requests
 */
export async function del<T>(endpoint: string, config?: ApiRequestConfig): Promise<ApiResponse<T>> {
  return apiClient.delete<T>(endpoint, config);
}

/**
 * Generated-client-shaped typed fetch wrapper (plan 99). Now a thin adapter
 * over the single canonical fetch path: per-call token/csrf/body ride
 * `ApiRequestConfig`, the baseURL/CSRF-cookie/retry/unauthorized semantics stay
 * in `ApiClient.request`, and errors are always `ApiError`.
 */
export async function apiRequest<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const config: ApiRequestConfig = {};
  const method = opts.method as ApiRequestConfig["method"] | undefined;
  if (method !== undefined) {
    config.method = method;
  }
  if (opts.token !== undefined) {
    config.token = opts.token;
  }
  if (opts.csrf !== undefined) {
    config.csrf = opts.csrf;
  }
  if (opts.body !== undefined) {
    config.body = opts.body;
  }
  const response = await apiClient.request<T>(path, config);
  return response.data as T;
}
