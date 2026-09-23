import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../domain/satCopy";
import { SatSaveStatus } from "../feedback/SatSaveStatus";
import { SatReviewPage } from "../review/SatReviewPage";
import { SatCompleteScreen } from "../transitions/SatCompleteScreen";
import { SatPreStartScreen } from "../transitions/SatPreStartScreen";
import { SatExamFooter } from "../shell/SatExamFooter";
import { SatQuestionNavigator } from "../shell/SatQuestionNavigator";
import type { SatQuestionNavigationItem } from "../../domain/satSelectors";

const UI = __dirname + "/..";
const read = (rel: string) => readFileSync(resolve(UI, rel), "utf8");

const REVIEW_ITEMS: readonly SatQuestionNavigationItem[] = [
  { id: "q1", index: 0, number: 1, status: "answered", current: false, markedForReview: false },
  { id: "q2", index: 1, number: 2, status: "unanswered", current: false, markedForReview: false },
];

describe("Wave C R-11/R-12/R-15 copy-table contract (retained R-11 strings + R-12 key + R-15 canonical + alias-removed + H1 kept)", () => {
  it("lands the three retained R-11 strings", () => {
    // (1) takeBreak — shared with R-12.
    expect(SAT_COPY.unscheduledBreak.takeBreak).toBe("Start my break");
    // (2) reviewAnswers — shared with R-15.
    expect(SAT_COPY.navigation.reviewAnswers).toBe("Review answers");
    // (3) completeTitle — "SAT Complete": H1s are NOT sentence-case
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
        pendingSaveCount={0}
        saveFailure={null}
        saveFailureKind={null}
        onSelectQuestion={vi.fn()}
        onBack={vi.fn()}
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
  it("uses the same Digital SAT eyebrow on pre-start and completion surfaces", () => {
    const { unmount } = render(<SatCompleteScreen result={null} onExit={vi.fn()} />);
    expect(screen.getByText("Digital SAT")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SAT Complete" })).toBeInTheDocument();
    // The old echo word is gone from the eyebrow slot.
    expect(screen.queryByText("Complete", { exact: true })).not.toBeInTheDocument();
    unmount();
    render(
      <SatPreStartScreen
        reason="initial"
        runtimeStatus="not_started"
        proctorStatus="connecting"
        stageReady={false}
      />,
    );
    expect(screen.getAllByText("Digital SAT")).toHaveLength(1);
  });
});

describe("Wave C R-13 save region: silent while healthy, one alert when it matters", () => {
  it("Phase-01-style SR sign-off: routine states paint and announce nothing", () => {
    for (const state of ["idle", "saving", "offline", "retrying"] as const) {
      const { container, unmount } = render(
        <SatSaveStatus state={state} onRetrySave={vi.fn()} />,
      );
      // Nothing to see and nothing to announce: healthy saving is invisible.
      expect(container.querySelectorAll('[data-testid="sat-save-status"]').length).toBe(0);
      unmount();
    }
  });

  it("renders exactly the one alert region for a failure or a lost lease", () => {
    for (const state of ["failed", "superseded"] as const) {
      const { container, unmount } = render(
        <SatSaveStatus
          state={state}
          onRetrySave={vi.fn()}
          onTakeOver={state === "superseded" ? vi.fn() : undefined}
        />,
      );
      expect(container.querySelectorAll('[data-testid="sat-save-status"]').length).toBe(1);
      unmount();
    }
  });
});
