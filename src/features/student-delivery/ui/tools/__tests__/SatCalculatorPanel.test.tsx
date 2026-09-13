import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SatCalculatorPanel } from "../SatCalculatorPanel";

const baseProps = {
  scheduleId: "schedule-1",
  attemptId: "attempt-1",
  moduleAttemptId: "module-1",
  disabled: false,
  onClose: vi.fn(),
};

describe("SatCalculatorPanel", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(
        (query: string) =>
          ({
            matches: false,
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
  });

  it("prewarms both Desmos modes hidden while closed and reveals the same frames on open", () => {
    // Prewarm contract: closed + prewarmWhenClosed mounts both frames hidden
    // (same ready iframes revealed on open — no fresh mount, no reload).
    const { rerender } = render(
      <SatCalculatorPanel {...baseProps} open prewarmWhenClosed />
    );
    const scientific = screen.getByTitle(
      "Desmos scientific calculator, College Board testing version"
    );
    const graphing = screen.getByTitle("Desmos graphing calculator, College Board testing version");
    expect(scientific).toBeInTheDocument();
    expect(graphing).toBeInTheDocument();

    rerender(<SatCalculatorPanel {...baseProps} open={false} prewarmWhenClosed />);
    expect(
      screen.queryByTitle("Desmos scientific calculator, College Board testing version")
    ).toBeInTheDocument();
    expect(
      screen.queryByTitle("Desmos graphing calculator, College Board testing version")
    ).toBeInTheDocument();
    // keepAlive: same nodes survive closed -> open (prewarm identity).
    const before = screen.getByTitle("Desmos scientific calculator, College Board testing version");
    rerender(<SatCalculatorPanel {...baseProps} open prewarmWhenClosed />);
    expect(screen.getByTitle("Desmos scientific calculator, College Board testing version")).toBe(before);
  });

  it("drops the Desmos iframe on close: fixed sheets unmount, session persists via Desmos state", () => {
    const { rerender } = render(<SatCalculatorPanel {...baseProps} open />);
    expect(
      screen.getByTitle("Desmos scientific calculator, College Board testing version")
    ).toBeInTheDocument();

    // Phase 5 fixed sheets unmount on close (no hidden-dialog keep-alive):
    // there is no cross-close iframe node to preserve, so reopening mounts
    // a fresh frame while calculator input state persists through Desmos.
    rerender(<SatCalculatorPanel {...baseProps} open={false} />);
    expect(
      screen.queryByTitle("Desmos scientific calculator, College Board testing version")
    ).not.toBeInTheDocument();

    rerender(<SatCalculatorPanel {...baseProps} open />);
    expect(
      screen.getByTitle("Desmos scientific calculator, College Board testing version")
    ).toBeInTheDocument();
  });

  it("persists only the selected embedded calculator mode", () => {
    render(<SatCalculatorPanel {...baseProps} open />);
    fireEvent.click(screen.getByRole("radio", { name: "Graphing" }));

    const persisted = [...Array(window.sessionStorage.length)].map((_, index) => {
      const key = window.sessionStorage.key(index);
      return key ? window.sessionStorage.getItem(key) : null;
    });
    expect(persisted).toContain(JSON.stringify({ activeMode: "graphing" }));
    expect(
      screen.getByTitle("Desmos graphing calculator, College Board testing version")
    ).toHaveClass("block");
  });

  it("uses equal-width mode segments and supports arrow-key switching", () => {
    render(<SatCalculatorPanel {...baseProps} open />);
    const group = screen.getByRole("radiogroup", { name: "Calculator type" });
    expect(group).toHaveClass("grid-cols-2");

    const scientific = screen.getByRole("radio", { name: "Scientific" });
    const graphing = screen.getByRole("radio", { name: "Graphing" });
    fireEvent.keyDown(scientific, { key: "ArrowRight" });
    expect(graphing).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(graphing, { key: "ArrowLeft" });
    expect(scientific).toHaveAttribute("aria-checked", "true");
  });

  it("renders exactly one mode selector in the window header with no Desmos byline", () => {
    render(<SatCalculatorPanel {...baseProps} open />);
    // Exactly one selector: two radios, one radiogroup (headerControls slot).
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getAllByRole("radiogroup", { name: "Calculator type" })).toHaveLength(1);
    // Stacked chrome is gone: the inner Desmos byline no longer renders.
    expect(screen.queryByText("Desmos · College Board")).toBeNull();
    // Header slot owns the selector: the radiogroup lives inside the tool header.
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    const header = dialog.querySelector("[data-sat-tool-header]");
    expect(header).not.toBeNull();
    expect(header!.querySelector('[role="radiogroup"]')).not.toBeNull();
  });

  it("does not resize the window when switching modes", () => {
    render(<SatCalculatorPanel {...baseProps} open />);
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    const before = { left: dialog.style.left, top: dialog.style.top, width: dialog.style.width, height: dialog.style.height };
    fireEvent.click(screen.getByRole("radio", { name: "Graphing" }));
    expect(screen.getByTitle("Desmos graphing calculator, College Board testing version")).toHaveClass("block");
    expect(dialog.style.left).toBe(before.left);
    expect(dialog.style.top).toBe(before.top);
    expect(dialog.style.width).toBe(before.width);
    expect(dialog.style.height).toBe(before.height);
  });

  it("embeds carry the explicit exam locale", () => {
    render(<SatCalculatorPanel {...baseProps} open />);
    const scientific = screen.getByTitle("Desmos scientific calculator, College Board testing version");
    expect(scientific.getAttribute("src")).toContain("lang=en");
  });

  it("compact sheet keeps exactly one mode selector at the top of the body", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(
        (query: string) =>
          ({
            matches: true,
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
    render(<SatCalculatorPanel {...baseProps} open />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    const group = screen.getByRole("radiogroup", { name: "Calculator type" });
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    // Compact sheet: no header slot by design, so the single selector lives
    // at the top of the body inside the dialog.
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    expect(dialog.querySelector("[data-sat-tool-header]")).toBeNull();
    expect(dialog.contains(group)).toBe(true);
  });
});
