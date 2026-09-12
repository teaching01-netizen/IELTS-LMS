import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../domain/satCopy";
import { SatSaveStatus } from "../feedback/SatSaveStatus";
import { SatReviewPage } from "../review/SatReviewPage";
import { SatCompleteScreen } from "../transitions/SatCompleteScreen";
import { SatDirectionsScreen } from "../transitions/SatDirectionsScreen";
import { SatExamFooter } from "../shell/SatExamFooter";
import { SatQuestionNavigator } from "../shell/SatQuestionNavigator";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";

const UI = __dirname + "/..";
const read = (rel: string) => readFileSync(resolve(UI, rel), "utf8");

const REVIEW_ITEMS: readonly SatQuestionNavigationItem[] = [
  { id: "q1", index: 0, number: 1, status: "answered", current: false, markedForReview: false },
  { id: "q2", index: 1, number: 2, status: "unanswered", current: false, markedForReview: false },
];

describe("Wave C R-11/R-12/R-15 copy-table contract (4 R-11 strings + R-12 key + R-15 canonical + alias-removed + H1 kept)", () => {
  it("lands the four R-11 strings", () => {
    // (1) takeBreak — shared with R-12.
    expect(SAT_COPY.unscheduledBreak.takeBreak).toBe("Start my break");
    // (2) reviewAnswers — shared with R-15.
    expect(SAT_COPY.navigation.reviewAnswers).toBe("Review answers");
    // (3) timerWarning.title — Title Case alert-title fragment.
    expect(SAT_COPY.timerWarning.title).toBe("5 Minutes Remaining");
    // (4) completeTitle — "SAT Complete": H1s are NOT sentence-case
    // house-wide (directions H1 = Title Case section label, group headings =
    // Title Case; only the review H1 keeps sentence case as a deliberate
    // CTA-bare/H1-pronoun exception), so the complete H1 reads as a Title
    // Case fragment. This decision settles the R-14 casing pair.
    expect(SAT_COPY.transitions.completeTitle).toBe("SAT Complete");
  });

  it("keeps the review H1 pronoun while the CTA stays bare (R-14/R-15 rule)", () => {
    expect(SAT_COPY.review.eyebrow).toBe("Review your answers");
  });

  it("removes the reviewAnswersAlias key (R-15)", () => {
    expect(
      (SAT_COPY.navigation as Record<string, unknown>).reviewAnswersAlias,
    ).toBeUndefined();
  });

  it("pins the no-hardcoded-copy convention for the touched strings", () => {
    // G-4 vocabulary guard for this wave: the touched surfaces render the
    // copy-table keys, never hardcoded duplicates.
    expect(read("shell/SatExamFooter.tsx")).toContain("SAT_COPY.navigation.reviewAnswers");
    expect(read("shell/SatQuestionNavigator.tsx")).toContain("SAT_COPY.navigation.reviewAnswers");
    expect(read("break/SatUnscheduledBreakDialog.tsx")).toContain("SAT_COPY.unscheduledBreak.takeBreak");
    expect(read("transitions/SatCompleteScreen.tsx")).toContain("SAT_COPY.transitions.completeTitle");
    expect(read("review/SatReviewPage.tsx")).toContain("SAT_COPY.review.eyebrow");
  });
});

