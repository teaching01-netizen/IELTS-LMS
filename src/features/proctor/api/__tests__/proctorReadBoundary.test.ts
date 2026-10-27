import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProctorSessionDetail, fetchProctorSessionSummaries } from '../proctorQueries';

/** The changed monitoring reads, through the real transport and envelope handling. */
const originalFetch = global.fetch;

function failure(status: number, code: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ success: false, error: { code, message: `${code} from server` } }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
});

describe('proctor monitoring read boundary', () => {
  it.each([
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ])('keeps a %i as a typed failure, never an empty room', async (status, code) => {
    global.fetch = vi.fn(async () => failure(status, code)) as typeof fetch;
    await expect(fetchProctorSessionDetail('sched-1')).rejects.toMatchObject({ status, code });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('carries Retry-After on a 429 and does not tight-retry it', async () => {
    global.fetch = vi.fn(async () => failure(429, 'RATE_LIMITED', { 'Retry-After': '7' })) as typeof fetch;
    const error = await fetchProctorSessionSummaries('sat').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 429 });
    expect(JSON.stringify((error as { details?: unknown }).details)).toContain('7');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a canceled read without retrying it', async () => {
    const controller = new AbortController();
    global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    ) as typeof fetch;
    const read = fetchProctorSessionDetail('sched-1', controller.signal);
    controller.abort();
    const error = await read.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    // A cancellation is not a connection failure and is never retried.
    expect((error as { code?: string }).code).not.toBe('NETWORK_ERROR');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure as a connection error after bounded retries', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const read = fetchProctorSessionSummaries().catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();
    const error = await read;
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(vi.mocked(global.fetch).mock.calls.length).toBeLessThanOrEqual(4);
  });
});
