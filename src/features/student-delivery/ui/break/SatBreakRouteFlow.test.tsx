import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createSatReadingPreferences } from "../../domain/satReadingPreferences";
import { SatExamShell } from "../SatExamShell";

/** Route-level break flow: More -> confirm -> veil -> return, timer live throughout. */
function Harness() {
  const [confirm, setConfirm] = useState(false);
  const [veil, setVeil] = useState(false);
  return (
    <SatExamShell
      sectionLabel="Section 1: Reading and Writing"
      directions={null}
      remainingLabel="18:46"
      remainingSeconds={1126}
      candidateName="Ada"
      questionIndex={0}
      questionCount={3}
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
      onReadingPreferencesChange={() => undefined}
      onOpenBreakConfirm={() => setConfirm(true)}
      breakAvailable
      breakConfirmOpen={confirm}
      onCloseBreakConfirm={() => setConfirm(false)}
      onTakeBreak={() => { setConfirm(false); setVeil(true); }}
      breakVeilOpen={veil}
      onReturnFromBreak={() => setVeil(false)}
    >
      <div>Question body</div>
    </SatExamShell>
  );
}

describe("SatBreakRouteFlow", () => {
  it("More -> Start my break veils with live timer; Return restores", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    await user.click(screen.getByRole("menuitem", { name: /Unscheduled Break/ }));
    expect(screen.getByRole("dialog", { name: "Take an Unscheduled Break?" })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "Take an Unscheduled Break?" });
    const { within } = await import("@testing-library/react");
    await user.click(within(dialog).getByRole("button", { name: "Start my break" }));
    const veil = screen.getByRole("alertdialog", { name: "Unscheduled Break" });
    expect(veil).toBeInTheDocument();
    // Veil timer and topbar timer both live (veil never stops the clock).
    expect(veil.textContent).toContain("18:46");
    expect(document.body.textContent).toContain("Question body");
    await user.click(screen.getByRole("button", { name: "Return to Test" }));
    expect(screen.queryByRole("alertdialog", { name: "Unscheduled Break" })).not.toBeInTheDocument();
  });

  it("Cancel returns without veiling", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "More tools" }));
    await user.click(screen.getByRole("menuitem", { name: /Unscheduled Break/ }));
    const dialog = screen.getByRole("dialog", { name: "Take an Unscheduled Break?" });
    const { within } = await import("@testing-library/react");
    await user.click(within(dialog).getAllByRole("button", { name: "Cancel" })[1]);
    expect(screen.queryByRole("dialog", { name: "Take an Unscheduled Break?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
