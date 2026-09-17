import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Image as ImageIcon } from "lucide-react";
import { SatMenu } from "../../../../products/sat/ui/Menu";

const originalMatchMedia = window.matchMedia;

describe("SatMenu constrained-environment fallback", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("supports roving keyboard navigation and restores focus after Escape", () => {
    const onFirst = vi.fn();
    render(
      <SatMenu
        label="Question actions"
        compact
        items={[
          { id: "first", label: "First action", onSelect: onFirst },
          { id: "second", label: "Second action", onSelect: vi.fn() },
          { id: "disabled", label: "Unavailable", onSelect: vi.fn(), disabled: true },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Question actions" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Question actions" });
    const first = screen.getByRole("menuitem", { name: "First action" });
    const second = screen.getByRole("menuitem", { name: "Second action" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("renders item icons, item previews, and a caller-owned trigger class", () => {
    render(
      <SatMenu
        label="Text style"
        align="start"
        triggerClassName="sat-rich-editor__menu-trigger"
        items={[
          {
            id: "paragraph",
            label: "Paragraph",
            current: true,
            preview: <span className="preview-paragraph">Paragraph</span>,
            onSelect: vi.fn(),
          },
          { id: "image", label: "Insert image", icon: ImageIcon, onSelect: vi.fn() },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Text style" });
    expect(trigger).toHaveClass("sat-rich-editor__menu-trigger");
    fireEvent.click(trigger);
    const previewed = screen.getByRole("menuitem", { name: "Paragraph" });
    // A preview names the item and shows the effect; the current mark stays.
    expect(previewed.querySelector(".preview-paragraph")).not.toBeNull();
    expect(previewed).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("menuitem", { name: "Insert image" }).querySelector(".sat-menu-item__icon"),
    ).not.toBeNull();
  });
});
