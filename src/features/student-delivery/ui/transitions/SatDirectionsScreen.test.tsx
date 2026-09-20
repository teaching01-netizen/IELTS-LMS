import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatDirectionsScreen } from "./SatDirectionsScreen";

const baseModule = {
  id: "rw-m1",
  adaptiveRole: "routing",
  durationSeconds: 1920,
  targetQuestionCount: 27,
  instructions: { version: 1 as const, nodes: [] },
} as never;

function renderScreen(overrides: Record<string, unknown> = {}) {
  return render(
    <SatDirectionsScreen
      module={baseModule}
      sectionLabel="Section 1: Reading and Writing"
      runtimeStatus="live"
      proctorStatus="active"
      isStarting={false}
      error={null}
      onStart={vi.fn()}
      onExit={vi.fn()}
      {...overrides}
    />
  );
}

describe("SatDirectionsScreen gate (Phase 6b)", () => {
  it("names the begin destination and carries the cleared-calculator notice", async () => {
    renderScreen();
    expect(
      screen.getByRole("button", { name: /Begin module \u2014 Module 1/ })
    ).toBeInTheDocument();
    expect(screen.getByText(/Calculator cleared between modules\./)).toBeInTheDocument();
  });

  it("explains a disabled start instead of dying silently", () => {
    renderScreen({ proctorStatus: "paused" });
    const begin = screen.getByRole("button", { name: /Begin module/ });
    expect(begin).toBeDisabled();
    expect(begin).toHaveAttribute("aria-describedby", "sat-directions-start-blocked");
    expect(screen.getByText(/Paused by the proctor/)).toBeInTheDocument();
  });

  // Phase 4: automatic entry owns the primary path; the button is recovery only.
  it("says the module is opening instead of asking the student to press start", () => {
    renderScreen({ isStarting: true });

    expect(screen.getByText("Starting your module…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Starting/ })).toBeDisabled();
  });

  it("keeps the start button disabled until auto-entry has failed", () => {
    renderScreen();

    expect(screen.getByRole("button", { name: /Begin module/ })).toBeDisabled();
    expect(screen.getByText(/opens automatically/)).toBeInTheDocument();
  });

  it("enables the start button as recovery once auto-entry has failed", () => {
    renderScreen({ entryRecoverable: true });

    expect(screen.getByRole("button", { name: /Begin module/ })).toBeEnabled();
    expect(screen.queryByText(/opens automatically/)).not.toBeInTheDocument();
  });

  // Module-advance fix: "recovery only" is honest only while something is going
  // to try. A module no automatic path owns — a branch module whose Module 1 was
  // submitted early — has the button as its ONLY way in, so it must be enabled,
  // and the screen must not promise an automatic open that will never come.
  it("offers a working start when no automatic path owns the module", () => {
    renderScreen({ autoStartPending: false });

    expect(screen.getByRole("button", { name: /Begin module/ })).toBeEnabled();
    expect(screen.queryByText(/opens automatically/)).not.toBeInTheDocument();
  });

  it("keeps the start button recovery-only while the automatic path owns the module", () => {
    renderScreen({ autoStartPending: true });

    expect(screen.getByRole("button", { name: /Begin module/ })).toBeDisabled();
    expect(screen.getByText(/opens automatically/)).toBeInTheDocument();
  });

  it("starts the module the student opens when no automatic path owns it", () => {
    const onStart = vi.fn();
    renderScreen({ autoStartPending: false, onStart });

    fireEvent.click(screen.getByRole("button", { name: /Begin module/ }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("confirms Leave exam with saved-state language and focus round-trip", async () => {
    renderScreen();
    const leave = screen.getByRole("button", { name: "Leave exam" });
    fireEvent.click(leave);
    const dialog = screen.getByRole("dialog", { name: "Leave this exam?" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/already saved stay saved/);
    // rAF focus-in: flush the frame before asserting focus ownership.
    // X close shares the cancel label: scope into the dialog footer.
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    // Shared shell focuses the X close (same cancel action) on open.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Stay and continue");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Leave this exam?" })).not.toBeInTheDocument();
  });
});
