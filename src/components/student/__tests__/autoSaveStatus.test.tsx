import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StudentHeader } from "../StudentHeader";
import { CompactStudentHeader } from "../layout/CompactStudentHeader";

describe("autosave error visibility", () => {
  it("surfaces a recoverable autosave error in the desktop header", () => {
    render(<StudentHeader autoSaveStatus="error" />);

    const label = screen.getByText("Not synced — retrying");
    expect(label).toBeInTheDocument();
    expect(label).toHaveClass("text-red-700");
  });

  it("surfaces offline status in the desktop header", () => {
    render(<StudentHeader autoSaveStatus="offline" />);
    expect(screen.getByText("Offline")).toHaveClass("text-amber-700");
  });

  it("distinguishes saving from a confirmed saved state in the desktop header", () => {
    const { rerender } = render(<StudentHeader autoSaveStatus="saving" />);
    expect(screen.getByText("Saving")).toBeInTheDocument();
    rerender(<StudentHeader autoSaveStatus="saved" />);
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
  });

  it("surfaces a recoverable autosave error in the compact header", () => {
    render(<CompactStudentHeader moduleLabel="Reading" autoSaveStatus="error" />);
    const status = screen.getByTestId("student-auto-save-status");
    expect(status).toHaveTextContent("Not synced");
    expect(status).toHaveClass("text-red-700");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("surfaces offline and saved states in the compact header", () => {
    const { rerender } = render(
      <CompactStudentHeader moduleLabel="Listening" autoSaveStatus="offline" />
    );
    expect(screen.getByTestId("student-auto-save-status")).toHaveTextContent("Offline");
    rerender(<CompactStudentHeader moduleLabel="Listening" autoSaveStatus="saved" />);
    expect(screen.getByTestId("student-auto-save-status")).toHaveTextContent("Saved");
  });
});
