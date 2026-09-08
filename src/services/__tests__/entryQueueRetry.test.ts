import { describe, expect, it, vi } from 'vitest';
import { entryQueueDelayMs, parseEntryQueueError } from '../entryQueueRetry';

// Plan C3: entry 429-with-position renders a queue countdown and auto-retries
// at Retry-After (never tight-retries). Non-429 errors surface immediately.
describe('entry queue retry (plan C3)', () => {
  it('parses 429 envelope details into queue state', () => {
    const err = {
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      details: { tier: 'student-entry', retryAfterSecs: 7, queuePosition: 42 },
    };
    const queue = parseEntryQueueError(err);
    expect(queue).toMatchObject({ queued: true, retryAfterSecs: 7, queuePosition: 42 });
  });

  it('falls back to the Retry-After header when details are absent', () => {
    const queue = parseEntryQueueError({ status: 429, headers: { 'retry-after': '12' } });
    expect(queue).toMatchObject({ queued: true, retryAfterSecs: 12 });
  });

  it('ignores non-429 errors (immediate surface)', () => {
    expect(parseEntryQueueError({ status: 409 })).toMatchObject({ queued: false });
    expect(parseEntryQueueError(new Error('boom'))).toMatchObject({ queued: false });
  });

  it('clamps delay with jitter (never tight-retry, never unbounded)', () => {
    const delay = entryQueueDelayMs(0, () => 0.5);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(65_000);
    // retryAfterSecs=0 still waits the 1s floor (no tight loop).
    expect(entryQueueDelayMs(0, () => 0)).toBeGreaterThanOrEqual(1000);
  });

  it('honors server retryAfterSecs over the floor', () => {
    const delay = entryQueueDelayMs(30, () => 0);
    expect(delay).toBeGreaterThanOrEqual(30_000);
  });
});
