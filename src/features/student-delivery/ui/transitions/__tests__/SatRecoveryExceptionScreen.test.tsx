import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatRecoveryExceptionScreen } from "../SatRecoveryExceptionScreen";

const onRetry = vi.fn(async () => undefined);
const onResolve = vi.fn(async () => ({
  receiptId: "receipt-1",
  resolutionId: "resolution-1",
  scheduleId: "schedule-1",
  attemptId: "attempt-1",
  moduleAttemptId: "module-attempt-1",
  moduleId: "module-1",
  action: "activate_entry" as const,
  actorType: "student" as const,
  resolvedAt: "2026-10-21T00:00:00Z",
  excludedAnswers: "0",
}));

function renderEntryScreen(mode: "practice" | "classroom") {
  return render(
    <SatRecoveryExceptionScreen
      mode={mode}
      kind="entry"
      moduleTitle="Math Module 2"
      moduleAttemptId="module-attempt-1"
      boundaryRevision={3}
      onRetry={onRetry}
      onResolve={onResolve}
    />
  );
}

describe("SatRecoveryExceptionScreen entry copy", () => {
  it("explains the practice entry choice and keeps confirmation keyboard accessible", async () => {
    renderEntryScreen("practice");

    expect(
      screen.getByRole("heading", { name: "Module entry recovery ended" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This module has not started. You can choose to start it now; the module timer begins after you confirm."
      )
    ).toBeInTheDocument();
    const startButton = screen.getByRole("button", { name: "Start this module" });
    expect(startButton).toBeInTheDocument();
    expect(screen.queryByText(/ask your proctor/i)).not.toBeInTheDocument();

    fireEvent.click(startButton);
    const dialog = screen.getByRole("alertdialog", { name: "Start this module now?" });
    expect(dialog).toHaveTextContent("Your module timer begins when you confirm.");

    const cancelButton = screen.getByRole("button", { name: "Go back" });
    const confirmButton = within(dialog).getByRole("button", { name: "Start this module" });
    await waitFor(() => expect(cancelButton).toHaveFocus());
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(confirmButton).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancelButton).toHaveFocus();
    fireEvent.click(cancelButton);
    await waitFor(() => expect(startButton).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("directs classroom students to their proctor and does not expose the practice action", () => {
    renderEntryScreen("classroom");

    expect(
      screen.getByText(
        "This module has not started. Ask your proctor to review the entry exception."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ask your proctor to review this recovery exception.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start this module" })).not.toBeInTheDocument();
  });
});
