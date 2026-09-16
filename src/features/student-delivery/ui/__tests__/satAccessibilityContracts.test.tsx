import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSatReadingPreferences } from "../../domain/satReadingPreferences";
import { SatExamShell, type SatExamShellProps } from "../SatExamShell";
import { SatQuestionHeader } from "../question/SatQuestionHeader";

/**
 * SAT semantic question + dialog contracts (mobile accessibility Task 6).
 *
 * These assertions pin the ARIA relationship contracts without relying on
 * browser layout:
 * - the question number is real heading text, never a labelled generic div;
 * - a closed trigger exposes NO aria-controls (the panel is unmounted, so the
 *   attribute would dangle);
 * - an open trigger points at exactly one element — the role=dialog root;
 * - the navigator dialog is named by its own visible title;
 * - focus returns to the trigger on every close path.
 */

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
      { id: "q2", index: 1, number: 2, status: "unanswered", current: false, markedForReview: false },
      { id: "q3", index: 2, number: 3, status: "unanswered", current: false, markedForReview: false },
    ],
    calculatorAvailable: false,
    calculatorOpen: false,
    referenceAvailable: false,
    referenceOpen: false,
    notesAvailable: true,
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

/** Every aria-controls in the shell must resolve to exactly one live element. */
function expectNoDanglingAriaControls(root: HTMLElement) {
  const controlling = Array.from(root.querySelectorAll<HTMLElement>("[aria-controls]"));
  const unresolved: Array<{ trigger: string; id: string }> = [];
  for (const trigger of controlling) {
    const ids = (trigger.getAttribute("aria-controls") ?? "").split(/\s+/).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const targets = document.querySelectorAll(`[id="${id}"]`);
      if (targets.length !== 1) {
        unresolved.push({
          trigger: trigger.getAttribute("aria-label") ?? trigger.textContent?.trim() ?? "trigger",
          id,
        });
      }
    }
  }
  expect(unresolved).toEqual([]);
}

describe("SAT question semantics", () => {
  it("exposes the question number as real heading text instead of a labelled div", () => {
    render(
      <SatQuestionHeader
        questionNumber={7}
        markedForReview={false}
        eliminationAvailable={false}
        eliminationMode={false}
        disabled={false}
        onToggleReview={vi.fn()}
        onToggleEliminationMode={vi.fn()}
      />,
    );

    const heading = screen.getByRole("heading", { level: 2, name: "Question 7" });
    expect(heading).toHaveTextContent("7");
    // No aria-label on a generic element carries the question identity.
    expect(heading).not.toHaveAttribute("aria-label");
    expect(heading.querySelector('[aria-label="Question 7"]')).toBeNull();
  });
});

describe("SAT dialog relationships", () => {
  it("keeps closed triggers free of dangling aria-controls", () => {
    const { container } = render(<SatExamShell {...props()} />);

    const directions = screen.getByRole("button", { name: "Directions" });
    const navigator = screen.getByRole("button", { name: /Open question navigator/ });

    expect(directions).toHaveAttribute("aria-expanded", "false");
    expect(directions).toHaveAttribute("aria-haspopup", "dialog");
    expect(directions).not.toHaveAttribute("aria-controls");
    expect(navigator).toHaveAttribute("aria-expanded", "false");
    expect(navigator).toHaveAttribute("aria-haspopup", "dialog");
    expect(navigator).not.toHaveAttribute("aria-controls");

    expectNoDanglingAriaControls(container);
  });

  it("points the open Directions trigger at exactly the dialog root", () => {
    const { container } = render(<SatExamShell {...props()} />);

    const directions = screen.getByRole("button", { name: "Directions" });
    fireEvent.click(directions);

    const panelId = directions.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "Directions" });
    expect(dialog).toHaveAttribute("id", panelId);
    // Loose ends: exactly one element carries the id, and it is the dialog.
    const targets = document.querySelectorAll(`[id="${panelId}"]`);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBe(dialog);
    expectNoDanglingAriaControls(container);
  });

  it("points the open navigator trigger at its dialog root and names it by its title", () => {
    const { container } = render(<SatExamShell {...props()} />);

    const navigator = screen.getByRole("button", { name: /Open question navigator/ });
    fireEvent.click(navigator);

    const panelId = navigator.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const dialog = screen.getByRole("dialog", { name: "Section 2: Math Questions" });
    expect(dialog).toHaveAttribute("id", panelId);
    expect(document.querySelectorAll(`[id="${panelId}"]`)).toHaveLength(1);

    // The accessible name comes from the visible heading, not a duplicate.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const title = document.getElementById(labelledBy!);
    expect(title).not.toBeNull();
    expect(title!.tagName).toBe("H2");
    expect(title).toHaveTextContent("Section 2: Math Questions");
    expect(dialog).toHaveAccessibleName("Section 2: Math Questions");
    expectNoDanglingAriaControls(container);
  });

  it("returns focus to the Directions trigger after Escape, outside press, and the close control", async () => {
    render(<SatExamShell {...props()} />);
    const directions = screen.getByRole("button", { name: "Directions" });

    fireEvent.click(directions);
    expect(screen.getByRole("dialog", { name: "Directions" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Directions" })).not.toBeInTheDocument();
    expect(directions).toHaveFocus();

    fireEvent.click(directions);
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Directions" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(directions).toHaveFocus());

    fireEvent.click(directions);
    fireEvent.click(screen.getByRole("button", { name: "Close directions" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Directions" })).not.toBeInTheDocument(),
    );
    expect(directions).toHaveFocus();
  });

  it("does not steal focus from an outside control that owns the press", async () => {
    render(<SatExamShell {...props()} />);
    const directions = screen.getByRole("button", { name: "Directions" });

    fireEvent.click(directions);
    const display = screen.getByRole("button", { name: "Display" });
    fireEvent.pointerDown(display);
    // The browser's own focus change for the pressed control.
    display.focus();

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Directions" })).not.toBeInTheDocument(),
    );
    expect(directions).not.toHaveFocus();
    expect(display).toHaveFocus();
  });

  it("returns focus to the footer navigator trigger on every close path", async () => {
    render(<SatExamShell {...props()} />);
    const trigger = screen.getByRole("button", { name: /Open question navigator/ });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Section 2: Math Questions" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close question navigator" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Section 2: Math Questions" }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
});
