import { fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SatReferenceSheetPanel, satReferenceViewKey } from "../SatReferenceSheetPanel";
import { satToolGeometryKey } from "../../../infrastructure/satToolGeometryStore";
import { loadSatToolViewState } from "../../../infrastructure/satToolStateStore";

const ids = {
  scheduleId: "sheet-schedule",
  attemptId: "sheet-attempt",
  moduleAttemptId: "sheet-module",
};
const viewKey = satReferenceViewKey(ids.scheduleId, ids.attemptId, ids.moduleAttemptId);
const geometryKey = satToolGeometryKey(
  ids.scheduleId,
  ids.attemptId,
  ids.moduleAttemptId,
  "reference"
);
const props = { ...ids, onClose: vi.fn() };
async function settle() {
  await act(async () => {
    await new Promise(requestAnimationFrame);
  });
}
const scroller = () => screen.getByRole("region", { name: "Reference sheet content" });

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(560);
  vi.clearAllMocks();
});

describe("Reference sidebar memory", () => {
  it("ignores legacy floating geometry and collapse while restoring zoom and scroll", async () => {
    window.localStorage.setItem(
      geometryKey,
      JSON.stringify({ x: 700, y: 150, w: 666, h: 500, v: 2 })
    );
    window.localStorage.setItem(
      viewKey,
      JSON.stringify({ zoom: 1.25, scrollTop: 240, collapsed: true })
    );
    const { rerender } = render(<SatReferenceSheetPanel {...props} open />);
    await settle();
    const panel = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(panel).toHaveAttribute("data-sat-tool-presentation", "sidebar");
    expect(panel.style.left).toBe("");
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(scroller().scrollTop).toBe(240);
    rerender(<SatReferenceSheetPanel {...props} open={false} />);
    rerender(<SatReferenceSheetPanel {...props} open />);
    await settle();
    expect(scroller().scrollTop).toBe(240);
    expect(screen.getByText("125%")).toBeInTheDocument();
  });

  it("expands and restores the sidebar scroll, and reopening starts in sidebar mode", async () => {
    const { rerender } = render(<SatReferenceSheetPanel {...props} open />);
    await settle();
    scroller().scrollTop = 180;
    fireEvent.scroll(scroller());
    fireEvent.click(screen.getByRole("button", { name: "Expand Reference Sheet" }));
    await settle();
    expect(scroller().scrollTop).toBe(0);
    scroller().scrollTop = 99;
    fireEvent.scroll(scroller());
    expect(loadSatToolViewState(viewKey).scrollTop).toBe(180);
    fireEvent.click(screen.getByRole("button", { name: "Restore Reference Sheet" }));
    await settle();
    expect(scroller().scrollTop).toBe(180);
    fireEvent.click(screen.getByRole("button", { name: "Expand Reference Sheet" }));
    rerender(<SatReferenceSheetPanel {...props} open={false} />);
    rerender(<SatReferenceSheetPanel {...props} open />);
    expect(screen.getByRole("button", { name: "Expand Reference Sheet" })).toBeInTheDocument();
  });

  it("preserves unrelated view fields when zoom and scroll change", async () => {
    window.localStorage.setItem(
      viewKey,
      JSON.stringify({ toolHintSeen: { reference: true }, hasBeenMoved: true })
    );
    render(<SatReferenceSheetPanel {...props} open />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    scroller().scrollTop = 77;
    fireEvent.scroll(scroller());
    expect(loadSatToolViewState(viewKey)).toMatchObject({
      zoom: 1.25,
      scrollTop: 77,
      hasBeenMoved: true,
      toolHintSeen: { reference: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fit sheet" }));
    expect(scroller().scrollTop).toBe(0);
    expect(loadSatToolViewState(viewKey)).toMatchObject({ zoom: 1, scrollTop: 0 });
  });

  it("uses portrait ordering and retains every formula", () => {
    const { container } = render(<SatReferenceSheetPanel {...props} open />);
    const canvas = container.querySelector("[data-sat-ref-canvas]")!;
    expect(canvas).toHaveAttribute("data-sat-ref-layout", "portrait");
    const labels = [...canvas.children]
      .map(
        (node) =>
          (node.id === "sat-special-triangles" || node.querySelector("#sat-special-triangles")
            ? "Special Right Triangles"
            : node.getAttribute("aria-label")) ??
          node.querySelector(".sr-only")?.textContent?.trim()
      )
      .filter(Boolean);
    expect(labels).toEqual([
      "Circle.",
      "Rectangle.",
      "Triangle.",
      "Right triangle.",
      "Special Right Triangles",
      "Rectangular prism.",
      "Cylinder.",
      "Sphere.",
      "Cone.",
      "Rectangular pyramid.",
      "Angle and circle facts",
    ]);
    expect(canvas.querySelectorAll("math")).toHaveLength(11);
  });

  it("uses landscape only when expanded to at least 900 physical pixels", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    const { container } = render(<SatReferenceSheetPanel {...props} open />);
    expect(container.querySelector("[data-sat-ref-canvas]")).toHaveAttribute(
      "data-sat-ref-layout",
      "portrait"
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand Reference Sheet" }));
    expect(container.querySelector("[data-sat-ref-canvas]")).toHaveAttribute(
      "data-sat-ref-layout",
      "landscape"
    );
  });

  it("recovers corrupt storage and keeps keyboard zoom and closure accessible", async () => {
    window.localStorage.setItem(viewKey, "{not json");
    render(<SatReferenceSheetPanel {...props} open />);
    await settle();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    fireEvent.keyDown(scroller(), { key: "+", ctrlKey: true });
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.keyDown(scroller(), { key: "0", ctrlKey: true });
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.keyDown(scroller(), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("isolates scroll and zoom by module attempt", async () => {
    window.localStorage.setItem(viewKey, JSON.stringify({ zoom: 1.5, scrollTop: 240 }));
    const { rerender } = render(<SatReferenceSheetPanel {...props} open />);
    await settle();
    rerender(<SatReferenceSheetPanel {...props} moduleAttemptId="other-module" open />);
    await settle();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(scroller().scrollTop).toBe(0);
  });
});
