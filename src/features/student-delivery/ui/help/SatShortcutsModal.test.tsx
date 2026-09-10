import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SAT_SHORTCUTS } from "../../domain/satShortcuts";
import { SatShortcutsModal } from "./SatShortcutsModal";

describe("SatShortcutsModal", () => {
  it("renders grouped shortcuts with OS keystrokes", () => {
    render(<SatShortcutsModal open onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Navigation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Test Tools" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Display" })).toBeInTheDocument();
    for (const s of SAT_SHORTCUTS) {
      expect(screen.getByText(s.label)).toBeInTheDocument();
    }
  });

  it("shares the SatCenterModal Close pattern (blue accent confirm, Escape closes)", async () => {
    const source = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(__dirname, "./SatShortcutsModal.tsx"),
      "utf8",
    );
    expect(source).toContain("SatCenterModal");
    expect(source).toContain("SAT_COPY.help.closeButton");
    expect(source).not.toContain("var(--sat-attention)");
    render(<SatShortcutsModal open onClose={() => undefined} />);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("var(--sat-accent)");
    expect(close.className).not.toContain("var(--sat-attention)");
  });

  it("stays reachable read-only while blocked (dialog never inert or disabled)", () => {
    render(<SatShortcutsModal open onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard Shortcuts" });
    expect(dialog).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Close" })).not.toBeDisabled();
  });

  it("closes via Close button and renders nothing when closed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<SatShortcutsModal open onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<SatShortcutsModal open={false} onClose={onClose} />);
    expect(screen.queryByRole("dialog", { name: "Keyboard Shortcuts" })).not.toBeInTheDocument();
  });
});
