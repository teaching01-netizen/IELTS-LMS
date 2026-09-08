// Bootstrap ETag cache (plan C4/D1): the version payload is immutable per
// revision — persist it by ETag (in memory + sessionStorage) across
// reconnects and send If-None-Match. A 304 returns zero bytes and reuses
// the cached payload; a new ETag (republish) replaces it. Corrupt storage
// entries are dropped (fail back to a full fetch, never a bad exam).

export type BootstrapFetchResult =
  | { readonly status: 200; readonly etag: string | null; readonly payload: unknown }
  | { readonly status: 304; readonly etag: string | null; readonly payload: null };

export type BootstrapFetcher = (
  scheduleId: string,
  attemptId: string,
  ifNoneMatch: string | null,
) => Promise<BootstrapFetchResult>;

interface StoredEntry {
  etag: string;
  payload: unknown;
}

function storageKey(scheduleId: string, attemptId: string): string {
  return `sat-bootstrap-etag:${scheduleId}:${attemptId}`;
}

function loadStored(scheduleId: string, attemptId: string): StoredEntry | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return null;
    }
    const raw = window.sessionStorage.getItem(storageKey(scheduleId, attemptId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredEntry>;
    if (typeof parsed.etag !== 'string' || !('payload' in parsed)) {
      return null;
    }
    return { etag: parsed.etag, payload: parsed.payload };
  } catch {
    return null;
  }
}

function storeEntry(scheduleId: string, attemptId: string, entry: StoredEntry): void {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      return;
    }
    window.sessionStorage.setItem(storageKey(scheduleId, attemptId), JSON.stringify(entry));
  } catch {
    // Memory cache still works when storage is unavailable.
  }
}

export interface BootstrapCache {
  bootstrap(scheduleId: string, attemptId: string): Promise<unknown>;
  entry(): StoredEntry | null;
  clear(): void;
}

export function createBootstrapCache(input: { readonly fetch: BootstrapFetcher }): BootstrapCache {
  let memory: StoredEntry | null = null;
  let memoryKey = '';

  return {
    async bootstrap(scheduleId: string, attemptId: string): Promise<unknown> {
      const key = `${scheduleId}:${attemptId}`;
      if (!memory || memoryKey !== key) {
        memory = loadStored(scheduleId, attemptId);
        memoryKey = key;
      }
      const ifNoneMatch = memory?.etag ?? null;
      const res = await input.fetch(scheduleId, attemptId, ifNoneMatch);
      if (res.status === 304) {
        if (memory) {
          return memory.payload;
        }
        // 304 with nothing cached (storage cleared mid-session): refetch
        // unconditionally rather than serving an empty exam.
        const full = await input.fetch(scheduleId, attemptId, null);
        if (full.status === 200) {
          memory = full.etag ? { etag: full.etag, payload: full.payload } : null;
          if (memory) {
            storeEntry(scheduleId, attemptId, memory);
          }
          return full.payload;
        }
        throw new Error('Bootstrap unavailable (conditional refetch failed).');
      }
      const next: StoredEntry | null = res.etag ? { etag: res.etag, payload: res.payload } : null;
      memory = next;
      if (next) {
        storeEntry(scheduleId, attemptId, next);
      }
      return res.payload;
    },
    entry(): StoredEntry | null {
      return memory;
    },
    clear(): void {
      memory = null;
      memoryKey = '';
    },
  };
}
