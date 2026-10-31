import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../domain/satCopy";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";
import { SatQuestionNavigator } from "./SatQuestionNavigator";

const items: readonly SatQuestionNavigationItem[] = [
  { id: "q1", index: 0, number: 1, status: "answered", current: false, markedForReview: false },
  { id: "q2", index: 1, number: 2, status: "invalid", current: false, markedForReview: false },
  { id: "q3", index: 2, number: 3, status: "unanswered", current: false, markedForReview: false },
];

describe("SatQuestionNavigator invalid SPR status", () => {
  it("announces a malformed answer as needing fixing, not unanswered", () => {
    const onSelectQuestion = vi.fn();
    render(
      <SatQuestionNavigator
        open
        sectionLabel="Math"
        items={items}
        onSelectQuestion={onSelectQuestion}
        onReviewModule={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const invalid = screen.getByRole("button", { name: "Question 2, answer needs fixing" });
    expect(invalid).toHaveAttribute("data-sat-navigator-invalid", "true");
    expect(screen.getByText(SAT_COPY.review.invalidStatus)).toBeInTheDocument();

    fireEvent.click(invalid);
    expect(onSelectQuestion).toHaveBeenCalledWith(1);
  });
});
