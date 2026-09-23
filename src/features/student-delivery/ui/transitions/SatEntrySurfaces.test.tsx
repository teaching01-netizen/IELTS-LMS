import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatEntryRecoveryScreen } from "./SatEntryRecoveryScreen";
import { SatPreStartScreen } from "./SatPreStartScreen";

describe("SAT entry surfaces", () => {
  it("announces pre-start status without offering a manual start action", () => {
    render(
      <SatPreStartScreen
        reason="initial"
        runtimeStatus="not_started"
        proctorStatus="connecting"
        stageReady={false}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Waiting for the proctor to start your exam" })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /begin module/i })).toBeNull();
  });

  it("offers retry only after automatic entry has settled", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <SatEntryRecoveryScreen module={null} isRetrying={false} onRetry={onRetry} />,
    );

    const recovery = screen.getByRole("alert");
    expect(within(recovery).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(recovery).getByRole("button", { name: "Retry now" })).toBeEnabled();
    expect(within(recovery).queryByRole("button", { name: /begin module/i })).toBeNull();

    rerender(<SatEntryRecoveryScreen module={null} isRetrying onRetry={onRetry} />);
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "Opening…" })).toBeDisabled();
  });
});
