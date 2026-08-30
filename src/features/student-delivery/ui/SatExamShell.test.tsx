import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSatReadingPreferences } from "../domain/satReadingPreferences";
import { SatExamShell, type SatExamShellProps } from "./SatExamShell";

function props(overrides: Partial<SatExamShellProps> = {}): SatExamShellProps {
  return {
    sectionLabel: "Section 2: Math",
    directions: null,
    remainingLabel: "34:58",
    candidateName: "Ada Candidate",
    questionIndex: 0,
    questionCount: 3,
    navigationItems: [
      { id: "q1", index: 0, number: 1, status: "answered", current: true, markedForReview: false },
      {
        id: "q2",
        index: 1,
        number: 2,
        status: "unanswered",
        current: false,
        markedForReview: true,
      },
      {
        id: "q3",
        index: 2,
        number: 3,
        status: "unanswered",
        current: false,
        markedForReview: false,
      },
    ],
    calculatorAvailable: true,
    calculatorOpen: false,
    referenceAvailable: true,
    referenceOpen: false,
    blocked: false,
    saveState: "idle",
    questionNote: "",
    readingPreferences: createSatReadingPreferences(),
    children: <div>Question body</div>,
    onSelectQuestion: vi.fn(),
    onToggleCalculator: vi.fn(),
    onToggleReference: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onReviewModule: vi.fn(),
    onSaveNote: vi.fn(),
    onReadingPreferencesChange: vi.fn(),
    ...overrides,
  };
}

describe("SatExamShell", () => {
  it("shows SAT timer/tools without a permanent saved badge", () => {
    render(<SatExamShell {...props()} />);
    expect(screen.getByText("34:58")).toBeInTheDocument();
    expect(screen.getByText("Ada Candidate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calculator" })).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("opens Reading and emits presentation-only preference changes", () => {
    const onReadingPreferencesChange = vi.fn();
    render(<SatExamShell {...props({ onReadingPreferencesChange })} />);
    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    const dialog = screen.getByRole("dialog", { name: "Reading" });
    expect(dialog).toHaveTextContent("Changes only how the exam looks.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Increase text size" }));
    expect(onReadingPreferencesChange).toHaveBeenCalledWith({
      version: 1,
      textScale: 1.15,
      lineSpacing: "standard",
      splitRatio: 0.5,
    });
  });

  it("does not render calculator controls when the module policy excludes them", () => {
    render(<SatExamShell {...props({ calculatorAvailable: false })} />);
    expect(screen.queryByRole("button", { name: "Calculator" })).not.toBeInTheDocument();
  });

  it("opens the bottom-anchored navigator and routes a selected question", () => {
    const onSelectQuestion = vi.fn();
    render(<SatExamShell {...props({ onSelectQuestion })} />);
    fireEvent.click(screen.getByRole("button", { name: /open question navigator/i }));
    const dialog = screen.getByRole("dialog", { name: /Section 2: Math Questions/i });
    expect(dialog).toHaveAttribute("data-sat-navigator-presentation", "anchored");
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(document.querySelector('[data-sat-navigator-anchor="footer"]')).toBeInTheDocument();
    expect(document.querySelector(".sat-dialog-backdrop")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /question 2/i }));
    expect(onSelectQuestion).toHaveBeenCalledWith(1);
    expect(
      screen.queryByRole("dialog", { name: /Section 2: Math Questions/i })
    ).not.toBeInTheDocument();
  });

  it("hides timer digits without changing the timer control", () => {
    render(<SatExamShell {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("34:58")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
  });
  it("keeps routine saving visual without announcing every autosave", () => {
    render(<SatExamShell {...props({ saveState: "saving" })} />);
    expect(screen.getByText("Saving…")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});
