import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useListeningCheckpoint } from "../useListeningCheckpoint";
const gateway = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock("../../infrastructure/audioCheckpointGateway", () => ({ audioCheckpointGateway: gateway }));
const view = {
  sectionKey: "listening",
  partId: "p",
  mediaRevision: "rev",
  leaseEpoch: 4,
  runGeneration: 1,
  checkpoint: { positionMs: 17000, clientSequence: 4 },
};
describe("listening checkpoint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    gateway.read.mockResolvedValue(view);
    gateway.save.mockResolvedValue(view);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("seeks once and saves at two seconds rather than on every timeupdate", async () => {
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "duration", { value: 100 });
    Object.defineProperty(audio, "paused", { value: false });
    const ref = { current: audio };
    const { rerender, unmount } = renderHook(() =>
      useListeningCheckpoint(ref, { attemptId: "a", scheduleId: "s" }, "p", "signed-source", true)
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(audio.currentTime).toBe(17);
    audio.currentTime = 30;
    rerender();
    for (let tick = 0; tick < 10; tick++) audio.dispatchEvent(new Event("timeupdate"));
    expect(audio.currentTime).toBe(30);
    expect(gateway.save).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(gateway.save.mock.calls[0]?.slice(2)).toEqual([30000, 5]);
    audio.currentTime = 12;
    await act(async () => {
      audio.dispatchEvent(new Event("seeked"));
      await Promise.resolve();
    });
    expect(gateway.save.mock.calls[1]?.slice(2)).toEqual([12000, 6]);
    unmount();
  });
  it("leaves shared classroom audio untouched", async () => {
    renderHook(() =>
      useListeningCheckpoint(
        { current: document.createElement("audio") },
        { attemptId: "a", scheduleId: "s" },
        "p",
        "source",
        false
      )
    );
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(gateway.read).not.toHaveBeenCalled();
    expect(gateway.save).not.toHaveBeenCalled();
  });
  it("retries a failed initial read instead of disabling checkpoints for the part", async () => {
    gateway.read.mockRejectedValueOnce(new Error("offline"));
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "duration", { value: 100 });
    const ref = { current: audio }; // stable, as a component's useRef is
    const identity = { attemptId: "a", scheduleId: "s" };
    const { result } = renderHook(() =>
      useListeningCheckpoint(
        ref,
        identity,
        "p",
        "source",
        true
      )
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(gateway.read).toHaveBeenCalledTimes(2);
    expect(audio.currentTime).toBe(17);
    expect(result.current).toBeNull();
  });
  it("resumes offline from this device's last position and reconciles it on reconnect", async () => {
    localStorage.clear();
    const { saveDurableDraft } = await import("../../../../utils/durableDraftStore");
    await saveDurableDraft("ielts-audio-checkpoint:a:p", { view, positionMs: 42000, sequence: 9 });
    gateway.read.mockRejectedValueOnce(new Error("offline"));
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "duration", { value: 100 });
    const ref = { current: audio };
    const identity = { attemptId: "a", scheduleId: "s" };
    renderHook(() => useListeningCheckpoint(ref, identity, "p", "blob:cached", true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(audio.currentTime).toBe(42);
    expect(gateway.save).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    // Reconnected: the newer same-identity local position is sent once.
    expect(gateway.save.mock.calls.some((call) => call[2] === 42000 && call[3] === 10)).toBe(true);
  });
});
