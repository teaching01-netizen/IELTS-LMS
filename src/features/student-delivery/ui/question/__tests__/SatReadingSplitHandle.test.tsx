import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  SAT_READING_SPLIT_MAX,
  SAT_READING_SPLIT_MIN,
} from "../../../domain/satReadingPreferences";
import { SAT_READING_SPLIT_HANDLE_PX } from "../../../domain/satReadingLayout";
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

  it('reports a live drag for as long as the pointer owns the handle', () => {
    // The ratio participates in readability, so the shared layout is not allowed
    // to answer mid-gesture — that is what would unmount the element holding
    // pointer capture. This is how it is told a gesture is in flight.
    const onInteractionChange = vi.fn();
    const bounds = { left: 0, width: 1000, top: 0, height: 100, right: 1000, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    const container = { current: { getBoundingClientRect: () => bounds } as HTMLDivElement };
    render(
      <SatReadingSplitHandle
        containerRef={container}
        ratio={0.5}
        onChange={vi.fn()}
        onInteractionChange={onInteractionChange}
      />,
    );
    const handle = screen.getByRole('slider');

    fireEvent.pointerDown(handle, { pointerId: 3, clientX: 500 });
    expect(onInteractionChange).toHaveBeenLastCalledWith(true);
    expect(onInteractionChange).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(handle, { pointerId: 3 });
    expect(onInteractionChange).toHaveBeenLastCalledWith(false);
    // Released once, not once per event that can end a gesture.
    expect(onInteractionChange).toHaveBeenCalledTimes(2);
  });

  it('ends the drag when capture is lost or the handle goes away', () => {
    const onInteractionChange = vi.fn();
    const view = render(
      <SatReadingSplitHandle
        containerRef={{ current: null }}
        ratio={0.5}
        onChange={vi.fn()}
        onInteractionChange={onInteractionChange}
      />,
    );
    const handle = screen.getByRole('slider');

    fireEvent.pointerDown(handle, { pointerId: 5 });
    expect(onInteractionChange).toHaveBeenLastCalledWith(true);
    fireEvent.lostPointerCapture(handle, { pointerId: 5 });
    expect(onInteractionChange).toHaveBeenLastCalledWith(false);

    // A question change mid-drag unmounts the handle; a latch left behind would
    // hold the next workspace in a presentation nobody is dragging.
    fireEvent.pointerDown(handle, { pointerId: 6 });
    view.unmount();
    expect(onInteractionChange).toHaveBeenLastCalledWith(false);
    expect(onInteractionChange).toHaveBeenCalledTimes(4);
  });

  it('keeps its touch target the width the layout numbers assume', () => {
    // The handle's width is not decoration: 44px centred on a 2px divider is
    // what makes it reach 21px into each neighbour, and the collapsed Notes tab
    // is sized against that reach. Tailwind cannot reference a constant, so the
    // class and the number are held together here — in a page that renders the
    // source, not the DOM, because jsdom has no layout to measure.
    expect(SAT_READING_SPLIT_HANDLE_PX).toBe(44);
    expect(SAT_READING_SPLIT_HANDLE_PX / 4).toBe(11); // w-11
    const source = readFileSync(resolve(__dirname, '../SatReadingSplitHandle.tsx'), 'utf8');
    expect(source).toContain('w-11');
    // Symmetric reach: the grip is drawn at the seam, so the target has to
    // straddle it rather than lean into one pane.
    expect(source).toContain('justify-self-center');
  });

  it('never hides behind a viewport breakpoint', () => {
    // Whether the control belongs on screen is the shared layout's answer, so the
    // handle itself carries no `hidden md:flex`: a media query here would be the
    // second opinion under screen zoom, where the logical width and the physical
    // viewport stop agreeing.
    const { container } = render(
      <SatReadingSplitHandle containerRef={{ current: null }} ratio={0.5} onChange={vi.fn()} />,
    );
    const handle = container.querySelector('[data-sat-reading-split-handle]')!;
    expect(handle.className).not.toMatch(/hidden|md:flex/);
    expect(handle.className).toContain('flex');
  });
});
