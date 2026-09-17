import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorTooltip } from "../EditorTooltip";

/**
 * The authoring editor runs in a browser, where `matchMedia` exists. jsdom does
 * not provide it, so a test that skips this stub exercises a *different* branch
 * from the one the product takes — which is exactly how a missing tooltip
 * provider reached production. The stub keeps the test on the real path.
 */
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "matchMedia");
});

function Control() {
  return (
    <EditorTooltip label="Bold" shortcut="⌘B">
      <button type="button" aria-label="Bold (⌘B)">
        B
      </button>
    </EditorTooltip>
  );
}

describe("hover labels on icon-only controls", () => {
  it("stands on its own, without the caller having to provide a tooltip provider", () => {
    render(<Control />);
    expect(screen.getByRole("button", { name: "Bold (⌘B)" })).toBeInTheDocument();
  });

  it("names a hovered control only after the author hesitates", () => {
    render(<Control />);
    const control = screen.getByRole("button", { name: "Bold (⌘B)" });

    fireEvent.pointerMove(control);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Still moving across the row: a label on every pass would feel nervous.
    expect(control).not.toHaveAttribute("aria-describedby");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    // Radix renders the label twice — the visible surface and the visually
    // hidden node the trigger points at. The relationship is the contract, so
    // assert that rather than either copy.
    expect(control).toHaveAccessibleDescription("Bold ⌘B");
    expect(screen.getByRole("tooltip")).toHaveTextContent("⌘B");
  });

  it("names a focused control immediately, because a keyboard author is not hovering", () => {
    render(<Control />);
    const control = screen.getByRole("button", { name: "Bold (⌘B)" });
    fireEvent.focus(control);
    expect(control).toHaveAccessibleDescription("Bold ⌘B");
  });
});
