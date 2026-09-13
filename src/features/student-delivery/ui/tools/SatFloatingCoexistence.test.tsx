import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatFloatingTool } from "./SatFloatingTool";

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
        }) satisfies MediaQueryList
    )
  );
};

function pointer(target: HTMLElement, type: string, x: number, y: number, pointerId: number): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  (event as unknown as Record<string, unknown>).pointerId = pointerId;
  (event as unknown as Record<string, unknown>).isPrimary = true;
  fireEvent(target, event);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* Storage unavailable in this host; hint tests still run. */
  }
});

describe("SatFloatingTool", () => {
  it("renders two named tools side by side without trapping focus", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    render(
      <>
        <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
          <div>calc body</div>
        </SatFloatingTool>
        <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable onClose={() => undefined}>
          <div>ref body</div>
        </SatFloatingTool>
      </>
    );
    expect(screen.getByRole("dialog", { name: "Calculator" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Reference Sheet" })).toBeInTheDocument();
    expect(screen.getByText("calc body")).toBeInTheDocument();
    expect(screen.getByText("ref body")).toBeInTheDocument();
    // Non-modal: both expose Close and focus is not trapped.
    expect(screen.getByRole("button", { name: "Close Calculator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Reference Sheet" })).toBeInTheDocument();
    // Legacy e2e probe contract: window + presentation + resizable aliases.
    expect(screen.getByRole("dialog", { name: "Calculator" })).toHaveAttribute("data-sat-tool-window", "Calculator");
    expect(screen.getByRole("dialog", { name: "Calculator" })).toHaveAttribute("data-sat-tool-presentation", "floating");
    expect(screen.getByRole("dialog", { name: "Calculator" })).toHaveAttribute("data-sat-tool-resizable", "true");
    expect(screen.getByRole("dialog", { name: "Reference Sheet" })).toHaveAttribute("data-sat-tool-presentation", "floating");
    // C11 Reference-resizable flip (Phase 07 owns this file extension;
    // Phase 04 was told not to touch it): both tools share the same
    // move/resize shell, so Reference carries resizable true like Calculator.
    expect(screen.getByRole("dialog", { name: "Reference Sheet" })).toHaveAttribute("data-sat-tool-resizable", "true");
  });

  it("gives a resizable Reference the same eight-target move/resize shell (C11 parity)", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog).toHaveAttribute("data-sat-tool-resizable", "true");
    expect(dialog.querySelectorAll("[data-sat-resize-handle]").length).toBe(1);
    expect(dialog.querySelectorAll("[data-sat-resize-edge]").length).toBe(7);
  });

  it("moves via keyboard grip arrows", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(dialog.style.left).toBe("600px");
    const grip = screen.getByRole("button", { name: /Move Calculator/ });
    grip.focus();
    await user.keyboard("{ArrowLeft}");
    expect(dialog.style.left).toBe("592px");
    await user.keyboard("{ArrowDown}");
    expect(dialog.style.top).toBe("118px");
  });

  it("Escape closes the tool itself", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={onClose}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("tokenizes tool chrome: #5D6268-grade border, radius 6, 48px header, floating shadow", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(dialog.className).toContain("var(--sat-tool-border)");
    expect(dialog.className).toContain("rounded-[6px]");
    expect(dialog.className).toContain("var(--sat-shadow-floating)");
    expect(dialog.className).not.toContain("shadow-2xl");
    expect(dialog.className).not.toContain("rounded-[12px]");
    const header = dialog.querySelector("[data-sat-tool-header]");
    expect(header).not.toBeNull();
    // C1 contract change (Phase 01): header adopted 48px (h-12) per design
    // spec; 48px is a superset of the 44px a11y floor so no guarantee weakens.
    expect(header!.className).toContain("h-12");
    expect(header!.querySelector("[aria-label^=\"Move\" i]")).not.toBeNull();
    expect(dialog.querySelector("[data-sat-tool-close]")).not.toBeNull();
    // Probe contract survives the chrome swap.
    expect(dialog).toHaveAttribute("data-sat-tool-window", "Calculator");
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "floating");
  });

  it("keeps the compact bottom sheet undraggable by design", () => {
    matchMediaMock(true);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    expect(dialog.querySelector("[data-sat-tool-header]")).toBeNull();
    expect(dialog.querySelector("[data-sat-resize-handle]")).toBeNull();
  });

  it("renders nothing when closed", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Calculator" open={false} geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders exactly one resize-handle node plus seven edge layers (C10)", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(dialog.querySelectorAll("[data-sat-resize-handle]").length).toBe(1);
    const edges = dialog.querySelectorAll("[data-sat-resize-edge]");
    expect(edges.length).toBe(7);
    for (const value of ["n", "s", "e", "w", "ne", "nw", "sw"]) {
      expect(dialog.querySelector(`[data-sat-resize-edge="${value}"]`)).not.toBeNull();
    }
    // Edge layers are non-button pointer surfaces (C14): no role, no button.
    for (const edge of Array.from(edges)) {
      expect(edge.tagName.toLowerCase()).toBe("div");
      expect(edge.getAttribute("role")).toBeNull();
    }
  });

  it("uses grab cursors on the full title bar and keeps the compact sheet free of edges", () => {
    matchMediaMock(false);
    const { unmount } = render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    const header = dialog.querySelector("[data-sat-tool-header]");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("cursor-grab");
    expect(header!.className).not.toContain("cursor-move");
    unmount();
    matchMediaMock(true);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const compactDialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(compactDialog.querySelectorAll("[data-sat-resize-edge]").length).toBe(0);
    expect(compactDialog.querySelector("[data-sat-tool-hint]")).toBeNull();
  });

  it("ignores sub-threshold drags and tracks live drags 1:1 without scale (C12)", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    const header = dialog.querySelector("[data-sat-tool-header]") as HTMLElement;
    expect(dialog.style.left).toBe("600px");
    expect(dialog.style.top).toBe("110px");
    pointer(header, "pointerdown", 700, 120, 1);
    pointer(header, "pointermove", 701, 121, 1);
    pointer(header, "pointerup", 701, 121, 1);
    expect(dialog.style.left).toBe("600px");
    expect(dialog.style.top).toBe("110px");
    pointer(header, "pointerdown", 700, 120, 2);
    pointer(header, "pointermove", 750, 150, 2);
    expect(dialog.style.left).toBe("650px");
    expect(dialog.style.top).toBe("140px");
    expect(dialog.style.transform).toBe("");
    pointer(header, "pointerup", 750, 150, 2);
  });

  it("cancels an in-progress drag on Escape and restores the pre-drag rect", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    const header = dialog.querySelector("[data-sat-tool-header]") as HTMLElement;
    pointer(header, "pointerdown", 700, 120, 3);
    pointer(header, "pointermove", 760, 180, 3);
    expect(dialog.style.left).toBe("660px");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog.style.left).toBe("600px");
    expect(dialog.style.top).toBe("110px");
  });

  it("applies zero transition to size during resize and keeps the SE keyboard contract", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 60, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    const grip = screen.getByRole("separator", { name: /Resize Calculator/ });
    pointer(grip as HTMLElement, "pointerdown", 480, 630, 4);
    // rAF-throttled resize reports the resizing state immediately.
    await waitFor(() => expect(dialog).toHaveAttribute("data-sat-resizing", "true"));
    pointer(grip as HTMLElement, "pointerup", 480, 630, 4);
    grip.focus();
    await user.keyboard("{ArrowRight}");
    expect(dialog.style.width).toBe("428px");
  });

  it("hard-stops resize at the content minimum (no bounce)", () => {
    matchMediaMock(false);
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    try {
      render(
        <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 60, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
          <div>calc body</div>
        </SatFloatingTool>
      );
      const dialog = screen.getByRole("dialog", { name: "Calculator" });
      const west = dialog.querySelector("[data-sat-resize-edge=w]") as HTMLElement;
      pointer(west, "pointerdown", 100, 300, 5);
      pointer(west, "pointermove", 400, 300, 5);
      act(() => {
        while (rafCallbacks.length > 0) rafCallbacks.shift()?.(0);
      });
      // Calculator minimum width is 400px: 200px+ past the stop stays pinned.
      expect(dialog.style.width).toBe("400px");
      pointer(west, "pointerup", 400, 300, 5);
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("shows the first-open hint once and dismisses it after the first drag", () => {
    matchMediaMock(false);
    const { unmount } = render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    const hint = dialog.querySelector("[data-sat-tool-hint]");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain("Drag the top to move");
    expect(hint!.getAttribute("aria-hidden")).toBe("true");
    expect(hint!.className).toContain("sat-tool-hint");
    const header = dialog.querySelector("[data-sat-tool-header]") as HTMLElement;
    pointer(header, "pointerdown", 700, 120, 6);
    pointer(header, "pointermove", 760, 180, 6);
    pointer(header, "pointerup", 760, 180, 6);
    expect(dialog.querySelector("[data-sat-tool-hint]")).toBeNull();
    unmount();
    // Reopen with the seen flag persisted: the hint never returns.
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    expect(screen.getByRole("dialog", { name: "Calculator" }).querySelector("[data-sat-tool-hint]")).toBeNull();
  });

  it("labels Move and Resize tooltips without importing the shared tooltip primitive (C16)", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const grip = screen.getByRole("button", { name: /Move Calculator/ });
    expect(grip.parentElement?.querySelector(".sat-tool-tip")?.textContent).toContain("Move Calculator");
    const separator = screen.getByRole("separator", { name: /Resize Calculator/ });
    expect(separator.querySelector(".sat-tool-tip")?.textContent).toContain("Resize Calculator");
  });
});

