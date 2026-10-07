import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SAT_COPY } from "../../../domain/satCopy";
import { SatWriterLockGate } from "../SatWriterLockGate";

// Two tabs of one browser share the writer identity and the local outbox:
// only the lock holder may mount the exam.
describe("SatWriterLockGate", () => {
  it("mounts the exam in one tab only and lets the other take over after it closes", async () => {
    const first = render(
      <SatWriterLockGate scheduleId="sched-1" attemptId="att-1">
        <p>exam tab one</p>
      </SatWriterLockGate>,
    );
    expect(await first.findByText("exam tab one")).toBeInTheDocument();

    render(
      <SatWriterLockGate scheduleId="sched-1" attemptId="att-1">
        <p>exam tab two</p>
      </SatWriterLockGate>,
    );
    expect(
      await screen.findByRole("heading", { name: SAT_COPY.deviceTransfer.duplicateTabTitle }, { timeout: 2_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("exam tab two")).not.toBeInTheDocument();

    first.unmount();
    fireEvent.click(screen.getByRole("button", { name: SAT_COPY.deviceTransfer.retry }));
    expect(await screen.findByText("exam tab two")).toBeInTheDocument();
  });

  it("does not block a different attempt in the same browser", async () => {
    render(
      <SatWriterLockGate scheduleId="sched-1" attemptId="att-a">
        <p>attempt a</p>
      </SatWriterLockGate>,
    );
    render(
      <SatWriterLockGate scheduleId="sched-1" attemptId="att-b">
        <p>attempt b</p>
      </SatWriterLockGate>,
    );
    expect(await screen.findByText("attempt a")).toBeInTheDocument();
    expect(await screen.findByText("attempt b")).toBeInTheDocument();
  });
});
