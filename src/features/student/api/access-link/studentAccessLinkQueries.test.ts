import { describe, expect, it } from 'vitest';
import {
  accessLinkRetryDelayMs,
  retryAccessLinkWhileQueued,
} from './studentAccessLinkQueries';

describe('access-link query retry policy', () => {
  const rateLimited = { status: 429, details: { retryAfterSeconds: 4 } };

  it('retries a 429 at the Retry-After floor, a bounded number of times', () => {
    expect(retryAccessLinkWhileQueued(0, rateLimited)).toBe(true);
    expect(retryAccessLinkWhileQueued(4, rateLimited)).toBe(true);
    expect(retryAccessLinkWhileQueued(5, rateLimited)).toBe(false);
    const delay = accessLinkRetryDelayMs(1, rateLimited);
    expect(delay).toBeGreaterThanOrEqual(4000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it('surfaces other errors immediately', () => {
    expect(retryAccessLinkWhileQueued(0, { status: 404 })).toBe(false);
    expect(retryAccessLinkWhileQueued(0, new Error('network'))).toBe(false);
  });
});
