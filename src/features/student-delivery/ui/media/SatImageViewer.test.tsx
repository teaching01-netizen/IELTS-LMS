import { describe, expect, it } from "vitest";
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  SAT_IMAGE_ENLARGE_FIT_VIEW,
  type SatImageEnlargeGeometry,
  type SatImageEnlargeView,
} from "../../../exam-rendering/api/structuredContentEnlarge";
import { SatContrastContext } from "../reading/SatContrastContext";
import { SatImageViewer } from "./SatImageViewer";

const GEOMETRY: SatImageEnlargeGeometry = {
  viewport: { width: 200, height: 200 },
  image: { width: 200, height: 200 },
  natural: { width: 400, height: 400 },
};

function Harness({ initialView = SAT_IMAGE_ENLARGE_FIT_VIEW }: { initialView?: SatImageEnlargeView }) {
  const [view, setView] = useState<SatImageEnlargeView>(initialView);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Full screen
      </button>
      <output data-testid="view">{view.zoom + ":" + view.offsetX + ":" + view.offsetY}</output>
      <SatImageViewer
        src="https://example.com/graph.png"
        alt="Graph of f"
        open={open}
        onClose={() => setOpen(false)}
        view={view}
        geometry={GEOMETRY}
        onViewChange={setView}
        returnFocusSelector="#opener"
      />
    </>
  );
}

describe("SatImageViewer", () => {
  it("renders nothing when closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("presents the same view in a larger window, then hands focus back on exit", async () => {
    const user = userEvent.setup();
    render(<Harness initialView={{ zoom: 1.5, offsetX: 0, offsetY: 0 }} />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    expect(within(dialog).getByRole("status")).toHaveTextContent("150%");
    expect(screen.getByRole("img", { name: "Graph of f" })).toHaveAttribute(
      "src",
      "https://example.com/graph.png",
    );
    // The zoomed image carries the shared view straight through.
    expect(screen.getByTestId("sat-image-viewer").querySelector("img")).toHaveStyle({
      transform: "translate(0px, 0px) scale(1.5)",
    });
    await user.click(within(dialog).getByRole("button", { name: "Exit full screen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full screen" })).toHaveFocus();
  });

  it("zooms and resets from its own strip while the layer is up", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    await user.click(within(dialog).getByRole("button", { name: "Zoom in" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("125%");
    await user.click(within(dialog).getByRole("button", { name: "Reset zoom" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("100%");
  });

  it("zooms at the cursor on a modified wheel, and leaves a plain wheel to the page", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const viewport = document.querySelector("[data-sat-image-viewport]");
    if (!viewport) throw new Error("no viewport");
    fireEvent.wheel(viewport, { deltaY: 120, clientX: 40, clientY: 40 });
    expect(screen.getByTestId("view")).toHaveTextContent("1:0:0");
    fireEvent.wheel(viewport, { deltaY: -120, clientX: 40, clientY: 40, ctrlKey: true });
    expect(screen.getByTestId("view")).toHaveTextContent("1.25:0:0");
  });

  it("zooms where the student double-clicks inside the pane", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const viewport = document.querySelector("[data-sat-image-viewport]");
    if (!viewport) throw new Error("no viewport");
    fireEvent.doubleClick(viewport, { clientX: 12, clientY: 30 });
    expect(screen.getByTestId("view")).toHaveTextContent("1.25:0:0");
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("125%");
  });

  it("keeps the pane's zoom transition off until the pane has measured itself", async () => {
    const user = userEvent.setup();
    render(<Harness initialView={{ zoom: 1.5, offsetX: 0, offsetY: 0 }} />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    // jsdom reports a zero-sized pane, so this asserts the guard rather than the
    // animation: an unmeasured pane must not ease the view from the embedded
    // window's pixels into its own.
    const image = screen.getByTestId("sat-image-viewer").querySelector("img");
    expect(image?.className).not.toContain("sat-figure-zoom");
  });

  it("offers the pane's pan a keyboard equivalent, named for the figure it shows", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const pane = document.querySelector("[data-sat-image-viewport]");
    expect(pane).toHaveAttribute("tabindex", "0");
    expect(pane).toHaveAttribute("aria-label", "Graph of f");
    expect(pane).toHaveAttribute("data-sat-image-viewport");
  });

  it("exits on Escape even when focus has left the strip", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    document.body.focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("portals outside the question stacking context to document.body", async () => {
    const user = userEvent.setup();
    render(
      <div
        data-testid="question-stacking-context"
        style={{
          transform: "translateZ(0)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Harness />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const viewer = screen.getByTestId("sat-image-viewer");
    const question = screen.getByTestId("question-stacking-context");

    expect(question).not.toContainElement(viewer);
    expect(viewer.parentElement).toBe(document.body);
  });

  it("propagates contrast context across the portal", async () => {
    const user = userEvent.setup();
    render(
      <SatContrastContext.Provider value="high-contrast">
        <Harness />
      </SatContrastContext.Provider>,
    );
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const viewer = screen.getByTestId("sat-image-viewer");
    expect(viewer).toHaveAttribute("data-sat-contrast", "high-contrast");
  });

  it("acquires body scroll lock while open and releases on close", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(document.body.style.overflow).toBe("");

    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });

  it("resets both zoom and pan offset when Reset zoom is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness initialView={{ zoom: 1.5, offsetX: 20, offsetY: -15 }} />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByTestId("view")).toHaveTextContent("1.5:20:-15");

    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    await user.click(within(dialog).getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByTestId("view")).toHaveTextContent("1:0:0");
  });

  it("renders a protective scrim covering the viewport to prevent background interaction", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const scrim = document.querySelector("[data-sat-image-scrim]");
    expect(scrim).toBeInTheDocument();
    expect(scrim).toHaveClass("sat-figure-scrim");
  });

  it("handles arrow key panning only when zoomed", async () => {
    const user = userEvent.setup();
    render(<Harness initialView={{ zoom: 1, offsetX: 0, offsetY: 0 }} />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const viewport = document.querySelector("[data-sat-image-viewport]");
    if (!viewport) throw new Error("no viewport");

    // At 100%: arrow keys do not pan or preventDefault
    const at100 = createEvent.keyDown(viewport, { key: "ArrowLeft" });
    fireEvent(viewport, at100);
    expect(at100.defaultPrevented).toBe(false);

    // Zoom in via strip
    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    await user.click(within(dialog).getByRole("button", { name: "Zoom in" }));

    // While zoomed: arrow keys prevent default and handle pan
    const whileZoomed = createEvent.keyDown(viewport, { key: "ArrowLeft" });
    fireEvent(viewport, whileZoomed);
    expect(whileZoomed.defaultPrevented).toBe(true);
  });
});
