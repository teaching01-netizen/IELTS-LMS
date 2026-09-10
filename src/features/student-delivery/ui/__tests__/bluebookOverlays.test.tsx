import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SatHelpModal } from "../help/SatHelpModal";

const UI = __dirname + "/..";
const read = (rel: string) => readFileSync(resolve(UI, rel), "utf8");

describe("bluebook overlays (Phases 8-9 source contract)", () => {
  it("modal overlay uses the 72pc scrim token, never bg-black/40 or blur", () => {
    const modal = read("primitives/SatCenterModal.tsx");
    expect(modal).toContain("var(--sat-scrim)");
    expect(modal).not.toContain("bg-black/40");
    expect(modal).not.toContain("backdrop-blur");
  });

  it("modal panel caps 650/560 with 740 max-height, radius 10, modal shadow", () => {
    const modal = read("primitives/SatCenterModal.tsx");
    expect(modal).toContain("min(650px");
    expect(modal).toContain("min(560px");
    expect(modal).toContain("min(740px");
    expect(modal).toContain("rounded-[10px]");
    expect(modal).toContain("var(--sat-shadow-modal)");
    expect(modal).not.toContain("shadow-2xl");
  });

  it("Help Close is the yellow attention pill, not the blue accent fill", () => {
    const help = read("help/SatHelpModal.tsx");
    expect(help).toContain("var(--sat-attention)");
    expect(help).toContain("var(--sat-attention-fg)");
    expect(help).toContain("var(--sat-attention-border)");
    // The footer Close is attention; the accordion Expand/Collapse stay blue text.
    expect(help).toContain("var(--sat-accent-strong)");
  });

  it("Shortcuts keeps the shared Close pattern (blue accent confirm)", () => {
    const shortcuts = read("help/SatShortcutsModal.tsx");
    expect(shortcuts).toContain("SatCenterModal");
    expect(shortcuts).toContain("var(--sat-accent)");
  });

  it("popovers keep light/transparent backdrops, never the 72pc modal scrim", () => {
    for (const file of [
      "shell/SatDirectionsPopover.tsx",
      "shell/SatReadingPopover.tsx",
      "question/SatNotesPanel.tsx",
    ]) {
      const source = read(file);
      expect(source).not.toContain("var(--sat-scrim)");
      expect(source).toContain("bg-black/20");
    }
    const shell = read("primitives/SatPopoverShell.tsx");
    expect(shell).not.toContain("var(--sat-scrim)");
  });

  it("popover panels use radius 6-8, subtle border, floating shadow", () => {
    for (const file of [
      "shell/SatDirectionsPopover.tsx",
      "shell/SatReadingPopover.tsx",
      "question/SatNotesPanel.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("var(--sat-shadow-floating)");
      expect(source).not.toContain("shadow-2xl");
    }
  });

  it("floating tools tokenize border/radius/shadow and keep probe attributes", () => {
    const tool = read("tools/SatFloatingTool.tsx");
    expect(tool).toContain("var(--sat-tool-border)");
    expect(tool).toContain("rounded-[6px]");
    expect(tool).toContain("var(--sat-shadow-floating)");
    expect(tool).not.toContain("shadow-2xl");
    expect(tool).not.toContain("backdrop-blur");
    expect(tool).toContain("data-sat-tool-window");
    expect(tool).toContain("data-sat-tool-presentation");
  });

  it("Line Reader uses the 92pc mask token with no blur in exam scope", () => {
    const reader = read("reading/SatLineReader.tsx");
    expect(reader).toContain("var(--sat-reader-mask)");
    expect(reader).not.toContain("var(--sat-reader-dim");
    expect(reader).not.toContain("backdrop-blur");
  });
});

describe("bluebook overlays (rendered behavior)", () => {
  it("Help accordion + yellow Close render with Escape/focus contract intact", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SatHelpModal open onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: "Help" });
    expect(dialog).toBeInTheDocument();
    const close = screen.getByRole("button", { name: "Close", exact: true });
    expect(close.className).toContain("var(--sat-attention)");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
