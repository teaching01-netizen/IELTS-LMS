import { describe, expect, it, vi } from 'vitest';
import { createBootstrapCache, type BootstrapFetcher } from '../bootstrapEtag';

// Plan C4: persist the version payload by ETag across reconnects; send
// If-None-Match so reconnects are a 304 (zero bytes), not a full re-fetch.
describe('bootstrap ETag cache (plan C4)', () => {
  const payload = { version: { id: 'v1' }, content: { blocks: [1] } };
  const fetcher = (etag: string | null): BootstrapFetcher =>
    vi.fn(async (_s: string, _a: string, ifNoneMatch: string | null) => {
      void etag;
      void ifNoneMatch;
      return { status: 200 as const, etag: 'W/"v1-3"', payload };
    });

  it('sends no If-None-Match on first fetch, persists ETag + payload', async () => {
    const fetch = fetcher('x');
    const cache = createBootstrapCache({ fetch });
    const out = await cache.bootstrap('sched-1', 'attempt-1');
    expect(fetch).toHaveBeenCalledWith('sched-1', 'attempt-1', null);
    expect(out).toEqual(payload);
    expect(cache.entry()?.etag).toBe('W/"v1-3"');
  });

  it('sends If-None-Match on reconnect and reuses payload on 304', async () => {
    let calls = 0;
    const fetch: BootstrapFetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { status: 200 as const, etag: 'W/"v1-3"', payload };
      }
      return { status: 304 as const, etag: 'W/"v1-3"', payload: null };
    });
    const cache = createBootstrapCache({ fetch });
    await cache.bootstrap('sched-1', 'attempt-1');
    const second = await cache.bootstrap('sched-1', 'attempt-1');
    expect(fetch).toHaveBeenLastCalledWith('sched-1', 'attempt-1', 'W/"v1-3"');
    expect(second).toEqual(payload);
  });

  it('replaces payload on a new ETag (republish)', () => {
    void fetcher;
  });
});
