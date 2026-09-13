/**
 * R-04 Step 6 panel wiring - panel-adjacent restore-flow suite (PART 2).
 * Owns: SatReferenceSheetPanel.tsx assertions ONLY (no e2e, no coexistence
 * edits, no store/policy/geometry edits). Covers the Step-5 restore
 * sequences through the mounted panel: close->reopen restores
 * collapsed/scale/scroll + clamped geometry, collapse->expand preserves
 * the restored rect, clamp-not-reset folds (never recenters/defaults),
 * and drag/resize commits set the manual-wins flags via the merged
 * view-store write (hint-family fields preserved).
 */
import { fireEvent, render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SatReferenceSheetPanel,
  defaultSatReferenceGeometry,
  isPreR04LeftEdge,
  satReferenceViewKey,
} from "../SatReferenceSheetPanel";
import { satToolGeometryKey } from "../../../infrastructure/satToolGeometryStore";
import { loadSatToolViewState } from "../../../infrastructure/satToolStateStore";

const matchMediaMock = (matches: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (query: string) =>
        ({
          matches,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) satisfies MediaQueryList,
    ),
  );
};

const ids = { scheduleId: "sched-r04", attemptId: "attempt-r04", moduleAttemptId: "module-r04" };
const viewKey = satReferenceViewKey(ids.scheduleId, ids.attemptId, ids.moduleAttemptId);
const geometryKey = satToolGeometryKey(ids.scheduleId, ids.attemptId, ids.moduleAttemptId, "reference");

