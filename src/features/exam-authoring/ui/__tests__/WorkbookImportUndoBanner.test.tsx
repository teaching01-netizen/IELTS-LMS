import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkbookImportUndoBanner } from "../WorkbookImportUndoBanner";

describe("WorkbookImportUndoBanner", () => {
  it("offers one restrained undo action after a workbook import", () => {
    const onUndo = vi.fn();
    render(<WorkbookImportUndoBanner busy={false} onUndo={onUndo} />);

    expect(screen.getByText("Imported from Excel")).toBeInTheDocument();
    const undo = screen.getByRole("button", { name: "Undo Import" });
    fireEvent.click(undo);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate undo requests while recovery is running", () => {
    const onUndo = vi.fn();
    render(<WorkbookImportUndoBanner busy onUndo={onUndo} />);

    const undo = screen.getByRole("button", { name: "Undoing…" });
    expect(undo).toBeDisabled();
    fireEvent.click(undo);
    expect(onUndo).not.toHaveBeenCalled();
  });
});
