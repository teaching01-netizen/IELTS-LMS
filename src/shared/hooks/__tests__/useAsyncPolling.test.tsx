import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAsyncPolling } from "../useAsyncPolling";

describe("useAsyncPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not schedule another timer when a poll fires during an in-flight task", async () => {
    vi.useFakeTimers();
    let resolveFirst: (() => void) | undefined;
    const firstTask = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const task = vi.fn(() => firstTask);

    const { rerender, unmount } = renderHook(
      ({ intervalMs }: { intervalMs: number }) =>
        useAsyncPolling(task, { intervalMs, runImmediately: true }),
      { initialProps: { intervalMs: 100 } }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(task).toHaveBeenCalledTimes(1);

    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    rerender({ intervalMs: 200 });
    expect(setTimeoutSpy).toHaveBeenCalledTimes(0);

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(task).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(0);

    await act(async () => {
      resolveFirst?.();
      await Promise.resolve();
    });
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    unmount();
  });
});
