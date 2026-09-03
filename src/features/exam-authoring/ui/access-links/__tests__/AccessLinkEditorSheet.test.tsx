import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AccessLinkEditorSheet } from "../AccessLinkEditorSheet";

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
});

describe("AccessLinkEditorSheet", () => {
  it("confirms before discarding dirty Student Link settings", () => {
    const onClose = vi.fn();
    render(
      <AccessLinkEditorSheet
        open
        link={null}
        members={[]}
        isSaving={false}
        onClose={onClose}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onUpdate={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Student Link name" }), {
      target: { value: "Saturday class" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close Student Link editor" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", { name: "Discard Student Link changes?" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
