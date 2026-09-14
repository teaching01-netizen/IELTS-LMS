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
  it("keeps Highlight armed across questions and exits on Escape", () => {
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<SatExamShell {...props({ notesAvailable: true, questionIndex: 1 })} />);
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'false');
  });
  it("switches between Highlight, Underline, and Eraser modes", () => {
    render(<SatExamShell {...props({ notesAvailable: true })} />);
    const highlight = screen.getByRole('button', { name: 'Highlight' });
    const underline = screen.getByRole('button', { name: 'Underline' });
    const eraser = screen.getByRole('button', { name: 'Eraser' });

    fireEvent.click(highlight);
    expect(highlight).toHaveAttribute('aria-pressed', 'true');
    expect(underline).toHaveAttribute('aria-pressed', 'false');
    expect(eraser).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(underline);
    expect(highlight).toHaveAttribute('aria-pressed', 'false');
    expect(underline).toHaveAttribute('aria-pressed', 'true');
    expect(eraser).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(eraser);
    expect(highlight).toHaveAttribute('aria-pressed', 'false');
    expect(underline).toHaveAttribute('aria-pressed', 'false');
    expect(eraser).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(eraser).toHaveAttribute('aria-pressed', 'false');
  });
  it("pins Display, Question note, and More panels to the top bar (never the shell bottom)", () => {
    render(<SatExamShell {...props({ notesAvailable: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    const display = screen.getByRole("dialog", { name: "Display" });
    expect(display).toHaveAttribute("data-sat-popover-panel", "anchored");
    expect(display.className).toMatch(/fixed/);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Question note" }));
    const note = screen.getByRole("dialog", { name: /Question note/ });
    expect(note).toHaveAttribute("data-sat-popover-panel", "anchored");
    expect(note.className).toMatch(/fixed/);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    const menu = screen.getByRole("menu", { name: "More tools" });
    expect(menu).toHaveAttribute("data-sat-popover-panel", "anchored");
    expect(menu.className).toMatch(/fixed/);
  });
  it("shows annotation tools and Question note in Reading and Writing; hides them in Math", () => {
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: true })} />);
    expect(screen.getByRole('button', { name: 'Highlight' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Underline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eraser' })).toBeInTheDocument();
    // The freeform note is always reachable, never gated on annotation mode.
    expect(screen.getByRole('button', { name: 'Question note' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(screen.getByRole('button', { name: 'Question note' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Question note' })).toBeInTheDocument();
    rerender(<SatExamShell {...props({ notesAvailable: false })} />);
    expect(screen.queryByRole('button', { name: 'Highlight' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Underline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eraser' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Question note' })).not.toBeInTheDocument();
  });
  it("disables annotation tools while the exam is blocked", () => {
    render(<SatExamShell {...props({ notesAvailable: true, blocked: true })} />);
    expect(screen.getByRole('button', { name: 'Highlight' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Underline' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Eraser' })).toBeDisabled();
  });
  it("shows SAT timer/tools with a quiet persistent save token (Phase 6f)", () => {
    render(<SatExamShell {...props()} />);
    expect(screen.getByText("34:58")).toBeInTheDocument();
    expect(screen.getByText("Ada Candidate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calculator" })).toBeInTheDocument();
    // Phase 6f: status lives next to the hand as a quiet token (not a
    // transient overlay, not a loud badge) — Saved at idle, no live region.
    const indicator = screen.getByTestId("sat-footer-save-indicator");
    expect(indicator).toHaveAttribute("data-sat-save-state", "idle");
    expect(indicator).toHaveTextContent("All answers saved");
  });

  it("opens Display settings and emits presentation-only preference changes", () => {
    const onReadingPreferencesChange = vi.fn();
    render(<SatExamShell {...props({ onReadingPreferencesChange })} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    const dialog = screen.getByRole("dialog", { name: "Display" });
    expect(dialog).toHaveTextContent("Only changes how the exam looks.");
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

  it("hides Highlight and Question note in Math and keeps both in Reading and Writing", () => {
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: false })} />);
    expect(screen.queryByRole("button", { name: "Highlight" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Question note" })).not.toBeInTheDocument();
    rerender(<SatExamShell {...props({ notesAvailable: true })} />);
    expect(screen.getByRole("button", { name: "Highlight" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Question note" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    expect(screen.queryByText("34:58")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show timer" })).toBeInTheDocument();
  });
  it("announces routine saving once through a single polite status region", () => {
    render(<SatExamShell {...props({ saveState: "saving" })} />);
    const statuses = screen.getAllByRole("status");
    // Exactly one save-status region (the timer announcer is the only other
    // status, and it stays empty outside threshold crossings).
    const saveStatuses = statuses.filter((node) => node.hasAttribute("data-sat-save-state"));
    expect(saveStatuses).toHaveLength(1);
    expect(saveStatuses[0]).toHaveTextContent("Saving…");
  });

  it("auto-reveals a hidden timer once at the 5-minute threshold and lets it hide again", () => {
    const { rerender } = render(<SatExamShell {...props({ remainingLabel: "05:02", remainingSeconds: 302 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    expect(screen.queryByText("05:02")).not.toBeInTheDocument();
    rerender(<SatExamShell {...props({ remainingLabel: "05:00", remainingSeconds: 300 })} />);
    // Timer label + warning card both show the value (warning uses a testid).
    expect(screen.getAllByText("05:00")).toHaveLength(2);
    expect(screen.getByTestId("sat-timer-warning-time")).toHaveTextContent("05:00");
    expect(screen.getByRole("button", { name: "Hide timer" })).toBeInTheDocument();
    // The visual warning is dismissible and display-only.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss timer warning" }));
    expect(screen.queryByTestId("sat-timer-warning")).not.toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("05:00");
    // One-shot: hiding again after the reveal must stick.
    fireEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    rerender(<SatExamShell {...props({ remainingLabel: "04:59", remainingSeconds: 299 })} />);
    expect(screen.queryByText("04:59")).not.toBeInTheDocument();
    // A fresh module (time back above five minutes) re-arms the reveal.
    rerender(<SatExamShell {...props({ remainingLabel: "32:00", remainingSeconds: 1920 })} />);
    rerender(<SatExamShell {...props({ remainingLabel: "04:59", remainingSeconds: 299 })} />);
    expect(screen.getAllByText("04:59")).toHaveLength(2);
    expect(screen.getByTestId("sat-timer-warning")).toBeInTheDocument();
  });

  it("fires the reveal only once while remaining below five minutes", () => {
    const { rerender } = render(<SatExamShell {...props({ remainingLabel: "04:58", remainingSeconds: 298 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    // Still below the threshold but the one-shot already fired: stays hidden.
    rerender(<SatExamShell {...props({ remainingLabel: "04:57", remainingSeconds: 297 })} />);
    expect(screen.getByRole("button", { name: "Show timer" })).toBeInTheDocument();
  });

  it("arbitrates shell Escape: open Help owns it, Line Reader survives underneath", () => {
    const onReadingPreferencesChange = vi.fn();
    const readingPreferences = {
      ...createSatReadingPreferences(),
      lineReaderEnabled: true,
      lineReaderPosition: 0.5,
    };
    render(
      <SatExamShell
        {...props({
          notesAvailable: true,
          readingPreferences,
          onReadingPreferencesChange,
          helpOpen: true,
          onCloseHelp: vi.fn(),
        })}
      />,
    );
    // Help owns Escape here: the route modal stays open and the shell must
    // not double-handle (no Line Reader disable while Help is up).
    expect(screen.getByRole("dialog", { name: "Help" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onReadingPreferencesChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ lineReaderEnabled: false }),
    );
  });

  it("arbitrates shell Escape: open Shortcuts owns it, Line Reader survives underneath", () => {
    const onReadingPreferencesChange = vi.fn();
    const readingPreferences = {
      ...createSatReadingPreferences(),
      lineReaderEnabled: true,
      lineReaderPosition: 0.5,
    };
    render(
      <SatExamShell
        {...props({
          notesAvailable: true,
          readingPreferences,
          onReadingPreferencesChange,
          shortcutsOpen: true,
          onCloseShortcuts: vi.fn(),
        })}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onReadingPreferencesChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ lineReaderEnabled: false }),
    );
  });

  it("keeps Help and Shortcuts reachable read-only while blocked", () => {
    const { rerender } = render(
      <SatExamShell {...props({ blocked: true, helpOpen: true, onCloseHelp: vi.fn() })} />,
    );
    const help = screen.getByRole("dialog", { name: "Help" });
    expect(help).toBeInTheDocument();
    expect(help).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Close", exact: true })).not.toBeDisabled();
    // The blocked exam grid is inert (answers locked), but Help lives outside it.
    expect(screen.getByTestId("sat-exam-blocked-region")).toHaveAttribute("inert");
    expect(screen.getByTestId("sat-exam-blocked-region").contains(help)).toBe(false);
    rerender(
      <SatExamShell {...props({ blocked: true, shortcutsOpen: true, onCloseShortcuts: vi.fn() })} />,
    );
    const shortcuts = screen.getByRole("dialog", { name: "Keyboard Shortcuts" });
    expect(shortcuts).toBeInTheDocument();
    expect(shortcuts).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Close" })).not.toBeDisabled();
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