describe("SatFloatingTool reference variant (R-01 Bluebook chrome, append-only)", () => {
  it("renders the 32px black Reference header: h-8, 12px truncated white title, variant probes", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    // R-01 frame contract: variant probes + square white paper.
    expect(dialog).toHaveAttribute("data-sat-tool-variant", "reference");
    expect(dialog.className).toContain("sat-tool-ref");
    expect(dialog.className).toContain("rounded-none");
    expect(dialog.className).not.toContain("rounded-[6px]");
    expect(dialog.className).toContain("var(--sat-ref-border)");
    const header = dialog.querySelector("[data-sat-tool-header]");
    expect(header).not.toBeNull();
    // 32px header (h-8), never the shared 48px (h-12) Calculator bar.
    expect(header!.className).toContain("h-8");
    expect(header!.className).not.toContain("h-12");
    expect(header!.className).toContain("var(--sat-ref-header-bg)");
    const title = header!.querySelector("span.min-w-0");
    expect(title).not.toBeNull();
    expect(title!.className).toContain("text-[12px]");
    expect(title!.className).toContain("truncate");
    const wrapper = dialog.querySelector("#reference-sheet-content");
    expect(wrapper).not.toBeNull();
  });

  it("exposes presence-only Collapse + 32px Close with the 4.2 ARIA/probe contract (no behavior)", () => {
    matchMediaMock(false);
    const onToggleCollapse = vi.fn();
    const { rerender } = render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable onToggleCollapse={onToggleCollapse} onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const collapse = screen.getByRole("button", { name: "Collapse Reference Sheet" });
    const close = screen.getByRole("button", { name: "Close Reference Sheet" });
    // R-06 B2: 32x32 hit areas (h-8 w-8) fit the 32px header — no clipped
    // strips; D2 carve-out stands (names unchanged, 16px inner icons kept).
    // The Move grip shares the same 32px row (3rd control-size assert).
    const grip = screen.getByRole("button", { name: /Move Reference Sheet/ });
    expect(grip.className).toContain("h-8");
    expect(grip.className).toContain("w-8");
    expect(collapse.className).toContain("h-8");
    expect(collapse.className).toContain("w-8");
    expect(close.className).toContain("h-8");
    expect(close.className).toContain("w-8");
    expect(collapse.className).not.toContain("h-9");
    expect(close.className).not.toContain("h-9");
    // Presence-only contract: aria-expanded mirrors collapsed, controls pins
    // the content id, probe carries no count contract.
    // (R-03 D6 behavioral wiring: expanded=true while open, false while
    // collapsed. R-01 asserted the inverse polarity; D6 + E12 are binding.)
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse).toHaveAttribute("aria-controls", "reference-sheet-content");
    expect(collapse).toHaveAttribute("data-sat-tool-collapse");
    rerender(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable collapsed onToggleCollapse={onToggleCollapse} onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    expect(screen.getByRole("button", { name: "Expand Reference Sheet" })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the decorative 9-dot cue aria-hidden with no role/tabIndex, and Move arrows still move", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const dots = dialog.querySelector(".sat-ref-dotgrip");
    expect(dots).not.toBeNull();
    expect(dots!.getAttribute("aria-hidden")).toBe("true");
    expect(dots!.getAttribute("role")).toBeNull();
    expect(dots!.querySelectorAll("i").length).toBe(9);
    expect(dialog.querySelector(".sat-ref-dotgrip [tabindex]")).toBeNull();
    const grip = screen.getByRole("button", { name: /Move Reference Sheet/ });
    expect(grip.getAttribute("aria-label")).toContain("Use arrow keys to move");
    expect(dialog.style.left).toBe("48px");
    grip.focus();
    await user.keyboard("{ArrowLeft}");
    expect(dialog.style.left).toBe("40px");
  });

  it("reuses all 8 resize targets for Reference: SE separator contract + 7 role-less edges", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog.querySelectorAll("[data-sat-resize-handle]").length).toBe(1);
    const edges = dialog.querySelectorAll("[data-sat-resize-edge]");
    expect(edges.length).toBe(7);
    for (const value of ["n", "s", "e", "w", "ne", "nw", "sw"]) {
      expect(dialog.querySelector(`[data-sat-resize-edge="${value}"]`)).not.toBeNull();
    }
    for (const edge of Array.from(edges)) {
      expect(edge.tagName.toLowerCase()).toBe("div");
      expect(edge.getAttribute("role")).toBeNull();
    }
    // SE keeps the separator role + Resize label + arrow-key contract.
    const grip = screen.getByRole("separator", { name: /Resize Reference Sheet/ });
    expect(grip.getAttribute("aria-label")).toContain("Use arrow keys to resize");
    grip.focus();
    await user.keyboard("{ArrowRight}");
    // R-06 B5: the stale 360x420 fallback is now the D3 480x320 minimum, so
    // the 380-wide mount clamps to min.w 480 on the first commit and the
    // +8 ArrowRight step applies on the next commit (user-event sends one
    // keydown per await; the clamp consumes this one).
    expect(dialog.style.width).toBe("480px");
    await user.keyboard("{ArrowRight}");
    expect(dialog.style.width).toBe("488px");
  });

  it("resize never snaps for Reference: 1px SE drag moves ~1px (R-06 B1 no-jump, pointer)", async () => {
    matchMediaMock(false);
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    try {
      // Mount at the fit-all default with the Reference maxSize passed (as
      // the panel does): without maxSize the legacy 620/48vw fallback would
      // snap this 920-wide window ~300px narrower on the first commit.
      const { resolveSatToolMaxSize } = await import("../../domain/satToolSizePolicy");
      const maxSize = resolveSatToolMaxSize("reference", { w: 1248, h: 602 });
      render(
        <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 920, h: 601 }} minSize={{ w: 480, h: 320 }} maxSize={maxSize} resizable onClose={() => undefined}>
          <div>ref body</div>
        </SatFloatingTool>
      );
      const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
      const w0 = Number.parseFloat(dialog.style.width);
      expect(w0).toBe(920);
      const grip = screen.getByRole("separator", { name: /Resize Reference Sheet/ }) as HTMLElement;
      pointer(grip, "pointerdown", 968, 711, 41);
      pointer(grip, "pointermove", 969, 712, 41); // +1/+1 SE drag
      act(() => {
        while (rafCallbacks.length > 0) rafCallbacks.shift()?.(0);
      });
      const w1 = Number.parseFloat(dialog.style.width);
      expect(Math.abs(w1 - (w0 + 1))).toBeLessThanOrEqual(2); // rounding only, never a ~300px snap
      pointer(grip, "pointerup", 969, 712, 41);
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("resize never snaps for Reference: keyboard step commits exactly (R-06 B1 no-jump, keyboard)", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    const { resolveSatToolMaxSize } = await import("../../domain/satToolSizePolicy");
    const maxSize = resolveSatToolMaxSize("reference", { w: 1248, h: 602 });
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 920, h: 601 }} minSize={{ w: 480, h: 320 }} maxSize={maxSize} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const grip = screen.getByRole("separator", { name: /Resize Reference Sheet/ });
    grip.focus();
    await user.keyboard("{ArrowRight}");
    expect(dialog.style.width).toBe("920px"); // max folds at the cap, no downward snap
    await user.keyboard("{ArrowLeft}");
    expect(dialog.style.width).toBe("912px"); // exact -8 step proves the max pipeline holds
  });

  it("keeps probes intact for Reference: window + presentation + resizable + floating-tool", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog).toHaveAttribute("data-sat-tool-window", "Reference Sheet");
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "floating");
    expect(dialog).toHaveAttribute("data-sat-tool-resizable", "true");
    expect(dialog).toHaveAttribute("data-sat-floating-tool", "Reference Sheet");
  });

  it("Calculator zero-drift (D1 proof): h-12 chrome, 44px close, no variant/collapse/dotgrip", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable headerControls={<span data-testid="calc-controls">mode</span>} onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    // No variant leakage into Calculator.
    expect(dialog).not.toHaveAttribute("data-sat-tool-variant");
    expect(dialog.className).not.toContain("sat-tool-ref");
    expect(dialog.querySelector("[data-sat-tool-collapse]")).toBeNull();
    expect(dialog.querySelector(".sat-ref-dotgrip")).toBeNull();
    expect(dialog.querySelector("#reference-sheet-content")).toBeNull();
    // Calculator chrome byte-identical: h-12 header, GripVertical 18px, 44px close.
    const header = dialog.querySelector("[data-sat-tool-header]");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("h-12");
    expect(header!.className).not.toContain("h-8");
    const close = screen.getByRole("button", { name: "Close Calculator" });
    expect(close.className).toContain("h-11");
    expect(close.className).toContain("w-11");
    expect(screen.getByTestId("calc-controls")).toBeInTheDocument();
    // Tokenized paper from the pinned contract (C1/C10): tool border +
    // 6px radius + floating shadow, never the card set.
    expect(dialog.className).toContain("var(--sat-tool-border)");
    expect(dialog.className).toContain("rounded-[6px]");
    expect(dialog.className).toContain("var(--sat-shadow-floating)");
    expect(dialog.className).not.toContain("shadow-2xl");
    expect(dialog.className).not.toContain("rounded-[12px]");
    expect(dialog.className).not.toContain("rounded-none");
  });

  it("compact Reference keeps the diff-zero sheet: no header/collapse/edges", () => {
    matchMediaMock(true);
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    expect(dialog.querySelector("[data-sat-tool-header]")).toBeNull();
    expect(dialog.querySelector("[data-sat-tool-collapse]")).toBeNull();
    expect(dialog.querySelector("[data-sat-resize-handle]")).toBeNull();
    expect(dialog.querySelectorAll("[data-sat-resize-edge]").length).toBe(0);
  });

