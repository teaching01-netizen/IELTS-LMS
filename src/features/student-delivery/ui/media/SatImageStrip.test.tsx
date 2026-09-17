import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatImageStrip, type SatImageStripProps } from "./SatImageStrip";

function setup(overrides: Partial<SatImageStripProps> = {}) {
  const handlers = {
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    onToggleFullScreen: vi.fn(),
  };
  render(
    <SatImageStrip
      label="Graph of f"
      zoom={1}
      canZoomIn
      canZoomOut={false}
      dirty={false}
      fullScreen={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("SatImageStrip", () => {
  it("keeps the magnification group together and the readout beside the zoom pair", () => {
    setup({ zoom: 1.25, canZoomOut: true, dirty: true });
    const toolbar = screen.getByRole("toolbar", { name: "Figure controls: Graph of f" });
    expect(within(toolbar).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "",
      "",
      "Reset zoom",
      "Full screen",
    ]);
    const order = Array.from(toolbar.querySelectorAll("button, [role='status']")).map((element) =>
      element.getAttribute("data-sat-image-zoom-level") !== null
        ? "readout"
        : element.getAttribute("data-sat-image-zoom-in") !== null
          ? "in"
          : element.getAttribute("data-sat-image-zoom-out") !== null
            ? "out"
            : element.getAttribute("data-sat-image-reset") !== null
              ? "reset"
              : "full-screen",
    );
    expect(order).toEqual(["out", "in", "readout", "reset", "full-screen"]);
    // The divider is the architecture: everything left of it changes the graph
    // inside the viewport, everything right of it changes the viewport.
    const divider = toolbar.querySelector("span[aria-hidden='true']");
    if (!divider) throw new Error("no divider");
    expect(order.indexOf("reset")).toBeLessThan(order.indexOf("full-screen"));
    expect(divider.compareDocumentPosition(toolbar.querySelector("[data-sat-image-reset]")!)).toBeGreaterThan(0);
  });

  it("reports the magnification as status and confirmation, not as a bare number", () => {
    setup({ zoom: 1.25, canZoomOut: true, dirty: true });
    expect(screen.getByRole("status", { name: "Zoom level" })).toHaveTextContent("125%");
  });

  it("keeps Reset present but disabled at 100%, so the strip never shifts", () => {
    const handlers = setup({ zoom: 1, canZoomOut: false, dirty: false });
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    const zoomed = setup({ zoom: 1.5, canZoomOut: true, dirty: true });
    expect(screen.getAllByRole("button", { name: "Reset zoom" })[1]).toBeEnabled();
    expect(handlers.onReset).not.toHaveBeenCalled();
    expect(zoomed.onZoomIn).not.toHaveBeenCalled();
  });

  it("disables zoom in at the top of the range", () => {
    setup({ zoom: 3, canZoomIn: false, canZoomOut: true, dirty: true });
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  });

  it("names the full-screen control by what pressing it will do, and anchors focus to it", () => {
    setup({ fullScreen: false, fullScreenButtonId: "sat-enlarge-test" });
    const enter = screen.getByRole("button", { name: "Enter full screen" });
    expect(enter).toHaveAttribute("id", "sat-enlarge-test");
    // The drawn word stays "Full screen"; the spoken name carries the verb, and
    // the visible text is a substring of it, so the two can never disagree.
    expect(enter).toHaveAccessibleName("Enter full screen");
    expect(enter.textContent).toBe("Full screen");
    cleanup();
    setup({ fullScreen: true });
    expect(screen.getByRole("button", { name: "Exit full screen" })).toHaveTextContent(
      "Exit full screen",
    );
  });

  it("answers +, - and 0 from the strip itself", async () => {
    const user = userEvent.setup();
    const handlers = setup({ zoom: 1.25, canZoomOut: true, dirty: true });
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    zoomIn.focus();
    await user.keyboard("{+}");
    await user.keyboard("-");
    await user.keyboard("0");
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onReset).toHaveBeenCalledTimes(1);
  });

  it("calls the zoom pair and the full-screen toggle through their own controls", async () => {
    const user = userEvent.setup();
    const handlers = setup({ zoom: 1.25, canZoomOut: true, dirty: true });
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));
    expect(handlers.onZoomIn).toHaveBeenCalledTimes(1);
    expect(handlers.onZoomOut).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleFullScreen).toHaveBeenCalledTimes(1);
  });

  it("ignores keys that arrive from a text field", () => {
    const handlers = setup();
    const toolbar = screen.getByRole("toolbar");
    const field = document.createElement("input");
    toolbar.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: "+" });
    fireEvent.keyDown(field, { key: "0" });
    expect(handlers.onZoomIn).not.toHaveBeenCalled();
    expect(handlers.onReset).not.toHaveBeenCalled();
  });
});
