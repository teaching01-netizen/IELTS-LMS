import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../domain/satCopy";
import { SatReviewPage } from "./SatReviewPage";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";

const items: readonly SatQuestionNavigationItem[] = [
  { id: "q1", index: 0, number: 1, status: "answered", current: false, markedForReview: false },
  { id: "q2", index: 1, number: 2, status: "unanswered", current: false, markedForReview: true },
  { id: "q3", index: 3, number: 3, status: "unanswered", current: false, markedForReview: false },
];

function renderReview(overrides = {}) {
  return render(
    <SatReviewPage
      sectionLabel="Section 1: Reading and Writing"
      moduleTitle="Module 1"
      remainingLabel="12:00"
      items={items}
      answeredCount={1}
      isSubmitting={false}
      persistenceBlocked={false}
      onSelectQuestion={vi.fn()}
      onBack={vi.fn()}
      onSubmit={vi.fn()}
      {...overrides}
    />,
  );
}

describe("SatReviewPage submit safety", () => {
  it("requires two steps: Submit opens a confirm that names scope and counts", async () => {
    const onSubmit = vi.fn();
    renderReview({ onSubmit });
    fireEvent.click(screen.getByRole("button", { name: SAT_COPY.submit.submitModule }));
    expect(onSubmit).not.toHaveBeenCalled();
    const dialog = screen.getByTestId("sat-submit-confirm");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Submit Module 1 answers?" })).toBeInTheDocument();
    expect(dialog).toHaveTextContent("2 unanswered");
    expect(dialog).toHaveTextContent("cannot return");
    // X close shares the cancel label: scope into the dialog footer.
    const { within } = await import("@testing-library/react");
    const footerButtons = within(dialog).getAllByRole("button", { name: SAT_COPY.review.keepChecking });
    fireEvent.click(footerButtons[footerButtons.length - 1]);
    expect(screen.queryByTestId("sat-submit-confirm")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: SAT_COPY.submit.submitModule }));
    fireEvent.click(screen.getByRole("button", { name: SAT_COPY.review.submitAnyway }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("stays silent while answers are still saving", () => {
    renderReview({
      readinessInput: { isSubmitting: false, failure: null, failureKind: null, pendingCount: 2 },
    });
    const button = screen.getByRole("button", { name: SAT_COPY.submit.submitModule });
    // Pending saves are not a decision the student can make, so nothing is
    // said about them: no reason text and no advisory aria-disabled.
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(/Waiting for/)).not.toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("hard-blocks retryable errors with reason and retry", () => {
    const onRetrySave = vi.fn();
    renderReview({
      readinessInput: { isSubmitting: false, failure: "Timeout", failureKind: "retryable", pendingCount: 0 },
      onRetrySave,
    });
    expect(screen.getByRole("button", { name: SAT_COPY.submit.submitModule })).toBeDisabled();
    expect(screen.getByText(/needs attention/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: SAT_COPY.saveStatus.retryNow }));
    expect(onRetrySave).toHaveBeenCalledOnce();
  });

  it("hard-blocks offline with an offline reason", () => {
    renderReview({
      readinessInput: { isSubmitting: false, failure: "Offline", failureKind: "offline", pendingCount: 0 },
    });
    expect(screen.getByRole("button", { name: SAT_COPY.submit.submitModule })).toBeDisabled();
    expect(screen.getByText(/kept on this device/)).toBeInTheDocument();
  });

  it("labels the exit with its destination question", () => {
    renderReview({ currentQuestionIndex: 1 });
    expect(screen.getByRole("button", { name: "Back to question 2" })).toBeInTheDocument();
  });

  it("renders the status legend with answered, unanswered, and flagged", () => {
    renderReview();
    expect(screen.getByText("Answered")).toBeInTheDocument();
    expect(screen.getByText("Unanswered")).toBeInTheDocument();
    expect(screen.getByText("Flagged")).toBeInTheDocument();
  });
});

describe("SatReviewPage timer announcer (Wave A R-04)", () => {
  it("stays silent without remainingSeconds and announces thresholds announce-only", () => {
    const { rerender, unmount } = renderReview();
    const live = screen.getByTestId("sat-review-timer-announcement");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("");
    // Sitting on review across 300s produces exactly one polite announcement.
    rerender(
      <SatReviewPage
        sectionLabel="Section 1: Reading and Writing"
        moduleTitle="Module 1"
        remainingLabel="05:01"
        remainingSeconds={301}
        items={items}
        answeredCount={1}
        isSubmitting={false}
        persistenceBlocked={false}
        onSelectQuestion={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    rerender(
      <SatReviewPage
        sectionLabel="Section 1: Reading and Writing"
        moduleTitle="Module 1"
        remainingLabel="04:59"
        remainingSeconds={299}
        items={items}
        answeredCount={1}
        isSubmitting={false}
        persistenceBlocked={false}
        onSelectQuestion={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("sat-review-timer-announcement")).toHaveTextContent(
      "Low time: 5 minutes remaining",
    );
    // No per-second chatter: a further tick keeps the same one-shot text.
    rerender(
      <SatReviewPage
        sectionLabel="Section 1: Reading and Writing"
        moduleTitle="Module 1"
        remainingLabel="04:58"
        remainingSeconds={298}
        items={items}
        answeredCount={1}
        isSubmitting={false}
        persistenceBlocked={false}
        onSelectQuestion={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("sat-review-timer-announcement")).toHaveTextContent(
      "Low time: 5 minutes remaining (04:59 left)",
    );
    // Announce-only: the submit confirm stays the only modal on review.
    expect(screen.queryByTestId("sat-submit-confirm")).not.toBeInTheDocument();
    unmount();
  });

  it("keeps the timer toggle at target size with the quiet text-button treatment (Wave A R-05)", () => {
    renderReview({ onToggleTimer: vi.fn() });
    const toggle = screen.getByRole("button", { name: "Hide timer" });
    expect(toggle.className).toContain("sat-touch-target");
    expect(toggle.className).not.toContain("rounded-full");
    expect(toggle.className).toContain("hover:underline");
    const label = toggle.querySelector("span");
    expect(label?.className).toContain("sat-type-control-secondary");
  });
});
