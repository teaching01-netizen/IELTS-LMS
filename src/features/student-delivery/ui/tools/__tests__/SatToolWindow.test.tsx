import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCompactDetentIntent, SatToolWindow } from "../SatToolWindow";

function mediaList(query: string, matches: boolean): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } satisfies MediaQueryList;
}

function matchMedia({
  compact,
  short,
  reducedMotion = false,
}: {
  compact: boolean;
  short: boolean;
  reducedMotion?: boolean;
}) {
  return vi.fn((query: string) =>
    mediaList(
      query,
      query.includes("prefers-reduced-motion")
        ? reducedMotion
        : query === "(max-height: 560px)"
          ? short
          : compact
    )
  );
}

describe("SatToolWindow", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("keeps regular-width touch devices in floating presentation with finger-sized corners", () => {
    const mock = matchMedia({ compact: false, short: false });
    vi.stubGlobal("matchMedia", mock);
    render(
      <SatToolWindow title="Reference Sheet" open onClose={vi.fn()}>
        content
      </SatToolWindow>
    );

    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "floating");
    expect(dialog).toHaveAttribute("data-sat-tool-resizable", "true");
    expect(dialog.querySelectorAll("[data-sat-resize-handle]")).toHaveLength(8);
    expect(dialog.querySelector('[data-sat-resize-handle="se"]')).toHaveClass("h-11", "w-11");
    expect(dialog.querySelector("[data-sat-titlebar-resize-handle]")).toHaveClass(
      "sat-touch-target",
      "cursor-ns-resize"
    );
    expect(dialog.querySelector("[data-sat-titlebar-move-handle]")).not.toBeNull();
    expect(mock.mock.calls[0]?.[0]).not.toContain("pointer");
  });

  it("can prewarm a closed tool at full geometry without exposing it to interaction", () => {
    vi.stubGlobal("matchMedia", matchMedia({ compact: false, short: false }));
    const { container } = render(
      <SatToolWindow
        title="Calculator"
        open={false}
        onClose={vi.fn()}
        keepMountedOnClose
        prewarmWhenClosed
      >
        <iframe title="prewarmed calculator" />
      </SatToolWindow>
    );

    const dialog = container.querySelector<HTMLElement>("[data-sat-tool-window]");
    const prewarmHost = container.querySelector<HTMLElement>("[data-sat-tool-prewarmed]");
    expect(dialog).not.toBeNull();
    expect(prewarmHost).not.toBeNull();
    expect(prewarmHost).toHaveAttribute("aria-hidden", "true");
    expect(prewarmHost).toHaveAttribute("inert");
    expect(prewarmHost).toHaveClass("invisible", "pointer-events-none");
  });

  it("uses a resizable compact sheet before promoting to full screen", async () => {
    vi.stubGlobal("matchMedia", matchMedia({ compact: true, short: false }));
    render(
      <SatToolWindow title="Reference Sheet" open onClose={vi.fn()}>
        content
      </SatToolWindow>
    );

    const dialog = screen.getByRole("dialog", { name: "Reference Sheet" });
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    expect(dialog).toHaveAttribute("data-sat-tool-detent", "large");
    expect(dialog).toHaveAttribute("data-sat-tool-resizable", "true");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.querySelector("[data-sat-compact-resize-handle]")).not.toBeNull();
    expect(dialog.querySelector("[data-sat-titlebar-resize-handle]")).not.toBeNull();
    expect(dialog.querySelector("[data-sat-titlebar-move-handle]")).toBeNull();
    expect(dialog.querySelector("[data-sat-resize-handle]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Reference Sheet to full screen" }));
    await waitFor(() =>
      expect(dialog).toHaveAttribute("data-sat-tool-presentation", "compact-fullscreen")
    );
    expect(dialog).toHaveAttribute("data-sat-tool-detent", "full");

    fireEvent.click(screen.getByRole("button", { name: "Restore Reference Sheet size" }));
    await waitFor(() => expect(dialog).toHaveAttribute("data-sat-tool-detent", "large"));
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
  });

  it("forces full screen when compact landscape height cannot support a usable sheet", () => {
    vi.stubGlobal("matchMedia", matchMedia({ compact: true, short: true }));
    render(
      <SatToolWindow title="Calculator" open onClose={vi.fn()}>
        content
      </SatToolWindow>
    );

    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "compact-fullscreen");
    expect(dialog).toHaveAttribute("data-sat-tool-detent", "full");
    expect(dialog).not.toHaveAttribute("data-sat-tool-resizable");
    expect(screen.getByRole("button", { name: "Restore Calculator size" })).toBeDisabled();
  });
  it("resolves compact release intent without letting cancelled velocity fling the sheet", () => {
    expect(
      resolveCompactDetentIntent({
        height: 420,
        velocity: 3_500,
        available: 800,
        cancelled: true,
      })
    ).toBe("medium");
    expect(
      resolveCompactDetentIntent({
        height: 650,
        velocity: 1_400,
        available: 800,
        cancelled: false,
      })
    ).toBe("full");
    expect(
      resolveCompactDetentIntent({
        height: 610,
        velocity: -300,
        available: 800,
        cancelled: false,
      })
    ).toBe("large");
  });

  it("preempts tool interaction when the exam becomes blocked", () => {
    vi.stubGlobal("matchMedia", matchMedia({ compact: false, short: false }));
    render(
      <SatToolWindow title="Calculator" open interactionDisabled onClose={vi.fn()}>
        content
      </SatToolWindow>
    );

    const dialog = screen.getByRole("dialog", { name: "Calculator", hidden: true });
    expect(dialog).toHaveAttribute("inert");
    expect(dialog).toHaveAttribute("data-sat-tool-interaction-disabled", "true");
    expect(screen.getByRole("button", { name: "Close Calculator", hidden: true })).toBeDisabled();
  });
});
