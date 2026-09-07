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
  it("keeps highlight mode across questions, switches exclusively to underline, and exits on Escape", () => {
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<SatExamShell {...props({ notesAvailable: true, questionIndex: 1 })} />);
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Underline' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Underline' })).toHaveAttribute('aria-pressed', 'false');
  });
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

  it("hides Notes in Math and keeps them in Reading and Writing", () => {
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: false })} />);
    expect(screen.queryByRole("button", { name: "Notes" })).not.toBeInTheDocument();
    rerender(<SatExamShell {...props({ notesAvailable: true })} />);
    expect(screen.getByRole("button", { name: "Notes" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Hide time remaining" }));
    expect(screen.queryByText("34:58")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show time remaining" })).toBeInTheDocument();
  });
  it("keeps routine saving visual without announcing every autosave", () => {
    render(<SatExamShell {...props({ saveState: "saving" })} />);
    expect(screen.getByText("Saving…")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("auto-reveals a hidden timer once at the 5-minute threshold and lets it hide again", () => {
    const { rerender } = render(<SatExamShell {...props({ remainingLabel: "05:02", remainingSeconds: 302 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide time remaining" }));
    expect(screen.queryByText("05:02")).not.toBeInTheDocument();
    rerender(<SatExamShell {...props({ remainingLabel: "05:00", remainingSeconds: 300 })} />);
    expect(screen.getByText("05:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide time remaining" })).toBeInTheDocument();
    // One-shot: hiding again after the reveal must stick.
    fireEvent.click(screen.getByRole("button", { name: "Hide time remaining" }));
    rerender(<SatExamShell {...props({ remainingLabel: "04:59", remainingSeconds: 299 })} />);
    expect(screen.queryByText("04:59")).not.toBeInTheDocument();
    // A fresh module (time back above five minutes) re-arms the reveal.
    rerender(<SatExamShell {...props({ remainingLabel: "32:00", remainingSeconds: 1920 })} />);
    rerender(<SatExamShell {...props({ remainingLabel: "04:59", remainingSeconds: 299 })} />);
    expect(screen.getByText("04:59")).toBeInTheDocument();
  });

  it("fires the reveal only once while remaining below five minutes", () => {
    const { rerender } = render(<SatExamShell {...props({ remainingLabel: "04:58", remainingSeconds: 298 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide time remaining" }));
    // Still below the threshold but the one-shot already fired: stays hidden.
    rerender(<SatExamShell {...props({ remainingLabel: "04:57", remainingSeconds: 297 })} />);
    expect(screen.getByRole("button", { name: "Show time remaining" })).toBeInTheDocument();
  });

  it("announces the 5-minute warning once and never per tick (T2.5)", () => {
    // remainingSeconds drives the shared threshold announcer: 299s crosses
    // the 5-minute threshold exactly once; a re-render at 298s must not
    // change the announcement, and the per-tick label carries no live region.
    const { rerender } = render(<SatExamShell {...props({ remainingLabel: "04:59", remainingSeconds: 299 })} />);
    const announcement = screen.getByTestId("sat-timer-announcement");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveTextContent("Low time: 5 minutes remaining");
    rerender(<SatExamShell {...props({ remainingLabel: "04:58", remainingSeconds: 298 })} />);
    expect(screen.getByTestId("sat-timer-announcement")).toHaveTextContent(
      "Low time: 5 minutes remaining"
    );
  });
});
