import type { Browser } from 'playwright';

/**
 * Chromium is the load runner's single point of failure: one shared browser
 * means one crash ("Target page, context or browser has been closed") fails
 * every bot at the same instant (observed: 85 of 100 users in one second).
 *
 * The pool keeps a small number of instances, caps how many contexts each one
 * carries, and transparently replaces an instance that died so the remaining
 * queue still runs. A crash then costs at most `maxContextsPerBrowser` users.
 */

export interface BrowserPoolLease {
  browser: Browser;
  release: () => void;
}

export interface BrowserPoolOptions {
  launch: () => Promise<Browser>;
  maxContextsPerBrowser: number;
  maxBrowsers: number;
  onEvent?: (message: string) => void;
}

export interface BrowserPool {
  acquire: () => Promise<BrowserPoolLease>;
  closeAll: () => Promise<void>;
  browserCount: () => number;
}

interface PoolEntry {
  browser: Browser;
  contexts: number;
  generation: number;
}

export function createBrowserPool(options: BrowserPoolOptions): BrowserPool {
  const maxContextsPerBrowser = Math.max(1, Math.trunc(options.maxContextsPerBrowser));
  const maxBrowsers = Math.max(1, Math.trunc(options.maxBrowsers));
  const note = (message: string) => options.onEvent?.(message);
  let entries: PoolEntry[] = [];
  let generation = 0;
  let acquireTail: Promise<void> = Promise.resolve();

  function dropDisconnected(): void {
    entries = entries.filter((entry) => {
      if (entry.browser.isConnected()) return true;
      note(
        `BROWSER_RECYCLED: Chromium instance ${entry.generation} crashed or exited with ${entry.contexts} context(s) attached; the remaining queue moves to a fresh instance.`,
      );
      void entry.browser.close().catch(() => undefined);
      return false;
    });
  }

  return {
    async acquire(): Promise<BrowserPoolLease> {
      const previousAcquire = acquireTail;
      let unlock!: () => void;
      acquireTail = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await previousAcquire;

      let target: PoolEntry;
      try {
        dropDisconnected();
        let entry = entries.find((candidate) => candidate.contexts < maxContextsPerBrowser) ?? null;
        if (!entry) {
          if (entries.length < maxBrowsers) {
            generation += 1;
            const browser = await options.launch();
            entry = { browser, contexts: 0, generation };
            entries.push(entry);
            note(`BROWSER_LAUNCHED: instance ${generation} (${entries.length}/${maxBrowsers}).`);
          } else {
            // Only reachable when callers hold more contexts than the pool can
            // accommodate; share the least-loaded browser as a safety fallback.
            entry = entries.reduce((least, candidate) =>
              candidate.contexts < least.contexts ? candidate : least,
            );
          }
        }

        entry.contexts += 1;
        target = entry;
      } finally {
        unlock();
      }
      let released = false;
      return {
        browser: target.browser,
        release: () => {
          if (released) return;
          released = true;
          target.contexts = Math.max(0, target.contexts - 1);
        },
      };
    },

    async closeAll(): Promise<void> {
      const closing = entries;
      entries = [];
      await Promise.all(closing.map((entry) => entry.browser.close().catch(() => undefined)));
    },

    browserCount: () => entries.length,
  };
}