async function flushScrollRestore() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe("SatReferenceSheetPanel memory (R-04 Step 6)", () => {
  beforeEach(() => {
    matchMediaMock(false);
    window.localStorage.clear();
    vi.unstubAllGlobals();
    matchMediaMock(false);
  });
  it("close->reopen restores collapsed plus scroll plus clamped geometry", async () => {
    window.localStorage.setItem(
      geometryKey,
      JSON.stringify({ x: 700, y: 150, w: 666, h: 500, v: 2 }),
    );
    window.localStorage.setItem(
      viewKey,
      JSON.stringify({
        zoom: 1.25,
        scrollTop: 240,
        collapsed: true,
        scaleMode: "fit-width",
        hasBeenMoved: true,
        hasBeenResized: true,
        lastFocusedTool: null,
        toolHintSeen: {},
      }),
    );
    const first = render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    await flushScrollRestore();
    expect(screen.getByRole("button", { name: "Expand Reference Sheet" })).toBeInTheDocument();
    expect(screen.getByText("125%")).toBeInTheDocument();
    const scroller = document.querySelector("[data-sat-tool-scroll]") as HTMLElement;
    expect(scroller.scrollTop).toBe(240);
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog.style.width).toBe("666px");
    first.unmount();
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    await flushScrollRestore();
    expect(screen.getByRole("button", { name: "Expand Reference Sheet" })).toBeInTheDocument();
    expect(screen.getByText("125%")).toBeInTheDocument();
    expect((document.querySelector("[data-sat-tool-scroll]") as HTMLElement).scrollTop).toBe(240);
  });
  it("collapse->expand preserves rect and never persists collapsed height", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      geometryKey,
      JSON.stringify({ x: 300, y: 150, w: 666, h: 500, v: 2 }),
    );
    window.localStorage.setItem(
      viewKey,
      JSON.stringify({
        zoom: 1,
        scrollTop: 120,
        collapsed: false,
        scaleMode: "fit-width",
        hasBeenMoved: true,
        hasBeenResized: true,
        lastFocusedTool: null,
        toolHintSeen: {},
      }),
    );
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    await flushScrollRestore();
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const widthBefore = dialog.style.width;
    const leftBefore = dialog.style.left;
    await user.click(screen.getByRole("button", { name: "Collapse Reference Sheet" }));
    expect(screen.getByRole("button", { name: "Expand Reference Sheet" })).toBeInTheDocument();
    expect(loadSatToolViewState(viewKey).collapsed).toBe(true);
    const geomAfter = JSON.parse(window.localStorage.getItem(geometryKey) ?? "{}") as { h?: number };
    expect(geomAfter.h).not.toBeLessThan(320);
    await user.click(screen.getByRole("button", { name: "Expand Reference Sheet" }));
    expect(screen.getByRole("button", { name: "Collapse Reference Sheet" })).toBeInTheDocument();
    expect(loadSatToolViewState(viewKey).collapsed).toBe(false);
    expect(dialog.style.width).toBe(widthBefore);
    expect(dialog.style.left).toBe(leftBefore);
  });
  it("first-run composes top-right at the D3 size (R-06 fit-all height)", () => {
    const viewport = { w: 1280, h: 800 };
    const safeArea = { top: 112, right: 16, bottom: 86, left: 16 };
    const geom = defaultSatReferenceGeometry(viewport, safeArea);
    // R-06 B3: need(920) = 32 + 53 + ceil(560*920/1000) = 601; safeH 602 fits.
    expect(geom.w).toBe(920);
    expect(geom.h).toBe(601);
    expect(geom.x).toBe(1280 - 16 - 920);
    expect(geom.y).toBe(112);
    // R-06 B3: w0 = 672 needs 462 > safeH 402, so width shrinks to 566
    // (need(566) = 402 fits) — fit-all beats max-wide on short viewports.
    const narrow = defaultSatReferenceGeometry(
      { w: 768, h: 600 },
      { top: 112, right: 16, bottom: 86, left: 16 },
    );
    expect(narrow.w).toBe(566);
    expect(narrow.h).toBe(402);
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(Number.parseFloat(dialog.style.width)).toBeGreaterThanOrEqual(480);
  });
  it("clamp-not-reset folds a right-edge rect on shrink with flags untouched", async () => {
    window.localStorage.setItem(
      geometryKey,
      JSON.stringify({ x: 344, y: 112, w: 920, h: 500, v: 2 }),
    );
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog).toBeInTheDocument();
    // Settle the lazy observer baseline past the primitive saved-wins load
    // (system clamp) before dispatching the shrink — otherwise the initial
    // load trips the user-gesture pipeline under test timing.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const originalW = window.innerWidth;
    const originalH = window.innerHeight;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalW });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalH });
    }
    const stored = JSON.parse(window.localStorage.getItem(geometryKey) ?? "{}") as {
      x: number;
      w: number;
    };
    expect(stored.w).toBeLessThanOrEqual(920);
    expect(stored.x).toBeLessThanOrEqual(344);
    expect(loadSatToolViewState(viewKey).hasBeenMoved).toBe(false);
    expect(loadSatToolViewState(viewKey).hasBeenResized).toBe(false);
  });
  it("drag plus resize commits set manual-wins flags via merged write", async () => {
    const user = userEvent.setup();
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const leftBefore = Number.parseFloat(dialog.style.left || "0");
    const grip = screen.getByRole("button", { name: /Move Reference Sheet/ });
    grip.focus();
    await user.keyboard("{ArrowRight}");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(Number.parseFloat(dialog.style.left || "0")).toBe(leftBefore + 8);
    expect(loadSatToolViewState(viewKey).hasBeenMoved).toBe(true);
    // R-06 B1: the panel passes the Reference maxSize (>= default width),
    // so a keyboard resize step commits exactly instead of folding to the
    // legacy 620 defaultMaxSizeForViewport cap (no-snap proof at panel
    // level; the primitive no-jump test pins the 1px pointer path).
    const widthBefore = Number.parseFloat(dialog.style.width || "0");
    const separator = screen.getByRole("separator", { name: /Resize Reference Sheet/ });
    separator.focus();
    await user.keyboard("{ArrowRight}");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(Number.parseFloat(dialog.style.width || "0")).toBe(widthBefore + 8);
    expect(loadSatToolViewState(viewKey).hasBeenResized).toBe(true);
    const merged = loadSatToolViewState(viewKey);
    expect(merged.zoom).toBe(1);
    expect(merged.scaleMode).toBe("fit-width");
  });
  it("normalizes legacy sub-100-percent zoom to an honest fit value", () => {
    window.localStorage.setItem(
      viewKey,
      JSON.stringify({
        zoom: 0.75,
        scrollTop: 0,
        collapsed: false,
        scaleMode: "fit-width",
        hasBeenMoved: false,
        hasBeenResized: false,
        lastFocusedTool: null,
        toolHintSeen: {},
      }),
    );
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  });

  it("corrupt stores degrade without blocking the exam", async () => {
    window.localStorage.setItem(viewKey, "{not json");
    window.localStorage.setItem(geometryKey, JSON.stringify({ x: 300, y: 150, w: 666, h: 500, v: 2 }));
    const first = render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    await flushScrollRestore();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Reference Sheet" })).toBeInTheDocument();
    first.unmount();
    window.localStorage.clear();
    window.localStorage.setItem(geometryKey, "{not json");
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(Number.parseFloat(dialog.style.width)).toBeGreaterThanOrEqual(480);
  });

  it("scroll persist uses the merged write", () => {
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    const scroller = document.querySelector("[data-sat-tool-scroll]") as HTMLElement;
    scroller.scrollTop = 77;
    fireEvent.scroll(scroller);
    expect(loadSatToolViewState(viewKey).scrollTop).toBe(77);
  });

  // R-07 §8 memory fit vectors: fit opens whole-visible (scroll 0, hidden
  // overflow); zoom 1.5 pans (scrollable + persists); Fit sheet returns to
  // whole-visible. jsdom never lays out the stage (client 0), so the stage
  // hook falls back to { 1000, 560 } — fit = 1 there, exactly the vectors.
  it("fit opens whole-visible, zoom pans and persists, Fit sheet resets", async () => {
    const user = userEvent.setup();
    render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    await flushScrollRestore();
    const scroller = document.querySelector("[data-sat-tool-scroll]") as HTMLElement;
    // Fit default: nothing to scroll — hidden overflow, scroll 0.
    expect(scroller.style.overflow).toBe("hidden");
    expect(scroller.scrollTop).toBe(0);
    // Zoom 1.5 past fit: pan affordance appears and zoom persists.
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("150%")).toBeInTheDocument();
    expect(scroller.style.overflow).toBe("auto");
    expect(loadSatToolViewState(viewKey).zoom).toBeCloseTo(1.5);
    // Fit sheet: back to whole-visible, scroll cleared to 0.
    await user.click(screen.getByRole("button", { name: "Fit sheet" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(scroller.style.overflow).toBe("hidden");
    expect(scroller.scrollTop).toBe(0);
    // Persisted scrollTop is ignored at fit on reopen (not deleted): seed a
    // stale anchor with fit zoom and reopen — render still lands on 0 while
    // the store value is preserved for the next zoomed session.
    window.localStorage.setItem(
      viewKey,
      JSON.stringify({
        zoom: 1,
        scrollTop: 240,
        collapsed: false,
        scaleMode: "fit-width",
        hasBeenMoved: true,
        hasBeenResized: true,
        lastFocusedTool: null,
        toolHintSeen: {},
      }),
    );
    const { unmount } = render(<SatReferenceSheetPanel open onClose={() => undefined} {...ids} />);
    await flushScrollRestore();
    expect((document.querySelector("[data-sat-tool-scroll]") as HTMLElement).scrollTop).toBe(0);
    expect(loadSatToolViewState(viewKey).scrollTop).toBe(240);
    unmount();
  });

  it("pins the pre-R-04 left-edge heuristic", () => {
    expect(isPreR04LeftEdge(48, 1280, 16)).toBe(true);
    expect(isPreR04LeftEdge(49, 1280, 16)).toBe(true);
    expect(isPreR04LeftEdge(344, 1280, 16)).toBe(false);
    expect(isPreR04LeftEdge(Number.NaN, 1280, 16)).toBe(false);
  });
});
