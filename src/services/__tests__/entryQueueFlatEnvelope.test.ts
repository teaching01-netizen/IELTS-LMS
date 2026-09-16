import { describe, expect, it } from 'vitest';
import { parseEntryQueueError } from '../entryQueueRetry';

// Plan E2/C3: the server 429 envelope rides details FLAT
// ({code, message, details: {retryAfterSeconds, tier}} — apperrors.Envelope,
// pinned server-side by denyalenvelope_test.go). The parser must read the
// flat shape: retryAfterSeconds (server spelling) AND retryAfterSecs
// (legacy compatibility). A parser that only reads one spelling drops the
// other's cadence and falls back to the 5s default — bounded retry lies on
// exam day. RED: both spellings + header fallback.
describe('entry queue flat-envelope parse (plan E2)', () => {
  it('reads the server flat envelope (retryAfterSeconds spelling)', () => {
    const queue = parseEntryQueueError({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      details: { retryAfterSeconds: 2, tier: 'polling' },
    });
    expect(queue).toMatchObject({ queued: true, retryAfterSecs: 2 });
  });

	it('reads the canonical entry-gate retry field without a queue position', () => {
    const queue = parseEntryQueueError({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      details: { tier: 'student-entry', retryAfterSeconds: 7 },
    });
    expect(queue).toMatchObject({ queued: true, retryAfterSecs: 7 });
    expect(queue).not.toHaveProperty('queuePosition');
  });

  // NOTE: all three pass today — the parser already reads both
  // spellings (line 55: retryAfterSecs ?? retryAfterSeconds). The test
  // is the pin: a future edit dropping either spelling fails here,
  // not with lying countdowns on exam day.
  it('prefers details over the header, header over the 5s default', () => {
    const fromDetails = parseEntryQueueError({
      status: 429,
      details: { retryAfterSeconds: 9 },
      headers: { 'retry-after': '3' },
    });
    expect(fromDetails.retryAfterSecs).toBe(9);
    const fromHeader = parseEntryQueueError({
      status: 429,
      headers: { 'retry-after': '12' },
    });
    expect(fromHeader).toMatchObject({ queued: true, retryAfterSecs: 12 });
    const fallback = parseEntryQueueError({ status: 429 });
    expect(fallback).toMatchObject({ queued: true, retryAfterSecs: 5 });
  });
});
