import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../../domain/satCopy";
import { SatIntegrityWarning } from "../SatIntegrityWarning";

/**
 * Executable acceptance specification (ATDD) — SAT exam-screen integrity hold.
 *
 * The hold exists so a SAT student is told, on return, that the exam screen was
 * left — and can only continue by acknowledging it. It must not be dismissible,
 * must not count down, and must not carry any action beyond acknowledgement
 * (answers, timer, module attempt and tools are outside its reach).
 */
describe("SatIntegrityWarning", () => {
  beforeEach(() => {
    cleanup();
  });

  it("stays out of the DOM while there is no unacknowledged excursion", () => {
    render(<SatIntegrityWarning open={false} onContinue={vi.fn()} />);

    expect(screen.queryByTestId("sat-integrity-warning")).not.toBeInTheDocument();
  });

  it("names the fact the browser establishes, in the shared exam copy", () => {
    render(<SatIntegrityWarning open onContinue={vi.fn()} />);

    const hold = screen.getByTestId("sat-integrity-warning");
    expect(hold).toBeInTheDocument();
    expect(hold).toHaveTextContent(SAT_COPY.integrity.visibilityTitle);
    expect(hold).toHaveTextContent(SAT_COPY.integrity.visibilityBody);
    // The claim stays "the exam document became hidden" — never what was opened.
    expect(hold.textContent).not.toMatch(/cheat|chatgpt|other (tab|app)/i);
    expect(hold.textContent).toMatch(/You left the exam screen/i);
  });

  it("is a blocking alertdialog with the single continue action focused", async () => {
    render(<SatIntegrityWarning open onContinue={vi.fn()} />);
    // Focus lands on the next frame, like every SAT dialog.
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    });

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const action = screen.getByRole("button", {
      name: SAT_COPY.integrity.visibilityContinue,
    });
    expect(document.activeElement).toBe(action);
  });

  it("does not auto-dismiss and offers no second way out", async () => {
    vi.useFakeTimers();
    render(<SatIntegrityWarning open onContinue={vi.fn()} />);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(screen.getByTestId("sat-integrity-warning")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dismiss|close|cancel/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("sat-modal-close")).not.toBeInTheDocument();
    expect(screen.queryByText(/auto-dismiss|countdown/i)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("continues the exam on the one action, and acknowledges nothing else", () => {
    const onContinue = vi.fn();
    render(<SatIntegrityWarning open onContinue={onContinue} />);

    fireEvent.click(
      screen.getByRole("button", { name: SAT_COPY.integrity.visibilityContinue }),
    );

    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
