import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReleaseGateCard } from "../ReleaseGateCard";

describe("ReleaseGateCard", () => {
  it("enables release only when checks are fresh, valid, clean, and idle", () => {
    render(
      <ReleaseGateCard
        readinessFresh
        readinessValid
        dirtyCount={0}
        isPublishing={false}
        blockerCount={0}
        releaseHref="/sat/exams/exam-1/release"
        onOpenRelease={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /open delivery.*release/i })).toBeEnabled();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("names missing publish permission as the first blocker", () => {
    render(
      <ReleaseGateCard
        readinessFresh
        readinessValid
        dirtyCount={0}
        isPublishing={false}
        blockerCount={0}
        releaseHref="/sat/exams/exam-1/release"
        canPublishExam={false}
        onOpenRelease={vi.fn()}
      />,
    );
    expect(screen.getByRole("list")).toHaveTextContent(/permission to publish/i);
  });

  it("enumerates every unmet precondition instead of hiding release", () => {
    render(
      <ReleaseGateCard
        readinessFresh={false}
        readinessValid={false}
        dirtyCount={2}
        isPublishing={false}
        blockerCount={3}
        releaseHref="/sat/exams/exam-1/release"
        onOpenRelease={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /open delivery.*release/i });
    expect(link).toHaveAttribute("aria-disabled", "true");
    // Reasons render once as list items; the same copy also lives in the
    // sr-only describedby node, so scope text queries to the list.
    const list = screen.getByRole("list");
    expect(list).toHaveTextContent(/3 blocking issues/i);
    expect(list).toHaveTextContent(/publish checks are stale/i);
    expect(list).toHaveTextContent(/2 unsaved delivery sections/i);
  });
});
