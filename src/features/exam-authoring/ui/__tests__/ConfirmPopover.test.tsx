import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmPopover } from "../ConfirmPopover";

describe("ConfirmPopover", () => {
  it("focuses the safe action by default and cancels with Escape", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmPopover
        open
        title="Delete this question?"
        description="This removes the question from the module."
        confirmLabel="Delete question"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
