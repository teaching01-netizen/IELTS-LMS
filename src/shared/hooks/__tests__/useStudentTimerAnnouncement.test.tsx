import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStudentTimerAnnouncement } from "../useStudentTimerAnnouncement";

function Harness({ seconds }: { seconds: number | undefined }) {
  const announcement = useStudentTimerAnnouncement(seconds);
  return <span data-testid="announcement">{announcement}</span>;
}

describe("useStudentTimerAnnouncement", () => {
  it("stays silent above the 5-minute threshold", () => {
    render(<Harness seconds={300} />);
    expect(screen.getByTestId("announcement")).toHaveTextContent("");
  });

  it("announces the 5-minute threshold once, then the 1-minute threshold once", () => {
    const { rerender } = render(<Harness seconds={301} />);
    rerender(<Harness seconds={299} />);
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Low time: 5 minutes remaining (04:59 left)"
    );
    rerender(<Harness seconds={298} />);
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Low time: 5 minutes remaining (04:59 left)"
    );
    rerender(<Harness seconds={59} />);
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      "Low time: 1 minute remaining (00:59 left)"
    );
  });

  it("re-arms after time moves back above the threshold (new section)", () => {
    const { rerender } = render(<Harness seconds={299} />);
    expect(screen.getByTestId("announcement")).toHaveTextContent("5 minutes remaining");
    rerender(<Harness seconds={3600} />);
    rerender(<Harness seconds={299} />);
    expect(screen.getByTestId("announcement")).toHaveTextContent("5 minutes remaining");
  });
});
