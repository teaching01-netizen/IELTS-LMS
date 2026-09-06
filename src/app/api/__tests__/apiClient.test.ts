import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiClient, apiRequest } from '../apiClient';
import { ApiError } from '../../../shared/api-client/errors';

const originalFetch = global.fetch;

function jsonError(status: number, message: string) {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: 'UNAUTHORIZED', message },
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('apiClient', () => {
  afterEach(() => {
    apiClient.setUnauthorizedHandler(null);
    apiClient.clearCsrfToken();
    document.cookie = 'csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    document.cookie = '__Host-csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('invokes the unauthorized handler and rejects with a 401 error', async () => {
    const handler = vi.fn();
    apiClient.setUnauthorizedHandler(handler);

    const fetchMock = vi.fn(async () => jsonError(401, 'Unauthorized'));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(apiClient.get('/v1/auth/session', { retries: 0 })).rejects.toMatchObject({
      statusCode: 401,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('rejects with ApiError carrying code, details, and request id', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        success: false,
        error: { code: 'CONFLICT', message: 'Conflict', details: { reason: 'ATTEMPT_SUBMITTED' } },
        metadata: { requestId: 'req-test', timestamp: '2026-01-01T00:00:00.000Z' },
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    const failure = await apiClient.get('/v1/example', { retries: 0 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 409,
      statusCode: 409,
      code: 'CONFLICT',
      backendCode: 'CONFLICT',
      category: 'conflict',
    });
    expect((failure as ApiError).details).toEqual({ reason: 'ATTEMPT_SUBMITTED' });
    expect((failure as ApiError).requestId).toBe('req-test');
  });

  it('clears the timeout and detaches the external abort listener per attempt', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { ok: true } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;
    const timeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((handler: (...args: unknown[]) => void) => {
        handler();
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);

    try {
      await apiClient.get('/v1/example', { retries: 0, signal: controller.signal });
    } finally {
      timeoutSpy.mockRestore();
      abortSpy.mockRestore();
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('prefers the live csrf cookie over a stale default x-csrf-token header on mutations', async () => {
    // Simulates a rotated session: the in-memory default header still holds
    // the previous session's token while the csrf cookie carries the current
    // session's value. The request must send the cookie token or the backend
    // rejects it with 403 CSRF_REJECTED.
    apiClient.setCsrfToken('stale-session-token');
    document.cookie = 'csrf=live-cookie-token; path=/';
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    await apiClient.patch('/v1/exams/exam-1/draft', {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('live-cookie-token');
  });

  it('lets a per-request csrf token win over the csrf cookie', async () => {
    document.cookie = 'csrf=cookie-token; path=/';
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    await apiClient.post('/v1/example', {}, { csrf: 'attempt-token' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('attempt-token');
  });

  it('falls back to the default header when no csrf cookie is readable', async () => {
    apiClient.setCsrfToken('default-session-token');
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    await apiClient.put('/v1/example', {});

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('default-session-token');
  });

  it('routes apiRequest through the canonical path with per-call auth', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { ok: true } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    global.fetch = fetchMock as unknown as typeof fetch;

    await apiRequest('/api/v2/student/attempts/a1/responses', { token: 'attempt-token' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v2/student/attempts/a1/responses');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer attempt-token');
  });
});

