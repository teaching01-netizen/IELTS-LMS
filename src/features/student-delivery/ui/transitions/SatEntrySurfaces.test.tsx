import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SatPreStartScreen } from "./SatPreStartScreen";

describe("SAT entry surfaces", () => {
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
});
