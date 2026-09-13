import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PasteStatus } from "../PasteStatus";

describe("PasteStatus", () => {
  it("shows equation acknowledgement with Undo paste button", () => {
    const onUndo = vi.fn();
    render(
      <PasteStatus
        status={{ visible: true, source: "text", imageCount: 0, mathCount: 2, needsAltText: false }}
        onUndo={onUndo}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 equations formatted");
    fireEvent.click(screen.getByRole("button", { name: "Undo paste" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
  it("hides Undo for rejected-only imports", () => {
    render(
      <PasteStatus
        status={{
          visible: true,
          source: "html",
          imageCount: 0,
          mathCount: 0,
          needsAltText: false,
          rejectedImageCount: 1,
          canUndo: false,
        }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 visual was not imported");
    expect(screen.queryByRole("button", { name: "Undo paste" })).toBeNull();
  });

  it("shows alt-text hint for image pastes and hides when invisible", () => {
    const { rerender } = render(
      <PasteStatus
        status={{ visible: true, source: "files", imageCount: 1, mathCount: 0, needsAltText: true }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("add alt text");
    rerender(
      <PasteStatus
        status={{ visible: false, source: null, imageCount: 0, mathCount: 0, needsAltText: false }}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
