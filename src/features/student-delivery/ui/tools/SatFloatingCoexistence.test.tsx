import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatFloatingTool } from "./SatFloatingTool";

const matchMediaMock = (matches: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (query: string) =>
        ({
          matches,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) satisfies MediaQueryList
    )
  );
};

describe("SatFloatingTool", () => {
  it("renders two named tools side by side without trapping focus", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    render(
      <>
        <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
          <div>calc body</div>
        </SatFloatingTool>
        <SatFloatingTool title="Reference Sheet" open geometryKey={null} defaultGeometry={{ x: 48, y: 110, w: 380, h: 480 }} onClose={() => undefined}>
          <div>ref body</div>
        </SatFloatingTool>
      </>
    );
    expect(screen.getByRole("dialog", { name: "Calculator" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Reference Sheet" })).toBeInTheDocument();
    expect(screen.getByText("calc body")).toBeInTheDocument();
    expect(screen.getByText("ref body")).toBeInTheDocument();
    // Non-modal: both expose Close and focus is not trapped.
    expect(screen.getByRole("button", { name: "Close Calculator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Reference Sheet" })).toBeInTheDocument();
    // Legacy e2e probe contract: window + presentation + resizable aliases.
    expect(screen.getByRole("dialog", { name: "Calculator" })).toHaveAttribute("data-sat-tool-window", "Calculator");
    expect(screen.getByRole("dialog", { name: "Calculator" })).toHaveAttribute("data-sat-tool-presentation", "floating");
    expect(screen.getByRole("dialog", { name: "Calculator" })).toHaveAttribute("data-sat-tool-resizable", "true");
    expect(screen.getByRole("dialog", { name: "Reference Sheet" })).toHaveAttribute("data-sat-tool-presentation", "floating");
    expect(screen.getByRole("dialog", { name: "Reference Sheet" })).not.toHaveAttribute("data-sat-tool-resizable");
  });

  it("moves via keyboard grip arrows", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(dialog.style.left).toBe("600px");
    const grip = screen.getByRole("button", { name: /Move Calculator/ });
    grip.focus();
    await user.keyboard("{ArrowLeft}");
    expect(dialog.style.left).toBe("592px");
    await user.keyboard("{ArrowDown}");
    expect(dialog.style.top).toBe("118px");
  });

  it("Escape closes the tool itself", async () => {
    matchMediaMock(false);
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={onClose}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("tokenizes tool chrome: #5D6268-grade border, radius 6, 44px header, floating shadow", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(dialog.className).toContain("var(--sat-tool-border)");
    expect(dialog.className).toContain("rounded-[6px]");
    expect(dialog.className).toContain("var(--sat-shadow-floating)");
    expect(dialog.className).not.toContain("shadow-2xl");
    expect(dialog.className).not.toContain("rounded-[12px]");
    const header = dialog.querySelector("[data-sat-tool-header]");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("h-11");
    expect(header!.querySelector("[aria-label^=\"Move\" i]")).not.toBeNull();
    expect(dialog.querySelector("[data-sat-tool-close]")).not.toBeNull();
    // Probe contract survives the chrome swap.
    expect(dialog).toHaveAttribute("data-sat-tool-window", "Calculator");
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "floating");
  });

  it("keeps the compact bottom sheet undraggable by design", () => {
    matchMediaMock(true);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    const dialog = screen.getByRole("dialog", { name: "Calculator" });
    expect(dialog).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    expect(dialog.querySelector("[data-sat-tool-header]")).toBeNull();
    expect(dialog.querySelector("[data-sat-resize-handle]")).toBeNull();
  });

  it("renders nothing when closed", () => {
    matchMediaMock(false);
    render(
      <SatFloatingTool title="Calculator" open={false} geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
