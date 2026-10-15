import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatLineReader, type SatLineReaderFrame } from "./SatLineReader";

// jsdom has no layout: give the exam layer a 1000×750 box. Line height falls back to 24px.
const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 750 });
});
afterAll(() => {
  if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
  if (offsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
});

function Harness({ initial, onFrameChange = () => undefined, onDisable = () => undefined }: {
  initial: SatLineReaderFrame;
  onFrameChange?: (frame: SatLineReaderFrame) => void;
  onDisable?: () => void;
}) {
  const [frame, setFrame] = useState(initial);
  return <SatLineReader frame={frame} onDisable={onDisable}
    onFrameChange={(next) => { setFrame(next); onFrameChange(next); }} />;
}

describe("SatLineReader (Bluebook)", () => {
  it("renders the grip, expand, close, line caret and keyboard hint", () => {
    render(<Harness initial={{ position: 0.5 }} />);
    expect(screen.getByRole("group", { name: "Line reader" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Move line reader" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand line reader" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Close line reader" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show more lines" })).toBeInTheDocument();
    expect(screen.getByText("Click on the six dots, then use the arrow keys to move the line reader.")).toBeInTheDocument();
  });

  it("close destroys only the overlay (calls onDisable, nothing else)", async () => {
    const user = userEvent.setup();
    const onDisable = vi.fn();
    const onFrameChange = vi.fn();
    render(<Harness initial={{ position: 0.5 }} onFrameChange={onFrameChange} onDisable={onDisable} />);
    await user.click(screen.getByRole("button", { name: "Close line reader" }));
    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(onFrameChange).not.toHaveBeenCalled();
  });

  it("Escape closes the reader", () => {
    const onDisable = vi.fn();
    render(<Harness initial={{ position: 0.5 }} onDisable={onDisable} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDisable).toHaveBeenCalledTimes(1);
  });

  it("uses the dark mask token, a tinted window and no blur", () => {
    render(<Harness initial={{ position: 0.5 }} />);
    const root = document.querySelector("[data-sat-line-reader]")!;
    expect(root.innerHTML).toContain("var(--sat-reader-mask)");
    expect(root.innerHTML).not.toContain("var(--sat-reader-dim");
    expect(root.innerHTML).not.toContain("backdrop-blur");
    expect(root.querySelector("[data-sat-line-reader-header]")!.className).toContain("var(--sat-tool-chrome)");
    const window_ = root.querySelector<HTMLElement>("[data-sat-line-reader-window]")!;
    expect(window_.innerHTML).toContain("var(--sat-reader-window)");
    expect(window_.innerHTML).not.toContain("bg-white");
    expect(window_.className).toContain("pointer-events-none");
    expect(window_.style.height).toBe("24px");
  });

  it("exposes vertical slider aria for the panel position", () => {
    render(<Harness initial={{ position: 0.5 }} />);
    const slider = screen.getByRole("slider", { name: "Move line reader" });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "100");
    expect(slider).toHaveAttribute("aria-valuenow", "50");
    expect(slider).toHaveAttribute("aria-valuetext", "50 percent down the screen");
    expect(slider).toHaveAttribute("aria-orientation", "vertical");
    expect(slider).toHaveAccessibleDescription("Up and down arrows move one line. Left and right arrows move sideways.");
  });

  it("grip arrow keys move one line (Shift ×5) and sideways", () => {
    const onFrameChange = vi.fn();
    render(<Harness initial={{ position: 0.5, x: 0.1 }} onFrameChange={onFrameChange} />);
    const slider = screen.getByRole("slider", { name: "Move line reader" });
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ position: (375 + 24) / 750, x: 0.1 }));
    fireEvent.keyDown(slider, { key: "ArrowUp", shiftKey: true });
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ position: (399 - 120) / 750 }));
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ x: (100 + 24) / 1000 }));
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ position: 0 }));
  });

  it("caret steps 1→2→3 then back to 1, and arrow keys change the count", async () => {
    const user = userEvent.setup();
    const onFrameChange = vi.fn();
    render(<Harness initial={{ position: 0.5 }} onFrameChange={onFrameChange} />);
    await user.click(screen.getByRole("button", { name: "Show more lines" }));
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ lines: 2 }));
    await user.click(screen.getByRole("button", { name: "Show more lines" }));
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ lines: 3 }));
    expect(screen.getByRole("status")).toHaveTextContent("3 of 3 lines visible");
    expect(document.querySelector<HTMLElement>("[data-sat-line-reader-window]")!.style.height).toBe("72px");
    await user.click(screen.getByRole("button", { name: "Show fewer lines" }));
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ lines: 1 }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Show more lines" }), { key: "ArrowDown" });
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ lines: 2 }));
  });

  it("expand toggles full width and back", async () => {
    const user = userEvent.setup();
    const onFrameChange = vi.fn();
    render(<Harness initial={{ position: 0.5, x: 0.2 }} onFrameChange={onFrameChange} />);
    const panel = document.querySelector<HTMLElement>("[data-sat-line-reader-panel]")!;
    expect(panel.style.width).toBe("500px");
    await user.click(screen.getByRole("button", { name: "Expand line reader" }));
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ expanded: true, x: 0.2 }));
    expect(panel.style.width).toBe("1000px");
    expect(panel.style.transform).toContain("translate3d(0px");
    const collapse = screen.getByRole("button", { name: "Collapse line reader" });
    expect(collapse).toHaveAttribute("aria-pressed", "true");
    await user.click(collapse);
    expect(panel.style.transform).toContain("translate3d(200px");
  });

  it("tapping the mask above or below the window steps one line", () => {
    const onFrameChange = vi.fn();
    render(<Harness initial={{ position: 0.5 }} onFrameChange={onFrameChange} />);
    const panel = document.querySelector<HTMLElement>("[data-sat-line-reader-panel]")!;
    const below = document.querySelector<HTMLElement>('[data-sat-line-reader-mask="below"]')!;
    fireEvent.pointerDown(below, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(panel, { button: 0, pointerId: 1, clientX: 51, clientY: 51 });
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ position: (375 + 24) / 750 }));
    const above = document.querySelector<HTMLElement>('[data-sat-line-reader-mask="above"]')!;
    fireEvent.pointerDown(above, { button: 0, pointerId: 2, clientX: 50, clientY: 50 });
    fireEvent.pointerUp(panel, { button: 0, pointerId: 2, clientX: 50, clientY: 50 });
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ position: 0.5 }));
  });

  it("dragging the frame moves the panel and commits once on release", () => {
    const onFrameChange = vi.fn();
    render(<Harness initial={{ position: 0.5, x: 0 }} onFrameChange={onFrameChange} />);
    const panel = document.querySelector<HTMLElement>("[data-sat-line-reader-panel]")!;
    const header = document.querySelector<HTMLElement>("[data-sat-line-reader-header]")!;
    fireEvent.pointerDown(header, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(panel, { pointerId: 1, clientX: 140, clientY: 40 });
    expect(panel).toHaveAttribute("data-dragging", "true");
    expect(panel.style.transform).toBe("translate3d(40px, 315px, 0)");
    expect(onFrameChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(panel, { button: 0, pointerId: 1, clientX: 140, clientY: 40 });
    expect(onFrameChange).toHaveBeenCalledTimes(1);
    expect(onFrameChange).toHaveBeenLastCalledWith(expect.objectContaining({ position: 315 / 750, x: 40 / 1000 }));
  });
});
