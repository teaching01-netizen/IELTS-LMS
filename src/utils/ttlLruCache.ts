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

  const evictExpired = () => {
    const current = now();
    for (const [key, entry] of entries) {
      if (current - entry.metadata.createdAt > policy.ttlMs) {
        entries.delete(key);
      }
    }
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
      evictExpired();
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      entry.metadata.lastAccessedAt = now();
      entry.accessOrder = ++accessOrder;
      return entry.value;
    },
    set(key, value, metadata) {
      evictExpired();
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
      evictOverflow();
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    clearNamespace(namespace) {
      for (const [key, entry] of entries) {
        if (entry.metadata.namespace === namespace) {
          entries.delete(key);
        }
      }
    },
    size() {
      evictExpired();
      return entries.size;
    },
  };
}
