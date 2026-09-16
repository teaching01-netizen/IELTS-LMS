import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatQuestionHeader } from "./SatQuestionHeader";

function renderHeader(mode: boolean) {
  return render(
    <SatQuestionHeader
      questionNumber={3}
      markedForReview={false}
      eliminationAvailable
      eliminationMode={mode}
      disabled={false}
      onToggleReview={vi.fn()}
      onToggleEliminationMode={vi.fn()}
    />
  );
}

describe("SatQuestionHeader question semantics", () => {
  it("exposes the question number as real h2 heading text", () => {
    renderHeader(false);
    const heading = screen.getByRole("heading", { level: 2, name: "Question 3" });
    // Visible glyph is the number only; the "Question " prefix is sr-only.
    expect(heading).toHaveTextContent("3");
    expect(heading).not.toHaveAttribute("aria-label");
    expect(heading.className).toContain("w-11");
    expect(heading.className).toContain("place-items-center");
  });
});

describe("SatQuestionHeader eliminator (Phase 6e endgame)", () => {
  it("carries a visible static label in both states", () => {
    const { unmount } = renderHeader(false);
    // Bluebook parity (Phase 6): ABC strikethrough + Option Eliminator.
    expect(screen.getByRole("button", { name: "Turn on cross-out mode" })).toHaveTextContent(
      "Option Eliminator"
    );
    unmount();
    renderHeader(true);
    // Static label: state lives in fill + aria-pressed, never label text.
    expect(screen.getByRole("button", { name: "Turn off cross-out mode" })).toHaveTextContent(
      "Option Eliminator"
    );
  });

  it("uses Bluebook mark vocabulary", () => {
    render(
      <SatQuestionHeader
        questionNumber={1}
        markedForReview={false}
        eliminationAvailable={false}
        eliminationMode={false}
        disabled={false}
        onToggleReview={vi.fn()}
        onToggleEliminationMode={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Mark for Review", exact: false })).toBeInTheDocument();
  });

  it("fills ONLY the bookmark icon review-red when marked, with aria-pressed true and a black label", () => {
    const { unmount } = render(
      <SatQuestionHeader
        questionNumber={1}
        markedForReview
        eliminationAvailable={false}
        eliminationMode={false}
        disabled={false}
        onToggleReview={vi.fn()}
        onToggleEliminationMode={vi.fn()}
      />
    );
    const review = screen.getByRole("button", { name: "Marked for Review" });
    expect(review).toHaveAttribute("aria-pressed", "true");
    // Review red lives on the icon fill only; the label keeps text color.
    expect(review.innerHTML).toContain("var(--sat-review-active)");
    expect(review.className).toContain("var(--sat-text)");
    expect(review.className).not.toMatch(/bg-\[var\(--sat-review/);
    unmount();
    render(
      <SatQuestionHeader
        questionNumber={1}
        markedForReview={false}
        eliminationAvailable={false}
        eliminationMode={false}
        disabled={false}
        onToggleReview={vi.fn()}
        onToggleEliminationMode={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Mark for Review" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("tokenizes the eliminator static ABC-strikethrough label with fill + aria-pressed state", () => {
    const { unmount } = renderHeader(true);
    const toggle = screen.getByRole("button", { name: "Turn off cross-out mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle.innerHTML).toContain("var(--sat-accent");
    expect(toggle).toHaveTextContent("Option Eliminator");
    unmount();
    renderHeader(false);
    expect(screen.getByRole("button", { name: "Turn on cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("exposes state through aria-pressed and keeps the control reachable", () => {
    const onToggle = vi.fn();
    render(
      <SatQuestionHeader
        questionNumber={1}
        markedForReview={false}
        eliminationAvailable
        eliminationMode={false}
        disabled={false}
        onToggleReview={vi.fn()}
        onToggleEliminationMode={onToggle}
      />
    );
    const toggle = screen.getByRole("button", { name: "Turn on cross-out mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
