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
      // The route always resolves a window when a module is pending, so the
      // default here is what a real caller hands in for a module the server said
      // nothing about.
      moduleWindow={{ seconds: baseModule.durationSeconds, source: "authored" }}
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

// The pre-entry half of the late-join bug: a candidate who arrives after the
// room has already spent part of Module 1 must not be told the authored length
// and then be handed the room's remainder. The screen quotes the window
// application policy resolved for this module — the server's own StartModule
// clamp when it published one, the authored length when it did not — and only
// formats it, so the copy cannot disagree with the clock the student lands in.
describe("SatDirectionsScreen module window (late arrival)", () => {
  it("quotes the authored length when the server published no window", () => {
    renderScreen();
    expect(screen.getByText("32 minutes · 27 questions")).toBeInTheDocument();
  });

  it("quotes the room's remainder when that is what entry will grant", () => {
    renderScreen({ moduleWindow: { seconds: 12 * 60, source: "granted" } });
    expect(screen.getByText("12 minutes left in this module · 27 questions")).toBeInTheDocument();
    expect(screen.queryByText("32 minutes · 27 questions")).not.toBeInTheDocument();
  });

  // Arriving after the room's Module 1 window has closed: the candidate is
  // granted nothing and routed on, so the screen must not promise a module.
  it("says there is no time left when the room has closed the module", () => {
    renderScreen({ moduleWindow: { seconds: 0, source: "granted" } });
    expect(screen.getByText("No time left in this module · 27 questions")).toBeInTheDocument();
    expect(screen.queryByText(/^32 minutes/)).not.toBeInTheDocument();
  });

  it("never rounds a sub-minute granted window up to a minute", () => {
    renderScreen({ moduleWindow: { seconds: 45, source: "granted" } });
    expect(
      screen.getByText("Less than a minute left in this module · 27 questions"),
    ).toBeInTheDocument();
  });

  // The remainder language belongs to a GRANTED window only. An authored length
  // is never described as time the room has left, whatever its size — the source
  // decides the wording, not the magnitude, so a change to the fallback rule
  // lands in the policy and not here.
  it("never describes an authored length as a remainder", () => {
    renderScreen({ moduleWindow: { seconds: 1920, source: "authored" } });
    expect(screen.queryByText(/left in this module/)).not.toBeInTheDocument();
    expect(screen.getByText("32 minutes · 27 questions")).toBeInTheDocument();
  });

  // No pending module, no claim: the resolved window travels with the module.
  it("prepares the next module when there is no window to quote", () => {
    renderScreen({ moduleWindow: null });
    expect(screen.getByText("Preparing the next module.")).toBeInTheDocument();
  });
});

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
