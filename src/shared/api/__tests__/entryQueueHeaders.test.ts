import { describe, expect, it } from 'vitest';
import { apiClient } from '../apiClient';

// Plan C3/D3: the 429 Retry-After header must survive into ApiError.details
// so the entry queue countdown auto-retries at the server's cadence.
describe('entry queue Retry-After surfacing', () => {
  it('copies the Retry-After header into error details on 429', async () => {
    const body = JSON.stringify({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Check-in is queued; please retry.' },
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () =>
      new Response(body, {
        status: 429,
        headers: { 'content-type': 'application/json', 'Retry-After': '7' },
      })) as typeof fetch;
    try {
      await (apiClient as unknown as { post: (u: string, b: unknown) => Promise<unknown> }).post(
        'http://test.invalid/v1/auth/student/entry',
        {},
      );
      expect.unreachable('entry post should reject on 429');
    } catch (error) {
      const details =
        (error as { details?: Record<string, unknown> }).details ??
        (error as { backendDetails?: Record<string, unknown> }).backendDetails ??
        {};
      expect(details['retryAfterSecs']).toBe(7);
      expect(details['tier']).toBe('student-entry');
    }
  });
});
