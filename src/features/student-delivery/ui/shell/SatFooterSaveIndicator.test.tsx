import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatFooterSaveIndicator } from "./SatFooterSaveIndicator";

describe("SatFooterSaveIndicator (persistent, next to the hand)", () => {
  it("reads Saved at idle with no action", () => {
    render(<SatFooterSaveIndicator state="idle" />);
    const indicator = screen.getByTestId("sat-footer-save-indicator");
    expect(indicator).toHaveAttribute("data-sat-save-state", "idle");
    expect(indicator).toHaveTextContent("All answers saved");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("mirrors the banner object per state without its own live region", () => {
    const { rerender } = render(<SatFooterSaveIndicator state="saving" />);
    expect(screen.getByTestId("sat-footer-save-indicator")).toHaveTextContent("Saving answers");
    rerender(<SatFooterSaveIndicator state="offline" />);
    expect(screen.getByTestId("sat-footer-save-indicator")).toHaveTextContent(/Offline/);
    // No live region here — the banner owns announcements (no double-speak).
    expect(screen.getByTestId("sat-footer-save-indicator")).not.toHaveAttribute("aria-live");
    expect(screen.getByTestId("sat-footer-save-indicator")).not.toHaveAttribute("role");
  });

  it("stays quiet on failure (banner owns Retry + the sentence)", () => {
    render(<SatFooterSaveIndicator state="failed" onRetrySave={vi.fn()} />);
    expect(screen.getByTestId("sat-footer-save-indicator")).toHaveTextContent("Save needs attention");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("stays out of the way for superseded (banner owns that state)", () => {
    render(<SatFooterSaveIndicator state="superseded" />);
    expect(screen.queryByTestId("sat-footer-save-indicator")).not.toBeInTheDocument();
  });
});
