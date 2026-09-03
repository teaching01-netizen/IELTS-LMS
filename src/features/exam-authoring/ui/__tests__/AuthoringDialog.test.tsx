import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthoringConfirmDialog, AuthoringDialog } from "../authoringPrimitives";

describe("AuthoringDialog", () => {
  it("provides a labelled dialog and closes through Radix dismissal semantics", () => {
    const onClose = vi.fn();

    render(
      <AuthoringDialog open title="Insert equation" onClose={onClose}>
        <input aria-label="Equation" />
      </AuthoringDialog>,
    );

    expect(screen.getByRole("dialog", { name: "Insert equation" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps destructive confirmation open until the controlled action succeeds", async () => {
    const onConfirm = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Delete question
          </button>
          <AuthoringConfirmDialog
            open={open}
            title="Delete this question?"
            description="This cannot be undone."
            confirmLabel="Delete"
            onCancel={() => setOpen(false)}
            onConfirm={onConfirm}
          />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Delete question" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("alertdialog", { name: "Delete this question?" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Delete question")));
  });
});
