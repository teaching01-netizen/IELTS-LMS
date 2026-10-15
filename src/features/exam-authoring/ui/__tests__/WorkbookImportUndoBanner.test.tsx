import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkbookImportUndoBanner } from "../WorkbookImportUndoBanner";

const summary = {
  total: 147,
  sections: [
    { title: "Reading and Writing", count: 81 },
    { title: "Math", count: 66 },
  ],
};

function renderBanner(overrides: Partial<Parameters<typeof WorkbookImportUndoBanner>[0]> = {}) {
  const props = {
    summary,
    issueCount: 0,
    canUndo: true,
    busy: false,
    onUndo: vi.fn(),
    onReviewIssues: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<WorkbookImportUndoBanner {...props} />);
  return props;
}

describe("WorkbookImportUndoBanner", () => {
  it("confirms what was imported, per section", () => {
    renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Imported 147 questions from Excel — Reading and Writing 81 · Math 66"
    );
    expect(screen.queryByRole("button", { name: /need/ })).not.toBeInTheDocument();
  });

  it("falls back to a plain confirmation when the counts are unknown", () => {
    renderBanner({ summary: null });
    expect(screen.getByText("Imported from Excel")).toBeInTheDocument();
  });

  it("routes to the questions that need attention", () => {
    const props = renderBanner({ issueCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: "1 needs attention · Review" }));
    expect(props.onReviewIssues).toHaveBeenCalledTimes(1);
  });

  it("undoes and dismisses", () => {
    const props = renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Undo import" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss import summary" }));
    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("hides undo when it is no longer available", () => {
    renderBanner({ canUndo: false });
    expect(screen.queryByRole("button", { name: "Undo import" })).not.toBeInTheDocument();
  });

  it("prevents duplicate undo requests while recovery is running", () => {
    const props = renderBanner({ busy: true });
    const undo = screen.getByRole("button", { name: "Undoing…" });
    expect(undo).toBeDisabled();
    fireEvent.click(undo);
    expect(props.onUndo).not.toHaveBeenCalled();
  });
});
