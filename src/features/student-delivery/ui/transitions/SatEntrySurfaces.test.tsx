import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatStartCodeScreen } from "./SatStartCodeScreen";
import { SatPreStartScreen } from "./SatPreStartScreen";
describe("SAT entry surfaces", () => {
  it("announces routed Module 2 without showing a running clock", () => {
    render(<SatPreStartScreen reason="waiting" runtimeStatus="live" proctorStatus="active" stageReady startingModuleTwo />);
    expect(screen.getByRole("heading", { name: "Module 2 is ready — starting" })).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
  });
  it("announces the waiting room without offering a manual start action", () => {
    render(
      <SatPreStartScreen
        reason="waiting"
        runtimeStatus="not_started"
        proctorStatus="connecting"
        stageReady={false}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Waiting for your proctor…" })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /begin module/i })).toBeNull();
    // No recovery screen exists: transient failures keep this waiting room
    // mounted and retry automatically with jitter behind it.
    expect(screen.queryByRole("button", { name: /retry now/i })).toBeNull();
  });

  it("shows a non-resubmittable exam-starting state and places the timer at exam open", () => {
    render(
      <SatStartCodeScreen
        policy={{ mode: "access_code", state: "code_required" }}
        submitting
        onSubmit={vi.fn(async () => ({ ok: true, refusal: null }))}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByText(/your timer starts when your exam opens/i)).toBeInTheDocument();
    expect(screen.getByLabelText("6-digit exam start code")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Starting your exam…" })).toBeDisabled();
  });
});
