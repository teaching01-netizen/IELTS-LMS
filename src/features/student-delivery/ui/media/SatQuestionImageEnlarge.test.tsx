import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  SAT_IMAGE_ENLARGE_FIT_VIEW,
  type SatImageEnlargeGeometry,
  type SatImageEnlargeView,
} from "../../../exam-rendering/api/structuredContentEnlarge";
import { SatQuestionImageEnlarge } from "./SatQuestionImageEnlarge";

/** A square figure whose frame and image box are already laid out at 200×200. */
const GEOMETRY: SatImageEnlargeGeometry = {
  viewport: { width: 200, height: 200 },
  image: { width: 200, height: 200 },
  natural: { width: 400, height: 400 },
};

/**
 * The view is the renderer's state, exactly as it is in the exam: this harness
 * makes that ownership visible, so "does the zoom survive?" is a question about
 * the view, not about the viewer's private memory.
 */
function Harness({ initialView = SAT_IMAGE_ENLARGE_FIT_VIEW }: { initialView?: SatImageEnlargeView }) {
  const [view, setView] = useState<SatImageEnlargeView>(initialView);
  const [open, setOpen] = useState(false);
  return (
    <>
      <input aria-label="Answer" />
      <SatQuestionImageEnlarge
        label="Graph of f"
        enlargeId="sat-enlarge-test"
        src="https://example.com/graph.png"
        open={open}
        view={view}
        geometry={GEOMETRY}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        onViewChange={setView}
        returnFocusSelector="#sat-enlarge-test"
      />
      <output data-testid="view">
        {view.zoom + ":" + view.offsetX + ":" + view.offsetY}
      </output>
    </>
  );
}

function embeddedStrip() {
  return screen.getByRole("toolbar", { name: "Figure controls: Graph of f" });
}

describe("SatQuestionImageEnlarge", () => {
  it("opens at 100% and steps in discrete 25% increments in place", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(within(embeddedStrip()).getByRole("status")).toHaveTextContent("100%");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(within(embeddedStrip()).getByRole("status")).toHaveTextContent("125%");
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(within(embeddedStrip()).getByRole("status")).toHaveTextContent("150%");
    // A centred figure zooms about its centre, so nothing has been pushed aside.
    expect(screen.getByTestId("view")).toHaveTextContent("1.5:0:0");
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(screen.getByTestId("view")).toHaveTextContent("1:0:0");
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeDisabled();
  });

  it("names the figure it commands", () => {
    render(<Harness />);
    expect(embeddedStrip()).toBeInTheDocument();
  });

  it("escalates to full screen without losing the student's place, and returns instantly", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));

    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    // Same view, bigger viewport: the strip inside the layer reports the state the
    // embedded figure is already in.
    expect(within(dialog).getByRole("status")).toHaveTextContent("125%");

    await user.click(within(dialog).getByRole("button", { name: "Exit full screen" }));
    expect(screen.queryByRole("dialog", { name: "Image viewer" })).not.toBeInTheDocument();
    expect(within(embeddedStrip()).getByRole("status")).toHaveTextContent("125%");
    expect(screen.getByRole("button", { name: "Enter full screen" })).toHaveFocus();
  });

  it("grows out of the figure's own place on screen, not out of nowhere", async () => {
    const user = userEvent.setup();
    const rect = {
      left: 300,
      top: 200,
      width: 400,
      height: 200,
      right: 700,
      bottom: 400,
      x: 300,
      y: 200,
      toJSON: () => ({}),
    } as DOMRect;
    const spy = vi.spyOn(HTMLImageElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    render(
      <figure>
        <img alt="Question visual" />
        <Harness />
      </figure>,
    );
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));
    const dialog = screen.getByRole("dialog", { name: "Image viewer" });
    // The card grows from the centre of the figure it is showing (700×400 at
    // 300,200 → 500,300), so expanding reads as the same object getting larger.
    expect(dialog).toHaveClass("sat-figure-expand");
    expect(dialog).toHaveStyle({ transformOrigin: "500px 300px" });
    expect(document.querySelector(".sat-figure-scrim")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("answers Escape in full screen by stepping back to the figure, never by dropping the zoom", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Enter full screen" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Image viewer" })).not.toBeInTheDocument();
    expect(screen.getByTestId("view")).toHaveTextContent("1.25:0:0");
  });

  it("never zooms the figure while the student is typing somewhere else", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const before = screen.getByTestId("view").textContent;

    const input = screen.getByRole("textbox", { name: "Answer" });
    await user.click(input);
    await user.keyboard("-0+");
    // The strip listens on itself, never on the document: a minus sign typed into
    // an answer is an answer, not a command.
    fireEvent.keyDown(document.body, { key: "0" });
    fireEvent.keyDown(document.body, { key: "-" });
    expect(screen.getByTestId("view").textContent).toBe(before);
  });
});
