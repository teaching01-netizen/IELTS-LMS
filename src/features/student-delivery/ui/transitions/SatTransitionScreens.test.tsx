import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatBreakScreen } from "./SatBreakScreen";
import { SatCompleteScreen } from "./SatCompleteScreen";

describe("SAT transition screens (Phase 6c)", () => {
  it("gives waiting and break distinct titles with the auto-advance promise", () => {
    const { rerender } = render(
      <SatBreakScreen nextSectionKey="math" remainingSeconds={300} mode="waiting" />
    );
    expect(screen.getByText("Waiting for the break to start")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("5:00");
    expect(screen.getByText(/opens automatically when this ends/)).toBeInTheDocument();
    expect(screen.getByText(/wait 30 seconds then reload/)).toBeInTheDocument();

    rerender(<SatBreakScreen nextSectionKey="math" remainingSeconds={600} mode="break" />);
    expect(screen.getByText("On break")).toBeInTheDocument();
    expect(screen.getByText(/starts automatically/)).toBeInTheDocument();
  });

  // Phase 4 (kill the silent 0:00): the break countdown can legitimately read
  // 0:00 while the server finishes the section advance, so the surface names the
  // entry progress rather than freezing there.
  it("explains a run-out break with the entry progress instead of a frozen 0:00", () => {
    const { rerender } = render(
      <SatBreakScreen nextSectionKey="math" remainingSeconds={0} entryProgress="starting" />
    );
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
    expect(screen.getByText("Starting your next section")).toBeInTheDocument();
    expect(screen.getByText(/do not need to do anything/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Math is next" })).toBeInTheDocument();
    expect(screen.queryByText("On break")).not.toBeInTheDocument();

    rerender(
      <SatBreakScreen nextSectionKey="math" remainingSeconds={0} entryProgress="retrying" />
    );
    expect(screen.getByText("Still opening your next section")).toBeInTheDocument();
    expect(screen.getByText(/Keep this screen open/)).toBeInTheDocument();
    // The path forward stays named on the retrying state.
    expect(screen.getByText(/wait 30 seconds then reload/)).toBeInTheDocument();
  });

  it("names the Continue destination for its section", () => {
    render(
      <SatBreakScreen nextSectionKey="math" remainingSeconds={10} onContinue={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Continue to Math" })).toBeInTheDocument();
  });

  it("disambiguates whole-test scope on Complete with a dashboard exit", () => {
    render(<SatCompleteScreen result={null} onExit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "SAT Complete" })).toBeInTheDocument();
    expect(screen.getByText(/All responses submitted/)).toBeInTheDocument();
    expect(screen.getByText(/unofficial practice score/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to dashboard" })).toBeInTheDocument();
  });
});
