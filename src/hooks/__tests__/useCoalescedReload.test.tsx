import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCoalescedReload } from '../useCoalescedReload';

describe('useCoalescedReload', () => {
  it('shows loading for a full reload and settles when it finishes', async () => {
    const { result } = renderHook(() => useCoalescedReload(false));

    let resolveFetch!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const applied: string[] = [];
    const fetch = vi.fn(async (isStale: () => boolean) => {
      await gate;
      if (!isStale()) applied.push('applied');
    });

    let promise!: Promise<void>;
    act(() => {
      promise = result.current.reload(fetch);
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveFetch();
      await promise;
    });
    expect(applied).toEqual(['applied']);
    expect(result.current.loading).toBe(false);
    expect(result.current.inFlight.current).toBeNull();
  });

  it('coalesces background reloads into a single in-flight fetch', async () => {
    const { result } = renderHook(() => useCoalescedReload(false));

    let resolveFetch!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const fetch = vi.fn(async () => {
      await gate;
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.reload(fetch, { background: true });
      second = result.current.reload(fetch, { background: true });
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(second).toBe(result.current.inFlight.current);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolveFetch();
      await Promise.all([first, second]);
    });
    expect(result.current.inFlight.current).toBeNull();
  });

  it('lets a forced reload bypass the share and supersede the in-flight one', async () => {
    const { result } = renderHook(() => useCoalescedReload(false));

    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    const applied: string[] = [];
    let call = 0;
    const fetch = vi.fn(async (isStale: () => boolean) => {
      call += 1;
      if (call === 1) {
        await firstGate;
      } else {
        await secondGate;
      }
      if (!isStale()) applied.push(`call-${call}`);
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.reload(fetch, { background: true });
      second = result.current.reload(fetch, { background: true, force: true });
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);

    await act(async () => {
      // The superseded reload finishes first; its results are discarded.
      resolveFirst();
      await first;
      expect(applied).toEqual([]);

      // The forced reload applies its results.
      resolveSecond();
      await second;
      expect(applied).toEqual(['call-2']);
    });
  });

  it('discards a superseded reload so only the latest applies', async () => {
    const { result } = renderHook(() => useCoalescedReload(false));

    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });

    const applied: string[] = [];
    let call = 0;
    const fetch = vi.fn(async (isStale: () => boolean) => {
      call += 1;
      await gate;
      if (!isStale()) applied.push(`call-${call}`);
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.reload(fetch);
      second = result.current.reload(fetch, { force: true });
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveGate();
      await Promise.all([first, second]);
    });

    // Reload #1 finished after being superseded, so its results were skipped.
    expect(applied).toEqual(['call-2']);
  });
});
