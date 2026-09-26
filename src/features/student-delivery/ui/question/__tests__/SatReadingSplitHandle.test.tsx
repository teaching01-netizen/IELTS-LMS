import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SAT_READING_SPLIT_MAX,
  SAT_READING_SPLIT_MIN,
} from "../../../domain/satReadingPreferences";
import { SatReadingSplitHandle } from "../SatReadingSplitHandle";

describe("SatReadingSplitHandle", () => {
  it("moves to the minimum passage width with Home", () => {
    const onChange = vi.fn();

    render(
      <SatReadingSplitHandle
        containerRef={{ current: null }}
        ratio={0.5}
        onChange={onChange}
      />
    );

    fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });

    expect(onChange).toHaveBeenCalledWith(SAT_READING_SPLIT_MIN);
  });

  it("moves to the maximum passage width with End", () => {
    const onChange = vi.fn();

    render(
      <SatReadingSplitHandle
        containerRef={{ current: null }}
        ratio={0.5}
        onChange={onChange}
      />
    );

    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });

    expect(onChange).toHaveBeenCalledWith(SAT_READING_SPLIT_MAX);
  });

  it("paints the grabber at the middle of the seam, present at rest", () => {
    render(
      <SatReadingSplitHandle
        containerRef={{ current: null }}
        ratio={0.5}
        onChange={vi.fn()}
      />
    );

    const handle = screen.getByRole("slider");
    const grip = handle.querySelector('[data-sat-reading-split-grip="true"]');
    expect(grip).not.toBeNull();
    // Discoverability is not hover-only: the grip is in the tree with no
    // pointer anywhere near the divider.
    expect(handle).toContainElement(grip);
    // Centred on the seam and inside the handle, so it travels with it.
    expect(grip!.className).toContain("top-1/2");
    expect(grip!.className).toContain("-translate-y-1/2");
    // Decorative: the slider itself already names and reports the split.
    expect(grip).toHaveAttribute("aria-hidden", "true");
    expect(handle).toHaveAccessibleName("Passage and question width");
  });

  it("paints the grabber with tokens, never a literal colour", () => {
    const { container } = render(
      <SatReadingSplitHandle
        containerRef={{ current: null }}
        ratio={0.5}
        onChange={vi.fn()}
      />
    );

    const grip = container.querySelector('[data-sat-reading-split-grip="true"]')!;
    // The ink pair the question number cell uses, so contrast modes recolor it.
    expect(grip.className).toContain("var(--sat-text)");
    expect(grip.className).toContain("var(--sat-background)");
    expect(grip.className).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("lets a drag that lands on the grabber still move the divider", () => {
    const onChange = vi.fn();
    const bounds = {
      left: 0,
      width: 1000,
      top: 0,
      height: 100,
      right: 1000,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const container = { current: { getBoundingClientRect: () => bounds } as HTMLDivElement };

    render(<SatReadingSplitHandle containerRef={container} ratio={0.5} onChange={onChange} />);

    const handle = screen.getByRole("slider");
    // jsdom has no pointer capture: the handle owns the gesture, and the grip
    // must never swallow one that starts on it.
    Object.defineProperty(handle, "setPointerCapture", { value: vi.fn(), configurable: true });
    Object.defineProperty(handle, "hasPointerCapture", { value: () => false, configurable: true });
    const grip = handle.querySelector('[data-sat-reading-split-grip="true"]')!;

    fireEvent.pointerDown(grip, { pointerId: 7, clientX: 600 });

    expect(onChange).toHaveBeenCalledWith(0.6);
  });
});
