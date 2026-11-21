import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAT_LIVE_POLICY_HIDDEN_POLL_MS, SAT_LIVE_POLICY_POLL_MS, useSatLivePolicy } from "../useSatLivePolicy";

const satPolicy = vi.hoisted(() => vi.fn());
vi.mock("../../api/assessmentDeliveryApi", () => ({ assessmentDeliveryApi: { satPolicy } }));

type Policy = {
  revision: number;
  reportVisible: boolean;
  includeAnswerKeyInPdf: boolean;
  unlimitedRetakes: boolean;
  pauseOnLeave: boolean;
};

const policy = (revision: number, overrides: Partial<Policy> = {}): Policy => ({
  revision,
  reportVisible: true,
  includeAnswerKeyInPdf: false,
  unlimitedRetakes: false,
  pauseOnLeave: false,
  ...overrides,
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  satPolicy.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSatLivePolicy", () => {
  it("reads immediately and refreshes on the foreground cadence", async () => {
    satPolicy.mockResolvedValueOnce(policy(1)).mockResolvedValueOnce(policy(2, { reportVisible: false }));
    const { result } = renderHook(() => useSatLivePolicy("schedule-1", "attempt-1", true));
    await flush();
    expect(result.current.policy?.revision).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAT_LIVE_POLICY_POLL_MS);
    });
    expect(result.current.policy?.revision).toBe(2);
    expect(result.current.policy?.reportVisible).toBe(false);
    expect(result.current.signature).toContain("2:false");
  });

  it("does not poll while disabled", async () => {
    const { rerender } = renderHook(({ enabled }) => useSatLivePolicy("schedule-1", "attempt-1", enabled), {
      initialProps: { enabled: false },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAT_LIVE_POLICY_POLL_MS);
    });
    expect(satPolicy).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await flush();
    expect(satPolicy).toHaveBeenCalledTimes(1);
  });

  it("discards a stale response that arrives after a newer policy", async () => {
    let releaseFirst: (value: Policy) => void = () => {};
    let releaseSecond: (value: Policy) => void = () => {};
    satPolicy
      .mockReturnValueOnce(new Promise<Policy>((resolve) => { releaseFirst = resolve; }))
      .mockReturnValueOnce(new Promise<Policy>((resolve) => { releaseSecond = resolve; }));
    const { result } = renderHook(() => useSatLivePolicy("schedule-1", "attempt-1", true));
    await flush();
    // A foreground revalidation runs while the first read is still in flight.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      releaseSecond(policy(2, { reportVisible: false }));
      await Promise.resolve();
    });
    expect(result.current.policy?.revision).toBe(2);
    await act(async () => {
      releaseFirst(policy(1));
      await Promise.resolve();
    });
    expect(result.current.policy?.revision).toBe(2);
    expect(result.current.policy?.reportVisible).toBe(false);
  });

  it("keeps the last accepted policy after a failed read", async () => {
    satPolicy.mockResolvedValueOnce(policy(3)).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useSatLivePolicy("schedule-1", "attempt-1", true));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAT_LIVE_POLICY_POLL_MS);
    });
    expect(result.current.policy?.revision).toBe(3);
    expect(satPolicy).toHaveBeenCalledTimes(2);
  });

  it("backs off in a hidden tab and rereads when visible again", async () => {
    let visibility: DocumentVisibilityState = "hidden";
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    satPolicy.mockResolvedValue(policy(4));
    renderHook(() => useSatLivePolicy("schedule-1", "attempt-1", true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAT_LIVE_POLICY_POLL_MS);
    });
    expect(satPolicy).not.toHaveBeenCalled();
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(satPolicy).toHaveBeenCalledTimes(1);
    visibilitySpy.mockRestore();
    expect(SAT_LIVE_POLICY_HIDDEN_POLL_MS).toBeGreaterThan(SAT_LIVE_POLICY_POLL_MS);
  });
});
