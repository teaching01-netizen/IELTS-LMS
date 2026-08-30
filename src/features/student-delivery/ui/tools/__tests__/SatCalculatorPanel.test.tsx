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

  it("prewarms both Desmos modes before the first open and reuses the same iframe nodes", () => {
    const { rerender } = render(
      <SatCalculatorPanel {...baseProps} open={false} prewarmWhenClosed />
    );
    const scientific = screen.getByTitle(
      "Desmos scientific calculator, College Board testing version"
    );
    const graphing = screen.getByTitle("Desmos graphing calculator, College Board testing version");
    expect(scientific.closest("[data-sat-tool-prewarmed]")).not.toBeNull();
    expect(graphing.closest("[data-sat-tool-prewarmed]")).not.toBeNull();

    rerender(<SatCalculatorPanel {...baseProps} open prewarmWhenClosed />);
    expect(screen.getByTitle("Desmos scientific calculator, College Board testing version")).toBe(
      scientific
    );
    expect(screen.getByTitle("Desmos graphing calculator, College Board testing version")).toBe(
      graphing
    );
  });

  it("keeps the Desmos iframe mounted after close so its session survives reopen", () => {
    const { rerender } = render(<SatCalculatorPanel {...baseProps} open />);
    const scientific = screen.getByTitle(
      "Desmos scientific calculator, College Board testing version"
    );

    rerender(<SatCalculatorPanel {...baseProps} open={false} />);
    expect(scientific).toBeInTheDocument();
    expect(scientific.closest("[hidden]")).not.toBeNull();

    rerender(<SatCalculatorPanel {...baseProps} open />);
    expect(screen.getByTitle("Desmos scientific calculator, College Board testing version")).toBe(
      scientific
    );
  });

  it("persists only the selected embedded calculator mode", () => {
    render(<SatCalculatorPanel {...baseProps} open />);
    fireEvent.click(screen.getByRole("button", { name: "Graphing" }));

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
    const group = screen.getByRole("group", { name: "Calculator type" });
    expect(group).toHaveClass("grid-cols-2");

    const scientific = screen.getByRole("button", { name: "Scientific" });
    const graphing = screen.getByRole("button", { name: "Graphing" });
    fireEvent.keyDown(scientific, { key: "ArrowRight" });
    expect(graphing).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(graphing, { key: "ArrowLeft" });
    expect(scientific).toHaveAttribute("aria-pressed", "true");
  });
});
