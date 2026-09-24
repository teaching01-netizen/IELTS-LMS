import { describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { createBrowserPool } from './browser-pool';

interface FakeBrowser {
  browser: Browser;
  connected: boolean;
  closed: boolean;
  setConnected: (value: boolean) => void;
}

function fakeBrowser(): FakeBrowser {
  const state: FakeBrowser = {
    connected: true,
    closed: false,
    setConnected: (value: boolean) => {
      state.connected = value;
    },
    browser: null as unknown as Browser,
  };
  const browser = {
    isConnected: () => state.connected,
    close: async () => {
      state.connected = false;
      state.closed = true;
    },
  };
  state.browser = browser as unknown as Browser;
  return state;
}

describe('createBrowserPool', () => {
  it('reuses one instance until maxContextsPerBrowser, then launches another', async () => {
    const launched: FakeBrowser[] = [];
    const pool = createBrowserPool({
      launch: async () => {
        const instance = fakeBrowser();
        launched.push(instance);
        return instance.browser;
      },
      maxContextsPerBrowser: 2,
      maxBrowsers: 3,
    });

    const first = await pool.acquire();
    const second = await pool.acquire();
    const third = await pool.acquire();

    expect(launched).toHaveLength(2);
    expect(second.browser).toBe(first.browser);
    expect(third.browser).toBe(launched[1]?.browser);
    expect(pool.browserCount()).toBe(2);
  });

  it('frees capacity again when a lease is released', async () => {
    const launched: FakeBrowser[] = [];
    const pool = createBrowserPool({
      launch: async () => {
        const instance = fakeBrowser();
        launched.push(instance);
        return instance.browser;
      },
      maxContextsPerBrowser: 1,
      maxBrowsers: 2,
    });

    const first = await pool.acquire();
    const second = await pool.acquire();
    expect(launched).toHaveLength(2);

    // Double release must not corrupt the count.
    first.release();
    first.release();
    const third = await pool.acquire();
    expect(third.browser).toBe(first.browser);
    expect(launched).toHaveLength(2);
    void second;
  });

  it('replaces a crashed instance instead of handing out a dead browser', async () => {
    const launched: FakeBrowser[] = [];
    const events: string[] = [];
    const pool = createBrowserPool({
      launch: async () => {
        const instance = fakeBrowser();
        launched.push(instance);
        return instance.browser;
      },
      maxContextsPerBrowser: 5,
      maxBrowsers: 5,
      onEvent: (message) => events.push(message),
    });

    const first = await pool.acquire();
    first.release();
    launched[0]!.setConnected(false);

    const second = await pool.acquire();
    expect(second.browser).not.toBe(first.browser);
    expect(launched).toHaveLength(2);
    expect(events.some((line) => line.startsWith('BROWSER_RECYCLED'))).toBe(true);
  });

  it('closes every instance on closeAll', async () => {
    const launched: FakeBrowser[] = [];
    const pool = createBrowserPool({
      launch: async () => {
        const instance = fakeBrowser();
        launched.push(instance);
        return instance.browser;
      },
      maxContextsPerBrowser: 1,
      maxBrowsers: 4,
    });

    await pool.acquire();
    await pool.acquire();
    await pool.closeAll();

    expect(launched.every((instance) => instance.closed)).toBe(true);
    expect(pool.browserCount()).toBe(0);
  });
});
