import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatUnscheduledBreakDialog } from "./SatUnscheduledBreakDialog";
import { SatUnscheduledBreakVeil } from "./SatUnscheduledBreakVeil";

describe("SatUnscheduledBreakDialog", () => {
  it("states time continues and offers Cancel / Start my break", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onTakeBreak = vi.fn();
    render(<SatUnscheduledBreakDialog open onCancel={onCancel} onTakeBreak={onTakeBreak} />);
    expect(screen.getByRole("dialog", { name: "Take an Unscheduled Break?" })).toBeInTheDocument();
    expect(screen.getByText(/testing time will continue/)).toBeInTheDocument();
    // X close and Cancel footer share the cancel action; scope into the dialog body.
    const dialog = screen.getByRole("dialog", { name: "Take an Unscheduled Break?" });
    const { within } = await import("@testing-library/react");
    await user.click(within(dialog).getByRole("button", { name: "Start my break" }));
    expect(onTakeBreak).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getAllByRole("button", { name: "Cancel" })[1]);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(<SatUnscheduledBreakDialog open={false} onCancel={() => undefined} onTakeBreak={() => undefined} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("SatUnscheduledBreakVeil", () => {
  it("shows live timer and returns to test", async () => {
    const user = userEvent.setup();
    const onReturn = vi.fn();
    render(<SatUnscheduledBreakVeil open remainingLabel="18:46" onReturn={onReturn} />);
    expect(screen.getByRole("alertdialog", { name: "Unscheduled Break" })).toBeInTheDocument();
    expect(screen.getByText(/timer is still running/)).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("18:46");
    await user.click(screen.getByRole("button", { name: "Return to Test" }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(<SatUnscheduledBreakVeil open={false} remainingLabel="18:46" onReturn={() => undefined} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
