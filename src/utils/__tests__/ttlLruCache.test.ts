import { describe, expect, it } from 'vitest';

import { createTtlLruCache } from '../ttlLruCache';

describe('createTtlLruCache', () => {
  it('evicts the least recently used entry when max entries is exceeded', () => {
    const cache = createTtlLruCache<string, number>({
      maxEntries: 2,
      ttlMs: 60_000,
      now: () => 1_000,
    });

    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('evicts entries older than the configured ttl', () => {
    let now = 1_000;
    const cache = createTtlLruCache<string, number>({
      maxEntries: 10,
      ttlMs: 500,
      now: () => now,
    });

    cache.set('fresh', 1);
    now = 1_400;
    expect(cache.get('fresh')).toBe(1);

    now = 1_501;
    expect(cache.get('fresh')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('clears only entries in the requested namespace', () => {
    const cache = createTtlLruCache<string, number>({
      maxEntries: 10,
      ttlMs: 60_000,
      now: () => 1_000,
    });

    cache.set('student:a', 1, { namespace: 'student' });
    cache.set('grading:a', 2, { namespace: 'grading' });

    cache.clearNamespace('student');

    expect(cache.get('student:a')).toBeUndefined();
    expect(cache.get('grading:a')).toBe(2);
  });
});