describe("Wave C R-15 footer CTA === navigator CTA === H1-minus-pronoun", () => {
  it("renders one canonical destination in both CTAs and derives the H1 rule", () => {
    const onReviewModule = vi.fn();
    const { unmount } = render(
      <SatExamFooter
        candidateName="Ada"
        questionIndex={2}
        questionCount={3}
        navigatorOpen={false}
        navigatorButtonId="sat-nav-button"
        navigatorPanelId="sat-nav-panel"
        blocked={false}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onOpenNavigator={vi.fn()}
        onReviewModule={onReviewModule}
      />,
    );
    const footerCta = screen.getByRole("button", { name: /Review answers/ });
    expect(footerCta).toHaveTextContent("Review answers");
    unmount();

    render(
      <SatQuestionNavigator
        id="sat-nav-panel"
        open
        sectionLabel="Section 1: Reading and Writing"
        items={REVIEW_ITEMS}
        onSelectQuestion={vi.fn()}
        onReviewModule={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const navigatorCta = screen.getByRole("button", { name: /Review answers/ });
    expect(navigatorCta).toHaveTextContent("Review answers");

    // H1-minus-pronoun: strip the H1-owned pronoun and the CTA must remain.
    // (The footer CTA also carries an sr-only last-question descriptor via
    // aria-describedby — excluded here; the accessible *name* is already
    // pinned to /Review answers/ by the getByRole query above.)
    const h1MinusPronoun = SAT_COPY.review.eyebrow.replace(" your", "");
    const footerVisible = footerCta.textContent
      ?.replace(/Question \d+ of \d+, last question/, "")
      .replace(/\s+/g, " ")
      .trim();
    expect(footerVisible).toBe(h1MinusPronoun);
    expect(navigatorCta.textContent?.replace(/\s+/g, " ").trim()).toBe(h1MinusPronoun);
  });
});

describe("Wave C R-14 review subhead drops the eyebrow echo", () => {
  it("shows the module title alone above the H1 (no repeated eyebrow)", () => {
    render(
      <SatReviewPage
        sectionLabel="Section 1: Reading and Writing"
        moduleTitle="Module 1"
        remainingLabel="12:00"
        items={REVIEW_ITEMS}
        answeredCount={1}
        isSubmitting={false}
        persistenceBlocked={false}
        onSelectQuestion={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    // H1 still owns the pronoun.
    expect(screen.getByRole("heading", { name: "Review your answers" })).toBeInTheDocument();
    // The subhead carries the module scope only — the eyebrow echo is gone.
    const subhead = screen.getByText("Module 1");
    expect(subhead).toBeInTheDocument();
    expect(subhead.textContent).not.toContain("Review your answers");
    // Exactly one "Review your answers" string on the screen (the H1).
    expect(screen.getAllByText("Review your answers")).toHaveLength(1);
  });
});

describe("Wave C R-14 complete eyebrow becomes Digital SAT", () => {
  it("stacks Digital SAT above the SAT Complete H1 (matches directions)", () => {
    render(<SatCompleteScreen result={null} onExit={vi.fn()} />);
    expect(screen.getByText("Digital SAT")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SAT Complete" })).toBeInTheDocument();
    // The old echo word is gone from the eyebrow slot.
    expect(screen.queryByText("Complete", { exact: true })).not.toBeInTheDocument();
    // Directions eyebrow parity: same section-agnostic eyebrow string.
    expect(read("transitions/SatDirectionsScreen.tsx")).toContain("Digital SAT");
  });
});

describe("Wave C R-16b offline reassurance clause", () => {
  it("appends the keep-working clause; the retrying branch is unchanged", () => {
    expect(SAT_COPY.saveStatus.offline).toBe(
      "Offline \u2014 answers kept on this device. Keep working; saving resumes automatically.",
    );
    expect(SAT_COPY.saveStatus.retrying).toBe("Reconnecting \u2014 retrying save\u2026");
    render(<SatSaveStatus state="offline" onRetrySave={vi.fn()} />);
    const status = screen.getByTestId("sat-save-status");
    // Banner renders the full reassured string via the same key.
    expect(status).toHaveTextContent("Keep working; saving resumes automatically.");
    // No dead retry action in the offline branch (a dead offline retry is
    // worse than guidance — F-04-04 judgment).
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Wave C R-16c leave-confirm destutter", () => {
  it("states the same two facts without the stutter or the abstract term", () => {
    expect(SAT_COPY.directions.leaveConfirmBody).toBe(
      "Answers you have already saved stay saved. Anything you are typing right now may not.",
    );
    expect(SAT_COPY.directions.leaveConfirmBody).not.toContain("Unsaved work");
    // Title + buttons unchanged.
    expect(SAT_COPY.directions.leaveConfirmTitle).toBe("Leave this exam?");
    expect(SAT_COPY.directions.stayAndContinue).toBe("Stay and continue");
    expect(SAT_COPY.directions.leaveForSure).toBe("Leave without saving more");
  });

  it("reaches the modal description + visible paragraph through the same key", () => {
    render(
      <SatDirectionsScreen
        module={null}
        sectionLabel="Section 1: Reading and Writing"
        runtimeStatus="live"
        proctorStatus="active"
        isStarting={false}
        error={null}
        onStart={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave exam" }));
    const dialog = screen.getByRole("dialog", { name: "Leave this exam?" });
    expect(dialog).toHaveTextContent("Anything you are typing right now may not.");
    expect(dialog).not.toHaveTextContent("Unsaved work");
  });
});

describe("Wave C R-13 saving glyph: single polite region announces the identical string exactly once", () => {
  it("prepends one aria-hidden 16px neutral glyph; live region unchanged", () => {
    const { container } = render(<SatSaveStatus state="saving" />);
    const status = screen.getByTestId("sat-save-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-live", "polite");
    // Identical string, exactly once.
    expect(status).toHaveTextContent(SAT_COPY.saveStatus.saving);
    // Exactly one live region in the banner — no new live region.
    expect(container.querySelectorAll('[aria-live]').length).toBe(1);
    expect(screen.getAllByTestId("sat-save-status")).toHaveLength(1);
    // The glyph: 16px (h-4 w-4), neutral (inherits the banner secondary
    // color — no color class of its own), hidden from AT, calm under
    // reduced motion.
    const glyph = status.querySelector('svg[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute("class")).toContain("h-4");
    expect(glyph?.getAttribute("class")).toContain("w-4");
    expect(glyph?.getAttribute("class")).toContain("motion-reduce:animate-none");
    expect(glyph?.getAttribute("class")).not.toMatch(/text-\[var\(--sat-(danger|warning|accent)/);
  });

  it("Phase-01-style SR sign-off: no new live region in any save state", () => {
    for (const state of ["saving", "offline", "retrying", "failed", "superseded"] as const) {
      const { container, unmount } = render(
        <SatSaveStatus
          state={state}
          onRetrySave={vi.fn()}
          onTakeOver={state === "superseded" ? vi.fn() : undefined}
        />,
      );
      // At most the one banner region (failed/superseded use role=alert by
      // design; saving/offline/retrying use the single polite region).
      expect(container.querySelectorAll('[data-testid="sat-save-status"]').length).toBe(1);
      unmount();
    }
  });
});
