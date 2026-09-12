import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesmosCalculator } from "../DesmosCalculator";
import { SatCalculatorPanel } from "../SatCalculatorPanel";
import { SatLoadingSurface } from "../../feedback/SatStateSurfaces";

const baseProps = {
  scheduleId: "schedule-1",
  attemptId: "attempt-1",
  moduleAttemptId: "module-1",
  disabled: false,
  onClose: vi.fn(),
};

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

const SCI_TITLE = "Desmos scientific calculator, College Board testing version";
const GRAPH_TITLE = "Desmos graphing calculator, College Board testing version";

function expectZeroLiveRoles(container: HTMLElement) {
  expect(container.querySelectorAll("[role=status]")).toHaveLength(0);
  expect(container.querySelectorAll("[role=alert]")).toHaveLength(0);
  expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
}

describe("Desmos hidden silence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
    matchMediaMock(false);
  });

  it("visible calculator keeps its loading live region", () => {
    render(<DesmosCalculator mode="scientific" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading calculator…");
  });

  it("silenced calculator exposes zero live roles but preserves the loading tree", () => {
    const { container } = render(
      <DesmosCalculator mode="scientific" prewarmInactiveModes silenceLiveRegions />
    );
    expectZeroLiveRoles(container);
    expect(container.querySelector("[data-desmos-loading]")).not.toBeNull();
    expect(screen.getByTitle(SCI_TITLE)).toBeInTheDocument();
    expect(screen.getByTitle(GRAPH_TITLE)).toBeInTheDocument();
  });

  it("silenced plus disabled exposes zero live roles (paused veil)", () => {
    const { container } = render(
      <DesmosCalculator mode="graphing" disabled silenceLiveRegions />
    );
    expectZeroLiveRoles(container);
    expect(screen.getByText("Paused by proctor")).toBeInTheDocument();
  });

  it.each([false, true])(
    "closed prewarm panel composes to zero live roles (matchMedia matches=%s) with both iframes mounted",
    (matches) => {
      matchMediaMock(matches);
      const { container } = render(
        <SatCalculatorPanel {...baseProps} open={false} prewarmWhenClosed />
      );
      expectZeroLiveRoles(container);
      expect(screen.queryByTitle(SCI_TITLE)).toBeInTheDocument();
      expect(screen.queryByTitle(GRAPH_TITLE)).toBeInTheDocument();
    }
  );

  it("loading screen plus hidden prewarm yields exactly one role=status", () => {
    matchMediaMock(false);
    const { container } = render(
      <>
        <SatLoadingSurface kind="initial" />
        <SatCalculatorPanel {...baseProps} open={false} prewarmWhenClosed />
      </>
    );
    expect(container.querySelectorAll("[role=status]")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Digital SAT…");
  });
});
