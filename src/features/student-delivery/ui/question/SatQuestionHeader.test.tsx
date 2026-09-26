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
    // A 44px square inside a taller strip: inset, never stretched to the row.
    expect(heading.className).toContain("h-11");
  });
});

describe("SatQuestionHeader eliminator (Phase 6e endgame)", () => {
  it("renders the compact ABC cut icon at the far right of the header", () => {
    const { unmount } = renderHeader(false);
    const closed = screen.getByRole("button", { name: "Turn on cross-out mode" });
    // The header glyph is drawn here (letters + diagonal strike), not a
    // generic icon — and never the per-choice letter geometry.
    const glyph = closed.querySelector('[data-sat-eliminator-glyph="header"]');
    expect(glyph).not.toBeNull();
    expect(glyph).toHaveTextContent("ABC");
    expect(closed.querySelector('[data-sat-eliminator-glyph="choice"]')).toBeNull();
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
        '[data-sat-eliminator-glyph="header"]'
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

describe("SatQuestionHeader spectrum rail (Phase 6g, visual-only)", () => {
  it("closes a white header with the shared decorative rail, touching no control", () => {
    renderHeader(false);
    const rail = document.querySelector('[data-sat-color-rail="true"]');
    expect(rail).not.toBeNull();
    expect(rail!.tagName).toBe("SPAN");
    expect(rail!.className).toContain("sat-color-rail");
    // Decoration, never content: not announced, not focusable, not a target.
    expect(rail).toHaveAttribute("aria-hidden", "true");
    expect(rail).not.toHaveAttribute("role");
    expect(rail).not.toHaveAttribute("tabindex");

    const header = rail!.parentElement!;
    // The strip is the reference's own light gray — NOT the white of the main
    // exam header, and not the shared surface-subtle that also dresses
    // eliminated answer rows and popover segments.
    expect(header.className).toContain("relative");
    expect(header.className).toContain("bg-[var(--sat-question-header-bg)]");
    expect(header.className).not.toContain("bg-[var(--sat-surface)]");
    expect(header.className).not.toContain("bg-[var(--sat-surface-subtle)]");
    // Reserved, transparent bottom border: the rail owns the visible edge, so
    // no divider colour contributes pixels, and the strip cannot resize.
    expect(header.className).toContain("border-b");
    expect(header.className).toContain("border-transparent");
    expect(header.className).not.toContain("var(--sat-divider)");
    // Reference geometry: a dedicated strip height with the controls centred.
    expect(header.className).toContain("min-h-[var(--sat-question-header-height)]");
    expect(header.className).toContain("items-center");
    expect(header.className).not.toContain("items-stretch");
    // Last child: painted over the row it closes, owned by no control.
    expect(header.lastElementChild).toBe(rail);
  });

  it("leaves exactly the two header controls interactive, in order", () => {
    render(
      <SatQuestionHeader
        questionNumber={3}
        markedForReview
        eliminationAvailable
        eliminationMode
        disabled={false}
        onToggleReview={vi.fn()}
        onToggleEliminationMode={vi.fn()}
      />
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Marked for Review",
      "Turn off cross-out mode",
    ]);
    // The rail adds no control, no image and no second heading.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
