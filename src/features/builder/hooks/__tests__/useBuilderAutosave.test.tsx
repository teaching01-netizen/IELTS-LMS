import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExamState } from '../../../../types';
import { createInitialExamState } from '../../../../services/examAdapterService';
import { useBuilderAutosave } from '../useBuilderAutosave';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const DEBOUNCE_MS = 350;

function buildState(title: string): ExamState {
  return createInitialExamState(title, 'Academic');
}

describe('useBuilderAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in the saved state', () => {
    const { result } = renderHook(() =>
      useBuilderAutosave({ save: vi.fn().mockResolvedValue(undefined) }),
    );

    expect(result.current.status).toBe('saved');
  });

  it('marks unsaved on schedule and saves the scheduled state after the debounce', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const stateA = buildState('Exam A');

    const { result } = renderHook(() => useBuilderAutosave({ save }));

    act(() => {
      result.current.scheduleAutosave(stateA);
    });

    expect(result.current.status).toBe('unsaved');
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(stateA);
    expect(result.current.status).toBe('saved');
  });

  it('coalesces rapid schedules into a single save carrying the latest state', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const stateA = buildState('Exam A');
    const stateB = buildState('Exam B');

    const { result } = renderHook(() => useBuilderAutosave({ save }));

    act(() => {
      result.current.scheduleAutosave(stateA);
      vi.advanceTimersByTime(100);
      result.current.scheduleAutosave(stateB);
    });

    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(stateB);
  });

  it('schedules a save made while another save is in flight only after it settles', async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const stateA = buildState('Exam A');
    const stateB = buildState('Exam B');

    const { result } = renderHook(() => useBuilderAutosave({ save }));

    act(() => {
      result.current.scheduleAutosave(stateA);
    });

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(save).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.scheduleAutosave(stateB);
    });

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    // Second save is queued behind the first, not executed yet.
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(stateB);

    await act(async () => {
      second.resolve();
    });

    expect(result.current.status).toBe('saved');
  });

  it('flushNow persists the given state immediately and reports success', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const state = buildState('Exam A');

    const { result } = renderHook(() => useBuilderAutosave({ save }));

    let flushResult: { ok: boolean; isLatest: boolean } | null = null;
    await act(async () => {
      flushResult = await result.current.flushNow(state);
    });

    expect(flushResult).toEqual({ ok: true, isLatest: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(state);
    expect(result.current.status).toBe('saved');
  });

  it('flushNow reports failure and surfaces the error when it is the latest request', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Draft has been modified'));
    const onError = vi.fn();
    const state = buildState('Exam A');

    const { result } = renderHook(() => useBuilderAutosave({ save, onError }));

    let flushResult: { ok: boolean; isLatest: boolean } | null = null;
    await act(async () => {
      flushResult = await result.current.flushNow(state);
    });

    expect(flushResult).toEqual({ ok: false, isLatest: true });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.current.status).toBe('error');
  });

  it('does not surface an error for a superseded autosave failure', async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onError = vi.fn();
    const stateA = buildState('Exam A');
    const stateB = buildState('Exam B');

    const { result } = renderHook(() => useBuilderAutosave({ save, onError }));

    act(() => {
      result.current.scheduleAutosave(stateA);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    act(() => {
      result.current.scheduleAutosave(stateB);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    // The first save fails while a newer request is queued.
    await act(async () => {
      first.reject(new Error('Draft has been modified'));
    });

    expect(save).toHaveBeenCalledTimes(2);

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.status).not.toBe('error');

    await act(async () => {
      second.resolve();
    });

    expect(result.current.status).toBe('saved');
    expect(onError).not.toHaveBeenCalled();
  });

  it('surfaces an error when the latest request fails after a superseded success', async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onError = vi.fn();
    const stateA = buildState('Exam A');
    const stateB = buildState('Exam B');

    const { result } = renderHook(() => useBuilderAutosave({ save, onError }));

    act(() => {
      result.current.scheduleAutosave(stateA);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    act(() => {
      result.current.scheduleAutosave(stateB);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    await act(async () => {
      first.resolve();
    });

    expect(save).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.reject(new Error('Draft has been modified'));
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
  });

  it('retry re-enqueues the supplied state under a fresh request id', async () => {
    const failing = createDeferred<void>();
    const retried = createDeferred<void>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => failing.promise)
      .mockImplementationOnce(() => retried.promise);
    const onError = vi.fn();
    const stateA = buildState('Exam A');
    const stateB = buildState('Exam B');

    const { result } = renderHook(() => useBuilderAutosave({ save, onError }));

    act(() => {
      result.current.scheduleAutosave(stateA);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    await act(async () => {
      failing.reject(new Error('Draft has been modified'));
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');

    act(() => {
      result.current.retry(stateB);
    });

    await act(async () => {
      retried.resolve();
    });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(stateB);
    expect(result.current.status).toBe('saved');
  });

  it('flushNow reports isLatest=false when a newer save is scheduled while it is in flight', async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const save = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const stateA = buildState('Exam A');
    const stateB = buildState('Exam B');

    const { result } = renderHook(() => useBuilderAutosave({ save }));

    let flushResult: { ok: boolean; isLatest: boolean } | null = null;
    let flushPromise: Promise<{ ok: boolean; isLatest: boolean }> | null = null;

    act(() => {
      flushPromise = result.current.flushNow(stateA);
    });

    // A newer autosave is scheduled while the flush is still in flight.
    act(() => {
      result.current.scheduleAutosave(stateB);
    });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    await act(async () => {
      first.resolve();
    });

    expect(save).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve();
    });

    await act(async () => {
      flushResult = await flushPromise;
    });

    expect(flushResult).toEqual({ ok: true, isLatest: false });
    expect(result.current.status).toBe('saved');
  });

  it('honors a custom debounce window', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const state = buildState('Exam A');

    const { result } = renderHook(() =>
      useBuilderAutosave({ save, debounceMs: 600 }),
    );

    act(() => {
      result.current.scheduleAutosave(state);
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
