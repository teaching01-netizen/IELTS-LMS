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

  it("zooms where the student double-clicks inside the fullscreen pane", async () => {
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

  it("presents an exclusive modal dialog with backdrop blur over a floating panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The dialog root covers the full viewport as the backdrop absorber.
    expect(dialog).toHaveClass("fixed", "inset-0", "h-[100dvh]", "w-[100dvw]");
    expect(dialog).toHaveClass("z-[89]");
    // Backdrop material overlay exists with blur styling.
    const backdrop = dialog.querySelector("[data-sat-image-backdrop]");
    expect(backdrop).toBeInTheDocument();
    expect(backdrop).toHaveClass("backdrop-blur-[20px]");
    // The veil carries the figure's paper, not a separate gray dim: the blur
    // alone hides the exam, so opening a figure keeps the screen on white.
    expect(backdrop).toHaveClass("bg-[var(--sat-viewer-backdrop,rgba(255,255,255,0.88))]");
    expect(backdrop?.className).not.toContain("242,242,247");
    // A floating panel exists inside the dialog (not edge-to-edge).
    const panel = dialog.querySelector("[data-sat-image-panel]");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass("rounded-2xl");
    // No old-style scrim element.
    expect(document.querySelector("[data-sat-image-scrim]")).toBeNull();
  });

  it("uses h-full w-full object-contain on the fullscreen image to fill the stage", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const image = screen.getByTestId("sat-image-viewer").querySelector("img");
    expect(image).toBeInTheDocument();
    // The image element must own the full stage box (h-full w-full),
    // NOT merely limit its size (max-h-full max-w-full).
    expect(image).toHaveClass("h-full", "w-full", "object-contain");
    expect(image?.className).not.toContain("max-h-full");
    expect(image?.className).not.toContain("max-w-full");
  });

  it("keeps the figure on the same white stage it had while embedded", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const stage = document.querySelector("[data-sat-image-viewport]");
    expect(stage).toBeInTheDocument();
    // The embedded frame paints `bg-white`, which the theme remaps to
    // --sat-surface. The full-screen stage must land on that same surface, so
    // opening the viewer never repaints a white figure onto a gray stage.
    expect(stage).toHaveClass("bg-[var(--sat-surface,#ffffff)]");
    expect(stage?.className).not.toContain("sat-surface-subtle");
  });

  it("traps keyboard Tab focus within the modal dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Image viewer" });

    const focusables = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [role="button"]:not([disabled])'
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Focus last element and press Tab -> should wrap to first
    last.focus();
    expect(last).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(first).toHaveFocus();

    // Focus first element and press Shift+Tab -> should wrap to last
    first.focus();
    expect(first).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
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

  it("closes when clicking on the backdrop outside the panel", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    expect(dialog).toBeInTheDocument();

    // Clicking the dialog root (the backdrop) closes the viewer
    fireEvent.pointerDown(dialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
