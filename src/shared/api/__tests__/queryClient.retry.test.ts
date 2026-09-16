import { describe, expect, it } from 'vitest';
import { shouldRetryMutation, shouldRetryQuery } from '../queryClient';

describe('shouldRetryQuery (rate-limit tiers)', () => {
  it('never retries 429-class errors', () => {
    expect(shouldRetryQuery(0, { status: 429 })).toBe(false);
    expect(shouldRetryQuery(0, { statusCode: 429 })).toBe(false);
    expect(shouldRetryQuery(2, { status: 429, code: 'RATE_LIMIT_EXCEEDED' })).toBe(false);
  });

  it('keeps default retries for other failures', () => {
    expect(shouldRetryQuery(0, { status: 500 })).toBe(true);
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(true);
    expect(shouldRetryQuery(3, { status: 500 })).toBe(false);
  });

  it('never retries mutations after a 429', () => {
    expect(shouldRetryMutation(0, { status: 429 })).toBe(false);
    expect(shouldRetryMutation(0, { statusCode: 429 })).toBe(false);
  });

  it('allows one mutation retry for other failures', () => {
    expect(shouldRetryMutation(0, { status: 503 })).toBe(true);
    expect(shouldRetryMutation(1, { status: 503 })).toBe(false);
  });
});
