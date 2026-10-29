import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../apiClient';

const originalFetch = global.fetch;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => {
  apiClient.setUnauthorizedHandler(null);
  apiClient.setAuthGenerationReader(null);
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('apiClient auth generation fence', () => {
  it('discards a completed 200 dispatched for a previous actor', async () => {
    let generation = 1;
    apiClient.setAuthGenerationReader(() => generation);
    global.fetch = vi.fn(async () => {
      generation = 2;
      return json(200, { private: 'previous actor' });
    }) as unknown as typeof fetch;

    await expect(apiClient.get('/v1/admin/exams', { retries: 0 })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not report a late 401 from a previous actor', async () => {
    let generation = 1;
    apiClient.setAuthGenerationReader(() => generation);
    const handler = vi.fn();
    apiClient.setUnauthorizedHandler(handler);
    global.fetch = vi.fn(async () => {
      generation = 2;
      return json(401, { code: 'UNAUTHORIZED', message: 'no' });
    }) as unknown as typeof fetch;

    await expect(apiClient.get('/v1/admin/exams', { retries: 0 })).rejects.toMatchObject({ name: 'AbortError' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not retry across a generation change', async () => {
    let generation = 1;
    apiClient.setAuthGenerationReader(() => generation);
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      generation = 2;
      return json(503, { code: 'SERVICE_UNAVAILABLE', message: 'down' });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const pending = apiClient.get('/v1/admin/exams', { retries: 3 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('passes the parsed error and captured generation to the unauthorized handler', async () => {
    apiClient.setAuthGenerationReader(() => 7);
    const handler = vi.fn();
    apiClient.setUnauthorizedHandler(handler);
    global.fetch = vi.fn(async () => json(401, { code: 'SESSION_EXPIRED', message: 'gone' })) as unknown as typeof fetch;

    await expect(apiClient.get('/v1/admin/exams', { retries: 0 })).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/v1/admin/exams',
        method: 'GET',
        generation: 7,
        bearer: false,
        error: expect.objectContaining({ code: 'SESSION_EXPIRED', status: 401 }),
      }),
    );
  });

  it('folds an HTTP-date Retry-After into retryAfterSeconds', async () => {
    const at = new Date(Date.now() + 45_000).toUTCString();
    global.fetch = vi.fn(async () =>
      json(503, { code: 'SERVICE_UNAVAILABLE', message: 'down' }, { 'Retry-After': at }),
    ) as unknown as typeof fetch;

    const error = await apiClient.post('/v1/auth/logout').catch((caught: unknown) => caught);
    const seconds = (error as { details?: { retryAfterSeconds?: number } }).details?.retryAfterSeconds;
    expect(seconds).toBeGreaterThanOrEqual(43);
    expect(seconds).toBeLessThanOrEqual(45);
  });
});
