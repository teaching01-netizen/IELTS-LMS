import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createSatReadingPreferences } from "../domain/satReadingPreferences";
import { SatExamShell, type SatExamShellProps } from "./SatExamShell";

function shellProps(overrides: Partial<SatExamShellProps> = {}): SatExamShellProps {
  return {
    sectionLabel: "Section 1: Reading and Writing",
    directions: null,
    remainingLabel: "27:14",
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

describe("SatPopoverShell focus contract", () => {
  it("moves focus into Directions on desktop open and returns it on Escape", async () => {
    render(<SatExamShell {...shellProps()} />);
    const trigger = screen.getByRole("button", { name: "Directions" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Directions" });
    expect(dialog).toBeInTheDocument();
    // Focus moves on the next animation frame (shared popover contract).
    await waitFor(() => expect(screen.getByRole("button", { name: "Close directions" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Directions" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("moves focus into Display settings on open", async () => {
    render(<SatExamShell {...shellProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    expect(screen.getByRole("dialog", { name: "Display" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close display settings" })).toHaveFocus());
  });

  it("keeps save retry reachable while blocked (save UI lives outside inert)", () => {
    const onRetrySave = vi.fn();
    render(<SatExamShell {...shellProps({ blocked: true, saveState: "failed", onRetrySave })} />);
    // One Retry only (banner owns recovery; the footer token stays quiet).
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).not.toHaveAttribute("inert");
    const blockedRegion = screen.getByTestId("sat-exam-blocked-region");
    expect(blockedRegion).toHaveAttribute("inert");
    expect(blockedRegion.contains(retry)).toBe(false);
    fireEvent.click(retry);
    expect(onRetrySave).toHaveBeenCalledOnce();
  });
});
