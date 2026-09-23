import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SatScheduledBreakScreen } from "./SatScheduledBreakScreen";
import { satBackdropAnimation, satSurfaceAnimation } from "../motion/satPresence";

describe("SatScheduledBreakScreen", () => {
  it("exposes one heading and a labelled timer while waiting for the scheduled break", () => {
    render(
      <SatScheduledBreakScreen
        phase="waiting-for-break"
        nextSectionKey="math"
        remainingSeconds={90}
      />,
    );

    const screenRoot = screen.getByTestId("sat-scheduled-break");
    expect(within(screenRoot).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(screenRoot).getByRole("timer", { name: "Time remaining 1:30" })).toHaveTextContent(
      "1:30",
    );
    expect(within(screenRoot).getByRole("heading")).toHaveTextContent("Your break begins in");
    expect(within(screenRoot).queryByRole("button", { name: /begin module/i })).toBeNull();
    expect(within(screenRoot).getAllByRole("status")).toHaveLength(1);
    expect(within(screenRoot).getByRole("status")).toHaveTextContent(
      "Section complete. Your scheduled break begins when the section clock ends.",
    );
  });

  it("uses one polite status message as the automatic entry begins", () => {
    render(
      <SatScheduledBreakScreen
        phase="opening-next-section"
        nextSectionKey="math"
        remainingSeconds={null}
        entryProgress="retrying"
      />,
    );

    const screenRoot = screen.getByTestId("sat-scheduled-break");
    expect(within(screenRoot).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(screenRoot).getAllByRole("status")).toHaveLength(1);
    expect(within(screenRoot).getByRole("status")).toHaveTextContent("Still opening Math.");
    expect(within(screenRoot).queryByRole("button")).toBeNull();
  });

  it("reduces transition motion to zero duration when requested", () => {
    expect(satSurfaceAnimation(true)).toMatchObject({
      initial: false,
      transition: { duration: 0 },
      exit: { opacity: 1, pointerEvents: "none", transition: { duration: 0 } },
    });
    expect(satBackdropAnimation(true)).toMatchObject({
      initial: false,
      transition: { duration: 0 },
      exit: { opacity: 1, pointerEvents: "none", transition: { duration: 0 } },
    });
  });
});
