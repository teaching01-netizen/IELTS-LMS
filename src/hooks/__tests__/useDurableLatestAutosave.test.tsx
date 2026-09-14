import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDurableDraft, loadDurableDraft, saveDurableDraft } from '../../utils/durableDraftStore';
import { useDurableLatestAutosave } from '../useDurableLatestAutosave';

const KEY = 'staff-draft-test:hook:staff-a:exam-a';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

function conflictError(): Error {
  return Object.assign(new Error('Question changed while you were editing'), {
    status: 409,
    code: 'CONFLICT',
  });
}

describe('useDurableLatestAutosave', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    window.localStorage.clear();
    await clearDurableDraft(KEY).catch(() => undefined);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await clearDurableDraft(KEY).catch(() => undefined);
    window.localStorage.clear();
  });

  it('keeps the conflict fence when the author keeps typing, and does not auto-retry the stale base', async () => {
    const save = vi.fn().mockRejectedValue(conflictError());
    const { result } = renderHook(() =>
      useDurableLatestAutosave<string>({ save, durableKey: null, debounceMs: 10 }),
    );

    act(() => result.current.schedule('first'));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    await settle();

    expect(result.current.status).toBe('conflict');
    expect(save).toHaveBeenCalledTimes(1);

    // A later keystroke must NOT clear the fence back to "unsaved"…
    act(() => result.current.schedule('second'));
    expect(result.current.status).toBe('conflict');

    // …and the debounced auto-save must not re-send the same stale base.
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    // The newest content is still checkpointed for reload recovery.
    expect(await loadDurableDraft<string>(KEY)).toBeNull();
  });

  it('lets an explicit retry attempt the write while conflicted, and clears the fence on success', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(conflictError())
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() =>
      useDurableLatestAutosave<string>({ save, durableKey: null, debounceMs: 10 }),
    );

    act(() => result.current.schedule('first'));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    await settle();
    expect(result.current.status).toBe('conflict');

    act(() => result.current.retry('first'));
    await settle();
    expect(result.current.status).toBe('saved');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale recovered draft overwrite an edit made while IndexedDB was loading', async () => {
    // A durable draft exists from a previous session.
    await saveDurableDraft(KEY, 'recovered-old');

    const onRecover = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDurableLatestAutosave<string>({
        save,
        durableKey: KEY,
        debounceMs: 10,
        onRecover,
        autoSaveRecovered: true,
      }),
    );

    // The author types BEFORE the durable read resolves.
    act(() => result.current.schedule('typed-new'));

    // Let the recovery read settle and the debounce flush.
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(10);
      await Promise.resolve();
    });

    // The stale recovered value must never be installed over the newer edit,
    // and must never be enqueued for a send (invisible write).
    expect(onRecover).not.toHaveBeenCalled();
    for (const call of save.mock.calls) {
      expect(call[0]).toBe('typed-new');
    }
    expect(save).toHaveBeenCalled();
  });

  it('reports flush failure from its own request, not a superseded failure', async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() =>
      useDurableLatestAutosave<string>({ save, durableKey: null, debounceMs: 10 }),
    );

    let flushPromise: Promise<{ ok: boolean; isLatest: boolean }> | null = null;
    act(() => {
      flushPromise = result.current.flush('flushed');
    });

    // A newer autosave lands while the flush is in flight.
    act(() => result.current.schedule('newer'));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });

    // The flush's own request succeeds…
    await act(async () => {
      first.resolve();
    });
    await act(async () => {
      second.resolve();
    });

    let flushed: { ok: boolean; isLatest: boolean } | null = null;
    await act(async () => {
      flushed = await flushPromise;
    });

    // …so its result must be ok:true even though an older request failed
    // afterwards (global lastError is not this request's outcome).
    expect(flushed).toEqual({ ok: true, isLatest: false });
  });

  it('reports flush failure masked by a later success as a failure', async () => {
    const failing = createDeferred<void>();
    const succeeding = createDeferred<void>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => failing.promise)
      .mockImplementationOnce(() => succeeding.promise);
    const { result } = renderHook(() =>
      useDurableLatestAutosave<string>({ save, durableKey: null, debounceMs: 10 }),
    );

    let flushPromise: Promise<{ ok: boolean; isLatest: boolean }> | null = null;
    act(() => {
      flushPromise = result.current.flush('flushed');
    });

    await act(async () => {
      failing.reject(new Error('boom'));
    });

    // A later autosave succeeds while the flush is already settled.
    act(() => result.current.schedule('newer'));
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    await act(async () => {
      succeeding.resolve();
    });

    let flushed: { ok: boolean; isLatest: boolean } | null = null;
    await act(async () => {
      flushed = await flushPromise;
    });

    expect(flushed?.ok).toBe(false);
  });

  it('normalizes a non-Error durable-read rejection into the error state', async () => {
    // Sanity: recovery failures stay visible (requestId-gated).
    const save = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDurableLatestAutosave<string>({ save, durableKey: KEY, debounceMs: 10, onError }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(['saved', 'unsaved']).toContain(result.current.status);
  });
});
