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
  it("renders the compact ABC cut icon at the far right of the header", () => {
    const { unmount } = renderHeader(false);
    const closed = screen.getByRole("button", { name: "Turn on cross-out mode" });
    // The glyph is drawn here (letters + diagonal strike), not a generic icon.
    const glyph = closed.querySelector('[data-sat-eliminator-glyph="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveTextContent("ABC");
    // Visual box ~36px inside a 44px hit target, pushed to the header's edge.
    expect(closed.className).toContain("sat-touch-target");
    expect(closed.className).toContain("h-11");
    expect(closed.className).toContain("w-11");
    expect(closed.className).toContain("ml-auto");
    expect(glyph!.className).toContain("h-9");
    expect(glyph!.className).toContain("w-9");
    // The old text treatment is gone.
    expect(closed).not.toHaveTextContent("Option Eliminator");
    unmount();
    renderHeader(true);
    // Same control, same name shape; only the state changed.
    expect(
      screen.getByRole("button", { name: "Turn off cross-out mode" }).querySelector(
        '[data-sat-eliminator-glyph="true"]'
      )
    ).not.toBeNull();
  });

  it("inverts the glyph ink between the outline and SAT blue treatments", () => {
    const { unmount } = renderHeader(false);
    const closed = screen.getByRole("button", { name: "Turn on cross-out mode" });
    // Closed: light surface with a dark-blue outline.
    expect(closed.innerHTML).toContain("var(--sat-accent-strong)");
    expect(closed.innerHTML).toContain("bg-[var(--sat-surface)]");
    expect(closed.innerHTML).not.toContain("bg-[var(--sat-accent)]");
    unmount();
    renderHeader(true);
    const open = screen.getByRole("button", { name: "Turn off cross-out mode" });
    // Open: the filled SAT blue treatment.
    expect(open.innerHTML).toContain("bg-[var(--sat-accent)]");
    expect(open.innerHTML).toContain("var(--sat-accent-text)");
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

  it("carries state in aria-pressed and a title, never in the accessible name's identity", () => {
    const { unmount } = renderHeader(true);
    const toggle = screen.getByRole("button", { name: "Turn off cross-out mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("title", "Turn off cross-out mode");
    expect(toggle).toHaveAttribute("data-sat-eliminator-toggle", "true");
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
