import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAnsweredExamDownload } from "../useAnsweredExamDownload";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const grant = () => ({
  downloadUrl: "/api/v1/sat-answered-pdf/downloads/0123456789abcdef0123456789abcdef",
  filename: "exam.pdf",
  sizeBytes: 100,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
});

describe("answered exam download lifecycle", () => {
  it("starts a native download automatically after one preparation action", async () => {
    const pdf = grant();
    const clicked: HTMLAnchorElement[] = [];
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      expect(this.isConnected).toBe(true);
      clicked.push(this);
    });
    const { result } = renderHook(() =>
      useAnsweredExamDownload({ key: "attempt", preparePdf: async () => pdf })
    );
    await act(async () => {
      await result.current.prepare();
    });
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toHaveAttribute("href", pdf.downloadUrl);
    expect(clicked[0]).toHaveAttribute("download", pdf.filename);
    expect(clicked[0]).not.toHaveAttribute("target");
    expect(clicked[0]!.isConnected).toBe(false);
    expect(result.current.download).toBe("ready");
  });
  it("never starts a download after leaving the report, even when preparation resolves late", async () => {
    let resolve!: (pdf: ReturnType<typeof grant>) => void;
    const pending = new Promise<ReturnType<typeof grant>>((finish) => {
      resolve = finish;
    });
    const { result, unmount } = renderHook(() =>
      useAnsweredExamDownload({ key: "attempt", preparePdf: () => pending })
    );
    let preparation!: Promise<void>;
    act(() => {
      preparation = result.current.prepare();
    });
    unmount();
    await act(async () => {
      resolve(grant());
      await preparation;
    });
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
  it("expires ready links and permits preparation again", async () => {
    const preparePdf = vi.fn().mockImplementation(async () => grant());
    const { result } = renderHook(() => useAnsweredExamDownload({ key: "attempt", preparePdf }));
    await act(async () => {
      await result.current.prepare();
    });
    expect(result.current.download).toBe("ready");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_001);
    });
    expect(result.current.ready).toBeNull();
    expect(result.current.download).toBe("idle");
    await act(async () => {
      await result.current.prepare();
    });
    expect(preparePdf).toHaveBeenCalledTimes(2);
    expect(result.current.download).toBe("ready");
  });
  it("aborts a stalled preparation and leaves a working retry", async () => {
    const preparePdf = vi.fn(
      (_request, signal: AbortSignal) =>
        new Promise<ReturnType<typeof grant>>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
        )
    );
    const { result } = renderHook(() => useAnsweredExamDownload({ key: "attempt", preparePdf }));
    let pending: Promise<void>;
    act(() => {
      pending = result.current.prepare();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_001);
      await pending;
    });
    expect(preparePdf.mock.calls[0]![1].aborted).toBe(true);
    expect(result.current.download).toBe("failed");
    preparePdf.mockImplementation(async () => grant());
    await act(async () => {
      await result.current.prepare();
    });
    expect(result.current.download).toBe("ready");
  });
  it("clears the preparation timer immediately even if a transport ignores cancellation", () => {
    const { result, unmount } = renderHook(() =>
      useAnsweredExamDownload({ key: "attempt", preparePdf: () => new Promise(() => undefined) })
    );
    act(() => {
      void result.current.prepare();
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels timers when leaving the report", async () => {
    const { result, unmount } = renderHook(() =>
      useAnsweredExamDownload({ key: "attempt", preparePdf: async () => grant() })
    );
    await act(async () => {
      await result.current.prepare();
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