describe("R-03 reference collapse + motion (append-only; R-01 asserts above untouched)", () => {
  function renderReference(children?: React.ReactNode) {
    return render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 666, h: 458 }} resizable onClose={() => undefined}>
        {children ?? (
          <div data-sat-tool-scroll style={{ height: 300, overflowY: "auto" }}>
            <div style={{ height: 1200 }}>doc</div>
          </div>
        )}
      </SatFloatingTool>
    );
  }

  // T1 — Collapse round-trip preserves everything (Reference, desktop).
  it("collapses to header height and restores x/y/w/h/scroll exactly", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    renderReference();
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const body = dialog.querySelector("#reference-sheet-content") as HTMLElement;
    const scroll = dialog.querySelector("[data-sat-tool-scroll]") as HTMLElement;
    scroll.scrollTop = 220;
    const before = { l: dialog.style.left, t: dialog.style.top, w: dialog.style.width, h: dialog.style.height };
    const collapse = screen.getByRole("button", { name: /Collapse Reference Sheet/i });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse).toHaveAttribute("aria-controls", "reference-sheet-content");
    await user.click(collapse);
    expect(dialog).toHaveAttribute("data-collapsed", "true");
    expect(dialog.style.transform).toBe(""); // D4 extends C12 to collapse
    expect(dialog.style.left).toBe(before.l);
    expect(dialog.style.top).toBe(before.t);
    expect(dialog.style.width).toBe(before.w);
    // Collapsed height is the header strip (<= 32px fallback + border),
    // strictly less than the open height.
    expect(Number.parseFloat(dialog.style.height)).toBeLessThan(Number.parseFloat(before.h));
    expect(Number.parseFloat(dialog.style.height)).toBeLessThanOrEqual(33);
    // Motion classes: collapsing during the staged animation, settled after.
    expect(dialog.className).toContain("sat-ref-collapsing");
    fireEvent.animationEnd(body);
    expect(dialog.className).toContain("sat-ref-collapsed");
    expect(body.hidden).toBe(true);
    const expand = screen.getByRole("button", { name: /Expand Reference Sheet/i });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(expand).toHaveAttribute("aria-label", "Expand Reference Sheet");
    await user.click(expand);
    expect(dialog).not.toHaveAttribute("data-collapsed");
    expect(dialog.style.transform).toBe("");
    fireEvent.animationEnd(body);
    // Exact restore: position/size/scroll pixel-equal, no stuck classes.
    expect(dialog.style.left).toBe(before.l);
    expect(dialog.style.top).toBe(before.t);
    expect(dialog.style.width).toBe(before.w);
    expect(dialog.style.height).toBe(before.h);
    expect(body.hidden).toBe(false);
    expect(dialog.className).not.toContain("sat-ref-collapsed");
    expect(dialog.className).not.toContain("sat-ref-collapsing");
    expect((dialog.querySelector("[data-sat-tool-scroll]") as HTMLElement).scrollTop).toBe(220);
  });

  // T2 — Escape matrix (both tools; D5 documented contract change).
  it.each([["Calculator", 1]] as const)("Escape closes idle %s (D5: Calculator path unchanged)", async (title, calls) => {
    matchMediaMock(false);
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SatFloatingTool title={title} open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={onClose}><div>body</div></SatFloatingTool>);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(calls);
  });

  it("Escape is a no-op when Reference is idle (D5 contract change 2026-09-12: timed-exam safety; close stays explicit via X)", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 666, h: 458 }} resizable onClose={onClose}><div>body</div></SatFloatingTool>);
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const collapse = screen.getByRole("button", { name: /Collapse Reference Sheet/i });
    collapse.focus();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    expect(dialog).not.toHaveAttribute("data-collapsed"); // idle Escape never toggles collapse
    expect(document.activeElement).toBe(collapse); // E11: focus stability
    expect(collapse).toHaveAttribute("aria-expanded", "true");
  });

  it("Escape still cancels drag AND resize for Reference (gesture-cancel preserved)", async () => {
    matchMediaMock(false);
    const onClose = vi.fn();
    render(<SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 666, h: 458 }} resizable onClose={onClose}><div>ref body</div></SatFloatingTool>);
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const header = dialog.querySelector("[data-sat-tool-header]") as HTMLElement;
    pointer(header, "pointerdown", 200, 120, 11);
    pointer(header, "pointermove", 260, 180, 11);
    expect(dialog.style.left).toBe("108px");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog.style.left).toBe("48px");
    expect(dialog.style.top).toBe("110px");
    expect(onClose).not.toHaveBeenCalled();
    pointer(header, "pointerup", 260, 180, 11);
    // Resize half: SE pointerdown -> rAF flush -> Escape restores origin.
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    try {
      const grip = screen.getByRole("separator", { name: /Resize Reference Sheet/ }) as HTMLElement;
      const beforeW = dialog.style.width;
      pointer(grip, "pointerdown", 714, 568, 12);
      pointer(grip, "pointermove", 794, 648, 12);
      act(() => {
        while (rafCallbacks.length > 0) rafCallbacks.shift()?.(0);
      });
      expect(dialog.style.width).not.toBe(beforeW);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(dialog.style.width).toBe(beforeW);
      expect(onClose).not.toHaveBeenCalled();
      pointer(grip, "pointerup", 794, 648, 12);
    } finally {
      rafSpy.mockRestore();
    }
  });

  // T3 — Motion-token asserts (D9 / C4). Stylesheet-content assert via
  // readFileSync (repo pattern: satWaveB/satContractsCss) — jsdom cannot
  // compute animation-duration reliably.
  it("stages collapse in CSS tokens with animation-delay sequencing", async () => {
    const css = readFileSync(resolve(__dirname, "../../../../index.css"), "utf8");
    expect(css).toContain("--sat-ref-collapse: 180ms");
    expect(css).toContain("--sat-ref-collapse-fade");
    expect(css).toContain("--sat-ref-collapse-clip");
    expect(css).toContain("--sat-ref-collapse-ease");
    expect(css).toContain("animation-delay: var(--sat-ref-collapse-fade)");
    expect(css).toContain("@keyframes sat-ref-fade-out");
    expect(css).toContain("@keyframes sat-ref-clip-out");
    // TSX half rides the existing no-ms-in-TSX bans test (bluebookBans.test.ts);
    // this pins the CSS side without inventing a new harness.
  });

  // T4 — Anchor stability (resize keeps visible position; jsdom has no layout
  // so scrollHeight/clientHeight stay 0 — assert the absolute fallback + the
  // no-throw contract here; R-05 re-proves ratio precision in a real browser).
  it("preserves scrollTop across south-edge resize (Reference absolute fallback)", async () => {
    matchMediaMock(false);
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    try {
      renderReference();
      const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
      const scroll = dialog.querySelector("[data-sat-tool-scroll]") as HTMLElement;
      scroll.scrollTop = 220; // jsdom: layout is 0 so ratio is null -> absolute fallback
      const south = dialog.querySelector("[data-sat-resize-edge=s]") as HTMLElement;
      const rect = south.getBoundingClientRect();
      const startX = rect.left || 300;
      const startY = rect.top || 400;
      pointer(south, "pointerdown", startX, startY, 21);
      pointer(south, "pointermove", startX, startY + 80, 21);
      act(() => {
        while (rafCallbacks.length > 0) rafCallbacks.shift()?.(0);
      });
      // Flush the anchor-restore rAF queued by commitResizePoint.
      act(() => {
        while (rafCallbacks.length > 0) rafCallbacks.shift()?.(0);
      });
      expect(scroll.scrollTop).toBe(220);
      pointer(south, "pointerup", startX, startY + 80, 21);
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("keeps horizontal-only resize off the scroll anchor (no jitter)", async () => {
    matchMediaMock(false);
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    try {
      renderReference();
      const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
      const scroll = dialog.querySelector("[data-sat-tool-scroll]") as HTMLElement;
      scroll.scrollTop = 123;
      const beforeH = dialog.style.height;
      const east = dialog.querySelector("[data-sat-resize-edge=e]") as HTMLElement;
      const rect = east.getBoundingClientRect();
      const startX = rect.left || 500;
      const startY = rect.top || 300;
      pointer(east, "pointerdown", startX, startY, 22);
      pointer(east, "pointermove", startX + 60, startY, 22);
      act(() => {
        while (rafCallbacks.length > 0) rafCallbacks.shift()?.(0);
      });
      expect(dialog.style.height).toBe(beforeH);
      expect(scroll.scrollTop).toBe(123);
      pointer(east, "pointerup", startX + 60, startY, 22);
    } finally {
      rafSpy.mockRestore();
    }
  });

  // E1 — Collapse-while-dragging defers until settle (cancel + commit paths).
  it("defers collapse-while-dragging: Escape cancels first, then collapse settles", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    renderReference();
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const body = dialog.querySelector("#reference-sheet-content") as HTMLElement;
    const header = dialog.querySelector("[data-sat-tool-header]") as HTMLElement;
    pointer(header, "pointerdown", 200, 120, 31);
    pointer(header, "pointermove", 260, 180, 31); // live drag
    await user.click(screen.getByRole("button", { name: /Collapse Reference Sheet/i }));
    expect(dialog).not.toHaveAttribute("data-collapsed"); // deferred
    fireEvent.keyDown(document, { key: "Escape" }); // cancel-then-collapse order
    expect(dialog.style.left).toBe("48px");
    expect(dialog).toHaveAttribute("data-collapsed", "true");
    fireEvent.animationEnd(body);
    expect(dialog.className).toContain("sat-ref-collapsed");
    pointer(header, "pointerup", 260, 180, 31);
  });

  it("defers collapse-while-dragging through commit (pointerup settles first)", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    renderReference();
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const body = dialog.querySelector("#reference-sheet-content") as HTMLElement;
    const header = dialog.querySelector("[data-sat-tool-header]") as HTMLElement;
    pointer(header, "pointerdown", 200, 120, 32);
    pointer(header, "pointermove", 208, 128, 32); // live drag (+8/+8)
    await user.click(screen.getByRole("button", { name: /Collapse Reference Sheet/i }));
    expect(dialog).not.toHaveAttribute("data-collapsed");
    pointer(header, "pointerup", 208, 128, 32); // commit -> pending toggle fires
    expect(dialog).toHaveAttribute("data-collapsed", "true");
    fireEvent.animationEnd(body);
    expect(dialog.style.left).toBe("56px");
    expect(dialog.style.top).toBe("118px");
  });

  // E2 — Collapse-while-resizing defers; north-edge while collapsed retargets open geometry.
  it("defers collapse-while-resizing and retargets north-edge resize while collapsed", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    try {
      renderReference();
      const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
      const body = dialog.querySelector("#reference-sheet-content") as HTMLElement;
      const grip = screen.getByRole("separator", { name: /Resize Reference Sheet/ }) as HTMLElement;
      const beforeH = dialog.style.height;
      pointer(grip, "pointerdown", 714, 568, 33);
      await user.click(screen.getByRole("button", { name: /Collapse Reference Sheet/i }));
      expect(dialog).not.toHaveAttribute("data-collapsed"); // deferred (pre-commit session)
      pointer(grip, "pointerup", 714, 568, 33); // settle -> pending toggle fires
      expect(dialog).toHaveAttribute("data-collapsed", "true");
      fireEvent.animationEnd(body);
      const stripH = dialog.style.height;
      expect(Number.parseFloat(stripH)).toBeLessThan(Number.parseFloat(beforeH));
      // North-edge drag while collapsed: strip stays constant, open rect grows.
      const north = dialog.querySelector("[data-sat-resize-edge=n]") as HTMLElement;
      const rect = north.getBoundingClientRect();
      const startX = rect.left || 300;
      const startY = rect.top || 110;
      pointer(north, "pointerdown", startX, startY, 34);
      pointer(north, "pointermove", startX, startY - 40, 34);
      act(() => {
        while (rafCallbacks.length > 0) rafCallbacks.shift()?.(0);
      });
      expect(dialog.style.height).toBe(stripH); // E9: strip constant
      pointer(north, "pointerup", startX, startY - 40, 34);
      await user.click(screen.getByRole("button", { name: /Expand Reference Sheet/i }));
      fireEvent.animationEnd(body);
      // Expand reveals the retargeted open height (taller than before).
      expect(Number.parseFloat(dialog.style.height)).toBeGreaterThan(Number.parseFloat(beforeH));
    } finally {
      rafSpy.mockRestore();
    }
  });

  // T5 — Compact + disabled + rapid-toggle + unmount guards (E4-E7).
  it("compact masks collapse: no button, no data-collapsed, full sheet", async () => {
    matchMediaMock(true);
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog.querySelector("[data-sat-tool-collapse]")).toBeNull();
    expect(dialog).not.toHaveAttribute("data-collapsed");
    expect(dialog.querySelector("#reference-sheet-content")).toBeNull(); // compact sheet has no desktop body id
    expect(dialog.textContent).toContain("ref body");
  });

  it("disabled collapse is a no-op (E5)", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 666, h: 458 }} resizable disabled onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    await user.click(screen.getByRole("button", { name: /Collapse Reference Sheet/i }));
    expect(dialog).not.toHaveAttribute("data-collapsed");
  });

  it("rapid toggle reverses direction: last intent wins, collapsing clears (E6)", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    renderReference();
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    const body = dialog.querySelector("#reference-sheet-content") as HTMLElement;
    await user.click(screen.getByRole("button", { name: /Collapse Reference Sheet/i }));
    expect(dialog).toHaveAttribute("data-collapsed", "true");
    await user.click(screen.getByRole("button", { name: /Expand Reference Sheet/i }));
    expect(dialog).not.toHaveAttribute("data-collapsed");
    fireEvent.animationEnd(body); // single settle clears the transient flag
    expect(dialog.className).not.toContain("sat-ref-collapsing");
    expect(dialog.className).not.toContain("sat-ref-expanding");
    expect(dialog.className).not.toContain("sat-ref-collapsed");
    expect(screen.getByRole("button", { name: /Collapse Reference Sheet/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("close mid-collapse reopens clean: no stuck classes, no act warnings (E7)", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    const { rerender, unmount } = render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 666, h: 458 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    await user.click(screen.getByRole("button", { name: /Collapse Reference Sheet/i }));
    rerender(
      <SatFloatingTool title="Reference Sheet" open={false} geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 666, h: 458 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 666, h: 458 }} resizable onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog.className).not.toContain("sat-ref-collapsing");
    expect(dialog.className).not.toContain("sat-ref-collapsed");
    expect(dialog).not.toHaveAttribute("data-collapsed");
    unmount();
  });

  it("Calculator zero-drift for R-03: no collapse attrs/classes, Escape still closes", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={onClose}><div>calc body</div></SatFloatingTool>);
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(dialog.querySelector("[data-sat-tool-collapse]")).toBeNull();
    expect(dialog).not.toHaveAttribute("data-collapsed");
    expect(dialog.className).not.toContain("sat-ref-");
    expect(dialog.querySelector(".sat-ref-collapsible")).toBeNull();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

  it("keepAlive-closed and disabled branches stay frozen for Reference", () => {
    matchMediaMock(false);
    const { unmount } = render(
      <SatFloatingTool title="Reference Sheet" open={false} geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} keepAlive onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    // keepAlive closed renders the hidden tree, never a dialog.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
    render(
      <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} resizable disabled onClose={() => undefined}>
        <div>ref body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog).toHaveAttribute("inert");
    expect(dialog.className).toContain("opacity-70");
    expect(screen.getByRole("button", { name: "Collapse Reference Sheet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close Reference Sheet" })).toBeDisabled();
  });
});
