import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatTimerWarning } from "./SatTimerWarning";

describe("SatTimerWarning", () => {
  it("shows title, live remaining time, and dismisses", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<SatTimerWarning open remainingLabel="04:59" onDismiss={onDismiss} />);
    expect(screen.getByRole("alertdialog", { name: "5 Minutes Remaining" })).toBeInTheDocument();
    expect(screen.getByTestId("sat-timer-warning-time")).toHaveTextContent("04:59");
    await user.click(screen.getByRole("button", { name: "Dismiss timer warning" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(<SatTimerWarning open={false} remainingLabel="04:59" onDismiss={() => undefined} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
