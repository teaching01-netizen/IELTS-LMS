import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../domain/satCopy";
import { SatControlBanner, SatLeaseConflictNotice } from "../feedback/SatControlFeedback";
import { SatReviewPage } from "./SatReviewPage";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";

const items: readonly SatQuestionNavigationItem[] = [
  { id: "q1", index: 0, number: 1, status: "answered", current: false, markedForReview: false },
  { id: "q2", index: 1, number: 2, status: "unanswered", current: false, markedForReview: true },
  { id: "q3", index: 2, number: 3, status: "unanswered", current: false, markedForReview: false },
];

function renderReview(overrides = {}) {
  return render(
    <SatReviewPage
      sectionLabel="Section 1: Reading and Writing"
      moduleTitle="Module 1"
      remainingLabel="12:00"
      items={items}
      answeredCount={1}
      pendingSaveCount={0}
      saveFailure={null}
      saveFailureKind={null}
      onSelectQuestion={vi.fn()}
      onBack={vi.fn()}
      {...overrides}
    />,
  );
}

describe("SatReviewPage", () => {
  it("keeps review and return navigation without a module-submit control or dialog", () => {
    const onSelectQuestion = vi.fn();
    const onBack = vi.fn();
    renderReview({ onSelectQuestion, onBack, currentQuestionIndex: 1 });

    expect(screen.getByRole("heading", { name: SAT_COPY.review.eyebrow })).toBeInTheDocument();
    expect(screen.getByText("2 unanswered")).toBeInTheDocument();
    expect(screen.getByText("1 flagged")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("sat-submit-confirm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Question 2, unanswered, flagged" }));
    expect(onSelectQuestion).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Back to question 2" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.getByRole("timer")).toHaveTextContent("12:00");
  });

  it("shows an in-progress save status while keeping review available", () => {
    renderReview({ pendingSaveCount: 2 });
    expect(screen.getByRole("status")).toHaveTextContent(SAT_COPY.review.savingAnswers);
    expect(screen.getByRole("button", { name: "Back to questions" })).toBeEnabled();
  });

  it("shows offline state and keeps Retry Save available", () => {
    const onRetrySave = vi.fn();
    renderReview({
      pendingSaveCount: 1,
      saveFailure: "Offline",
      saveFailureKind: "offline",
      onRetrySave,
    });
    expect(screen.getByRole("alert")).toHaveTextContent(SAT_COPY.review.saveOffline);
    fireEvent.click(screen.getByRole("button", { name: SAT_COPY.review.retrySave }));
    expect(onRetrySave).toHaveBeenCalledOnce();
  });

  it("shows a failed-save reason and allows retry", () => {
    const onRetrySave = vi.fn();
    renderReview({
      saveFailure: "Gateway timeout",
      saveFailureKind: "retryable",
      onRetrySave,
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Gateway timeout");
    fireEvent.click(screen.getByRole("button", { name: SAT_COPY.review.retrySave }));
    expect(onRetrySave).toHaveBeenCalledOnce();
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

  it("places recovery notices in their own row above review content", () => {
    const onTakeOver = vi.fn();
    const { container } = renderReview({
      notices: <>
        <SatControlBanner tone="warning">Proctor message</SatControlBanner>
        <SatLeaseConflictNotice error="Save ownership changed" isTakingOver={false} onTakeOver={onTakeOver} />
      </>,
    });
    const page = container.querySelector(".sat-review-page")!;
    const notices = screen.getByTestId("sat-review-notices");
    const content = page.querySelector("main")!;
    expect(notices).toContainElement(screen.getByRole("status"));
    expect(notices).toContainElement(screen.getByRole("alert"));
    expect(notices.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notices.className).not.toMatch(/fixed|absolute/);
    for (const notice of [screen.getByRole("status"), screen.getByRole("alert")]) {
      expect(notice.className).not.toMatch(/fixed|absolute/);
    }
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(onTakeOver).toHaveBeenCalledOnce();
  });
});

describe("SatReviewPage timer announcer", () => {
  it("stays silent without remainingSeconds and announces thresholds announce-only", () => {
    const { rerender, unmount } = renderReview();
    const props = {
      sectionLabel: "Section 1: Reading and Writing",
      moduleTitle: "Module 1",
      items,
      answeredCount: 1,
      pendingSaveCount: 0,
      saveFailure: null,
      saveFailureKind: null,
      onSelectQuestion: vi.fn(),
      onBack: vi.fn(),
    };
    const live = screen.getByTestId("sat-review-timer-announcement");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("");
    rerender(<SatReviewPage {...props} remainingLabel="05:01" remainingSeconds={301} />);
    rerender(<SatReviewPage {...props} remainingLabel="04:59" remainingSeconds={299} />);
    expect(screen.getByTestId("sat-review-timer-announcement")).toHaveTextContent(
      "Low time: 5 minutes remaining",
    );
    rerender(<SatReviewPage {...props} remainingLabel="04:58" remainingSeconds={298} />);
    expect(screen.getByTestId("sat-review-timer-announcement")).toHaveTextContent(
      "Low time: 5 minutes remaining (04:59 left)",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
  });

  it("keeps the timer toggle at target size with the quiet text-button treatment", () => {
    renderReview({ onToggleTimer: vi.fn() });
    const toggle = screen.getByRole("button", { name: "Hide timer" });
    expect(toggle.className).toContain("sat-touch-target");
    expect(toggle.className).not.toContain("rounded-full");
    expect(toggle.className).toContain("hover:underline");
    expect(toggle.querySelector("span")?.className).toContain("sat-type-control-secondary");
  });
});
