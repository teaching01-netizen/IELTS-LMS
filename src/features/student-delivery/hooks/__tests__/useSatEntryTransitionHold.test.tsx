import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSatEntryTransitionHold } from "../useSatEntryTransitionHold";

describe("useSatEntryTransitionHold", () => {
  afterEach(() => vi.useRealTimers());

  it("expires the current module handoff after the bounded delay", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSatEntryTransitionHold("attempt:module-2", 5_000));

    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(4_999));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it("restarts the delay for a new entry key and clears it outside entry", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ transitionKey }: { transitionKey: string | null }) =>
        useSatEntryTransitionHold(transitionKey, 5_000),
      { initialProps: { transitionKey: "attempt:module-2" as string | null } },
    );

    act(() => vi.advanceTimersByTime(4_000));
    rerender({ transitionKey: "attempt:module-3" });
    act(() => vi.advanceTimersByTime(4_999));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);

    rerender({ transitionKey: null });
    expect(result.current).toBe(false);
    rerender({ transitionKey: "attempt:module-3" });
    expect(result.current).toBe(false);
  });
});
