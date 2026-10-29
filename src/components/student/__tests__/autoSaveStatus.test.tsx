import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StudentHeader } from "../StudentHeader";
import { CompactStudentHeader } from "../layout/CompactStudentHeader";
import type { StudentAutoSaveStatus } from "../saveStatusPresentation";

const statuses: StudentAutoSaveStatus[] = [
  "saved", "saved_locally", "saving", "syncing", "offline", "needs_recovery", "error",
];

describe("exam headers omit autosave status", () => {
  it.each(statuses)("omits %s from the desktop header", (status) => {
    render(<StudentHeader autoSaveStatus={status} timeRemaining={955} />);

    expect(screen.queryByTestId("student-auto-save-status")).not.toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("15:55");
  });

  it.each(statuses)("omits %s from the compact header", (status) => {
    render(<CompactStudentHeader moduleLabel="Reading" autoSaveStatus={status} timeRemaining={955} />);

    expect(screen.queryByTestId("student-auto-save-status")).not.toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("15:55");
    expect(screen.getByRole("button", { name: "Open exam tools" })).toBeInTheDocument();
  });
});
