import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SatCalculatorPanel } from "../../ui/tools/SatCalculatorPanel";
import { SatReferenceSheetPanel } from "../../ui/tools/SatReferenceSheetPanel";

function matchMediaMock(matches: boolean) {
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
}

/**
 * Phase 05 coexistence regression (R4): mirrors the SatStudentSessionRoute
 * binding shape — each panel's onClose closes ONLY its own tool.
 */
function BothToolsHarness() {
  const [tools, setTools] = useState({ calculator: true, referenceSheet: true });
  return (
    <>
      <SatCalculatorPanel
        open={tools.calculator}
        scheduleId="test-schedule"
        attemptId="test-attempt"
        moduleAttemptId="test-module"
        onClose={() => setTools((current) => ({ ...current, calculator: false }))}
      />
      <SatReferenceSheetPanel
        open={tools.referenceSheet}
        scheduleId="test-schedule"
        attemptId="test-attempt"
        moduleAttemptId="test-module"
        onClose={() => setTools((current) => ({ ...current, referenceSheet: false }))}
      />
    </>
  );
}

describe("SAT tool coexistence close (Phase 05)", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    matchMediaMock(false);
  });

  it("closing Calculator leaves Reference Sheet open", async () => {
    const user = userEvent.setup();
    render(<BothToolsHarness />);
    expect(screen.getByRole("dialog", { name: "Calculator" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Reference Sheet" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close Calculator" }));

    expect(screen.queryByRole("dialog", { name: "Calculator" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Reference Sheet" })).toBeInTheDocument();
  });

  it("closing Reference Sheet leaves Calculator open", async () => {
    const user = userEvent.setup();
    render(<BothToolsHarness />);
    expect(screen.getByRole("dialog", { name: "Calculator" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Reference Sheet" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close Reference Sheet" }));

    expect(screen.queryByRole("dialog", { name: "Reference Sheet" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Calculator" })).toBeInTheDocument();
  });
});
