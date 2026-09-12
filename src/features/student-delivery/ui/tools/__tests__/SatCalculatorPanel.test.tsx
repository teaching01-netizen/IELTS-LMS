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
});
