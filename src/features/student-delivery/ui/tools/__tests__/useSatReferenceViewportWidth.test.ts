import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SAT_REFERENCE_VIEWPORT_FALLBACK_HEIGHT,
  SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH,
  useSatReferenceStageSize,
  useSatReferenceViewportWidth,
} from "../useSatReferenceViewportWidth";

function makeNode(
  width: number,
  clientWidth?: number,
  height = 100,
  clientHeight?: number,
): HTMLElement {
  const node = document.createElement("div");
  document.body.appendChild(node);
  // jsdom clientWidth/clientHeight are 0 by default — define them so the
  // R-06 preferred path (clientWidth) is what the tests exercise; rect
  // stays the fallback. R-07 extends both stubs to the height axis.
  Object.defineProperty(node, "clientWidth", {
    configurable: true,
    value: clientWidth ?? width,
  });
  Object.defineProperty(node, "clientHeight", {
    configurable: true,
    value: clientHeight ?? height,
  });
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    x: 0,
    y: 0,
    toJSON: () => undefined,
  } as DOMRect);
  return node;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useSatReferenceViewportWidth (R-01 Step 9)", () => {
  it("falls back to 1000 when the element is missing (never 0/NaN)", () => {
    const ref = { current: null };
    const { result } = renderHook(() => useSatReferenceViewportWidth(ref));
    expect(result.current).toBe(SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH);
    expect(result.current).toBe(1000);
    expect(Number.isFinite(result.current)).toBe(true);
  });

  it("sync-measures the live content-box width on mount", () => {
    const node = makeNode(666);
    const ref = { current: node } as { current: HTMLElement | null };
    const { result } = renderHook(() => useSatReferenceViewportWidth(ref));
    expect(result.current).toBe(666);
  });

  it("never returns 0/NaN: zero and NaN measurements fall back to 1000", () => {
    for (const bad of [0, -5, NaN]) {
      const node = makeNode(bad, bad);
      const ref = { current: node } as { current: HTMLElement | null };
      const { result, unmount } = renderHook(() => useSatReferenceViewportWidth(ref));
      expect(result.current).toBe(1000);
      expect(Number.isFinite(result.current)).toBe(true);
      unmount();
      document.body.innerHTML = "";
    }
  });

  it("prefers clientWidth (scrollbar-excluded) over the rect width (R-06 B4)", () => {
    // Scrollbar present: rect (border-box) reads wider than clientWidth
    // (content-box). The fit scale must use the narrower content width so
    // the document never crops its right edge at zoom <= 1.
    const node = makeNode(666, 651);
    const ref = { current: node } as { current: HTMLElement | null };
    const { result } = renderHook(() => useSatReferenceViewportWidth(ref));
    expect(result.current).toBe(651);
  });

  it("falls back to the rect width when clientWidth is 0 (R-06 B4)", () => {
    const node = makeNode(640, 0);
    const ref = { current: node } as { current: HTMLElement | null };
    const { result } = renderHook(() => useSatReferenceViewportWidth(ref));
    expect(result.current).toBe(640);
  });

  it("keeps the sync-measured width when ResizeObserver is unavailable", () => {
    const node = makeNode(640);
    const ref = { current: node } as { current: HTMLElement | null };
    const Original = window.ResizeObserver;
    vi.stubGlobal("ResizeObserver", undefined);
    try {
      const { result } = renderHook(() => useSatReferenceViewportWidth(ref));
      expect(result.current).toBe(640);
    } finally {
      vi.stubGlobal("ResizeObserver", Original);
    }
  });

  it("updates on resize: observer tick commits the new content-box width", () => {
    const node = makeNode(500);
    const ref = { current: node } as { current: HTMLElement | null };
    let captured: ResizeObserverCallback | null = null;
    const Original = window.ResizeObserver;
    class CapturingObserver {
      static captured: ResizeObserverCallback | null = null;
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        captured = callback;
        CapturingObserver.captured = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", CapturingObserver);
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    try {
      const { result } = renderHook(() => useSatReferenceViewportWidth(ref));
      expect(result.current).toBe(500);
      expect(captured).not.toBeNull();
      Object.defineProperty(node, "clientWidth", { configurable: true, value: 720 });
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
        width: 735,
        height: 100,
        top: 0,
        left: 0,
        bottom: 100,
        right: 735,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      } as DOMRect);
      act(() => {
        captured?.([], CapturingObserver.captured as unknown as ResizeObserver);
        while (rafCallbacks.length > 0) rafCallbacks.shift()?.(0);
      });
      expect(result.current).toBe(720);
    } finally {
      vi.stubGlobal("ResizeObserver", Original);
    }
  });
});

describe("useSatReferenceStageSize (R-07 Step 3)", () => {
  it("measures both axes from the content-box size", () => {
    const node = makeNode(920, 920, 517, 517);
    const ref = { current: node } as { current: HTMLElement | null };
    const { result } = renderHook(() => useSatReferenceStageSize(ref));
    expect(result.current).toEqual({ w: 920, h: 517, measured: true });
  });

  it("uses an unmeasured proportional seed until the stage mounts", () => {
    const ref = { current: null };
    const { result } = renderHook(() =>
      useSatReferenceStageSize(ref, { w: 666, h: 373 }),
    );
    expect(result.current).toEqual({ w: 666, h: 373, measured: false });
  });

  it("falls back per axis to { 1000, 560 } and never returns 0/NaN", () => {
    const ref = { current: null };
    const { result } = renderHook(() => useSatReferenceStageSize(ref));
    expect(result.current).toEqual({
      w: SAT_REFERENCE_VIEWPORT_FALLBACK_WIDTH,
      h: SAT_REFERENCE_VIEWPORT_FALLBACK_HEIGHT,
      measured: false,
    });
    expect(result.current).toEqual({ w: 1000, h: 560, measured: false });

    // Width readable, height degenerate: height falls back independently.
    const partial = makeNode(666, 666, 0, 0);
    const partialRef = { current: partial } as { current: HTMLElement | null };
    const { result: partialResult, unmount } = renderHook(() =>
      useSatReferenceStageSize(partialRef),
    );
    // clientHeight 0 with a rect height of 0 -> per-axis fallback 560.
    expect(partialResult.current.w).toBe(666);
    expect(partialResult.current.h).toBe(560);
    expect(partialResult.current.measured).toBe(true);
    expect(Number.isFinite(partialResult.current.w)).toBe(true);
    expect(Number.isFinite(partialResult.current.h)).toBe(true);
    unmount();
  });

  it("keeps the last good value when an update measures 0/NaN", () => {
    const node = makeNode(500, 500, 400, 400);
    const ref = { current: node } as { current: HTMLElement | null };
    let captured: ResizeObserverCallback | null = null;
    const Original = window.ResizeObserver;
    class CapturingObserver {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        captured = callback;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", CapturingObserver);
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    try {
      const { result } = renderHook(() => useSatReferenceStageSize(ref));
      expect(result.current).toEqual({ w: 500, h: 400, measured: true });
      expect(captured).not.toBeNull();
      // Collapsed/detached node: both axes read 0 — commit keeps last good.
      Object.defineProperty(node, "clientWidth", { configurable: true, value: 0 });
      Object.defineProperty(node, "clientHeight", { configurable: true, value: 0 });
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      } as DOMRect);
      act(() => {
        captured?.([], {} as ResizeObserver);
        while (rafCallbacks.length > 0) rafCallbacks.shift()?.(0);
      });
      expect(result.current).toEqual({ w: 500, h: 400, measured: true });
    } finally {
      vi.stubGlobal("ResizeObserver", Original);
    }
  });
});
