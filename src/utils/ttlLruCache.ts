/**
 * Bounded TTL + LRU cache.
 *
 * Semantics:
 * - TTL is measured from `set` (creation time), not from last access: `get`
 *   refreshes recency (LRU order) but never extends the entry's lifetime.
 * - An entry whose age exceeds `ttlMs` is treated as missing everywhere
 *   (`get` returns undefined, `size` excludes it) and is swept lazily.
 * - When the map exceeds `maxEntries`, least-recently-used entries are evicted
 *   first; `set` on an existing key refreshes both value and recency.
 * - Eviction is amortized: `evictExpired` compacts only after enough expired
 *   entries accumulate (or the map overflows), so steady-state `get`/`set`
 *   stays O(1) and full scans happen at most once per N mutations rather than
 *   on every call.
 */
export interface CacheEntryMetadata {
  namespace?: string | undefined;
  createdAt: number;
  lastAccessedAt: number;
}

export interface MemoryCachePolicy {
  maxEntries: number;
  ttlMs: number;
  now?: (() => number) | undefined;
}

interface CacheRecord<T> {
  value: T;
  metadata: CacheEntryMetadata;
  accessOrder: number;
}

export interface TtlLruCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V, metadata?: Partial<Pick<CacheEntryMetadata, 'namespace'>>): void;
  delete(key: K): void;
  clear(): void;
  clearNamespace(namespace: string): void;
  size(): number;
}

export function createTtlLruCache<K, V>(policy: MemoryCachePolicy): TtlLruCache<K, V> {
  const entries = new Map<K, CacheRecord<V>>();
  const now = policy.now ?? (() => Date.now());
  let accessOrder = 0;
  // Mutations since the last full expired-sweep. A sweep runs only when this
  // counter reaches the amortize threshold (bounded by current size) or an
  // overflow eviction needs accurate accounting — keeping steady-state ops O(1).
  let mutationsSinceSweep = 0;

  const isExpired = (entry: CacheRecord<V>, current: number): boolean =>
    current - entry.metadata.createdAt > policy.ttlMs;

  const sweepExpired = (): void => {
    const current = now();
    for (const [key, entry] of entries) {
      if (isExpired(entry, current)) {
        entries.delete(key);
      }
    }
    mutationsSinceSweep = 0;
  };

  const maybeSweepExpired = (): void => {
    mutationsSinceSweep += 1;
    // Threshold scales with size so tiny caches still sweep promptly while
    // large caches amortize the O(n) scan across many mutations.
    const threshold = Math.max(8, Math.min(128, entries.size));
    if (mutationsSinceSweep >= threshold) {
      sweepExpired();
    }
  };

  const readEntry = (key: K): CacheRecord<V> | undefined => {
    const entry = entries.get(key);
    if (!entry) return undefined;
    // Lazy single-key expiry: a stale entry is indistinguishable from missing
    // and is removed on contact even between sweeps.
    if (isExpired(entry, now())) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  const evictOverflow = () => {
    while (entries.size > policy.maxEntries) {
      let oldestKey: K | null = null;
      let oldestAccess = Number.POSITIVE_INFINITY;
      for (const [key, entry] of entries) {
        if (entry.accessOrder < oldestAccess) {
          oldestAccess = entry.accessOrder;
          oldestKey = key;
        }
      }
      if (oldestKey === null) {
        return;
      }
      entries.delete(oldestKey);
    }
  };

  return {
    get(key) {
      const entry = readEntry(key);
      if (!entry) {
        maybeSweepExpired();
        return undefined;
      }
      entry.metadata.lastAccessedAt = now();
      entry.accessOrder = ++accessOrder;
      maybeSweepExpired();
      return entry.value;
    },
    set(key, value, metadata) {
      const current = now();
      entries.set(key, {
        value,
        metadata: {
          namespace: metadata?.namespace,
          createdAt: current,
          lastAccessedAt: current,
        },
        accessOrder: ++accessOrder,
      });
      // Overflow accounting must observe live entries: sweep before evicting
      // so expired entries yield their slots instead of forcing out live ones.
      sweepExpired();
      evictOverflow();
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
      mutationsSinceSweep = 0;
    },
    clearNamespace(namespace) {
      for (const [key, entry] of entries) {
        if (entry.metadata.namespace === namespace) {
          entries.delete(key);
        }
      }
    },
    size() {
      sweepExpired();
      return entries.size;
    },
  };
}
