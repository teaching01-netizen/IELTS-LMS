import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedLoading } from '../useDelayedLoading';

describe('useDelayedLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays false before the delay elapses', () => {
    const { result } = renderHook(() => useDelayedLoading(true));

    expect(result.current).toBe(false);
  });

  it('becomes true after the delay while still loading', () => {
    const { result } = renderHook(() => useDelayedLoading(true));

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(result.current).toBe(true);
  });

  it('never shows loading when the load resolves before the delay', () => {
    const { result, rerender } = renderHook(({ isLoading }) => useDelayedLoading(isLoading), {
      initialProps: { isLoading: true },
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(false);

    rerender({ isLoading: false });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // The pending timer was cleared on completion; nothing appears later.
    expect(result.current).toBe(false);
  });

  it('resets on a new loading cycle so a later slow reload still shows the skeleton', () => {
    const { result, rerender } = renderHook(({ isLoading }) => useDelayedLoading(isLoading), {
      initialProps: { isLoading: true },
    });

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe(true);

    rerender({ isLoading: false });
    expect(result.current).toBe(false);

    rerender({ isLoading: true });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe(true);
  });
});
