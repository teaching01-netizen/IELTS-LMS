import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createSatReadingPreferences } from "../domain/satReadingPreferences";
import { SatExamShell } from "./SatExamShell";

/** More → Help integration: menu opens, Help launches, accordion works, timer label untouched. */
function Harness() {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <SatExamShell
      sectionLabel="Section 1: Reading and Writing"
      directions={null}
      remainingLabel="28:33"
      remainingSeconds={1713}
      candidateName="Ada Candidate"
      questionIndex={0}
      questionCount={3}
      navigationItems={[{ id: "q1", index: 0, number: 1, status: "unanswered", current: true, markedForReview: false }]}
      calculatorAvailable={false}
      calculatorOpen={false}
      referenceAvailable={false}
      referenceOpen={false}
      blocked={false}
      saveState="idle"
      questionNote=""
      readingPreferences={createSatReadingPreferences()}
      helpOpen={helpOpen}
      onOpenHelp={() => setHelpOpen(true)}
      onCloseHelp={() => setHelpOpen(false)}
      onSelectQuestion={() => undefined}
      onToggleCalculator={() => undefined}
      onToggleReference={() => undefined}
      onPrevious={() => undefined}
      onNext={() => undefined}
      onReviewModule={() => undefined}
      onSaveNote={() => undefined}
      onReadingPreferencesChange={() => undefined}
    >
      <div>Question body</div>
    </SatExamShell>
  );
}

describe("SatMoreHelpFlow", () => {
  it("opens More, launches Help, expands a section, timer untouched", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    expect(screen.getByRole("menu", { name: "More tools" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Help" }));
    expect(await screen.findByRole("dialog", { name: "Help" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Line Reader/ }));
    expect(screen.getByText(/dims surrounding content/)).toBeInTheDocument();
    // Radix hides background content from the a11y tree while Help is open
    // (exam non-interactive — correct). The timer node stays mounted in the
    // DOM with its value; Help never unmounts or resets it.
    expect(document.body.textContent).toContain("28:33");
    expect(screen.getByText("Question body")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Help" })).not.toBeInTheDocument();
  });

  it("toggles Line Reader from the More menu", async () => {
    const user = userEvent.setup();
    const onReadingPreferencesChange = vi.fn();
    render(
      <SatExamShell
        sectionLabel="Section 1: Reading and Writing"
        directions={null}
        remainingLabel="28:33"
        candidateName="Ada"
        questionIndex={0}
        questionCount={1}
        navigationItems={[]}
        calculatorAvailable={false}
        calculatorOpen={false}
        referenceAvailable={false}
        referenceOpen={false}
        blocked={false}
        saveState="idle"
        questionNote=""
        readingPreferences={createSatReadingPreferences()}
        onSelectQuestion={() => undefined}
        onToggleCalculator={() => undefined}
        onToggleReference={() => undefined}
        onPrevious={() => undefined}
        onNext={() => undefined}
        onReviewModule={() => undefined}
        onSaveNote={() => undefined}
        onReadingPreferencesChange={onReadingPreferencesChange}
      >
        <div>Q</div>
      </SatExamShell>,
    );
    await user.click(screen.getByRole("button", { name: "More tools" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Line Reader/ }));
    expect(onReadingPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({ lineReaderEnabled: true }),
    );
  });
});
