import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSatReadingPreferences } from "../domain/satReadingPreferences";
import { SatExamShell, type SatExamShellProps } from "./SatExamShell";

function shellProps(overrides: Partial<SatExamShellProps> = {}): SatExamShellProps {
  return {
    sectionLabel: "Section 2: Math",
    directions: null,
    remainingLabel: "04:59",
    remainingSeconds: 299,
    candidateName: "Ada Candidate",
    questionIndex: 0,
    questionCount: 3,
    navigationItems: [
      { id: "q1", index: 0, number: 1, status: "answered", current: true, markedForReview: false },
      { id: "q2", index: 1, number: 2, status: "unanswered", current: false, markedForReview: false },
      { id: "q3", index: 2, number: 3, status: "unanswered", current: false, markedForReview: false },
    ],
    calculatorAvailable: false,
    calculatorOpen: false,
    referenceAvailable: false,
    referenceOpen: false,
    notesAvailable: false,
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

describe("SatExamFooter + timer honesty", () => {
  it("renders a distinct Review answers destination on the last question", () => {
    render(<SatExamShell {...shellProps({ questionIndex: 2, questionCount: 3 })} />);
    // Wave C R-15: canonical review-destination name on the last-question CTA.
    expect(screen.getByRole("button", { name: /Review answers/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next$/ })).not.toBeInTheDocument();
  });

  it("keeps Next on non-last questions", () => {
    render(<SatExamShell {...shellProps({ questionIndex: 0, questionCount: 3 })} />);
    expect(screen.getByRole("button", { name: "Next question" })).toBeInTheDocument();
  });

  it("announces the auto-reveal through its own live region", async () => {
    const { rerender } = render(<SatExamShell {...shellProps({ remainingLabel: "05:02", remainingSeconds: 302 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    expect(screen.getByRole("timer")).toHaveTextContent("Hidden");
    // Crossing into the sub-5-minute band reveals the hidden timer...
    rerender(<SatExamShell {...shellProps({ remainingLabel: "04:59", remainingSeconds: 299 })} />);
    await waitFor(() => expect(screen.getByTestId("sat-timer-reveal-announcement")).toHaveTextContent(/5 minutes left/));
    expect(screen.getByRole("timer")).toHaveTextContent("04:59");
  });
});
