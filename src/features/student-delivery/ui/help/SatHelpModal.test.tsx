import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SAT_HELP_ENTRIES } from "../../domain/satHelpContent";
import { SatHelpModal } from "./SatHelpModal";

describe("SatHelpModal", () => {
  it("renders all seven tool sections collapsed with expand controls", () => {
    render(<SatHelpModal open onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Help" })).toBeInTheDocument();
    for (const entry of SAT_HELP_ENTRIES) {
      expect(screen.getByRole("button", { name: new RegExp(entry.title.replace(/[()+]/g, "")) })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Expand All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse All" })).toBeInTheDocument();
    expect(screen.queryByText(SAT_HELP_ENTRIES[0].body)).not.toBeInTheDocument();
  });

  it("expands one section without affecting others, then expands all", async () => {
    const user = userEvent.setup();
    render(<SatHelpModal open onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /Line Reader/ }));
    expect(screen.getByText(SAT_HELP_ENTRIES.find((e) => e.id === "lineReader").body)).toBeInTheDocument();
    expect(screen.queryByText(SAT_HELP_ENTRIES.find((e) => e.id === "mark").body)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand All" }));
    for (const entry of SAT_HELP_ENTRIES) {
      expect(screen.getByText(entry.body)).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Collapse All" }));
    expect(screen.queryByText(SAT_HELP_ENTRIES[0].body)).not.toBeInTheDocument();
  });

  it("sizes accordion rows 78px/18px with 20px icons and blue text expand controls", () => {
    render(<SatHelpModal open onClose={() => undefined} />);
    const rows = screen.getAllByRole("button", { expanded: false });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.className).toContain("min-h-[78px]");
      expect(row.className).toContain("text-[18px]");
    }
    // Wave D R-22: 20px accordion icons (h-5 w-5) against 18px titles;
    // row height stays min-h-[78px] so targets do not shrink.
    // Scoped to the accordion rows: the modal X close is also h-5 w-5.
    for (const row of rows) {
      expect(row.querySelector("svg.lucide.h-5.w-5")).not.toBeNull();
    }
    expect(document.querySelectorAll(".lucide.h-6.w-6").length).toBe(0);
    for (const name of ["Expand All", "Collapse All"]) {
      const control = screen.getByRole("button", { name: name });
      expect(control.className).toContain("text-[var(--sat-accent-strong)]");
    }
  });

  it("renders Close as a yellow attention pill h-12 px-7 with dark text and border", () => {
    render(<SatHelpModal open onClose={() => undefined} />);
    const close = screen.getByRole("button", { name: "Close", exact: true });
    expect(close.className).toContain("var(--sat-attention)");
    expect(close.className).toContain("h-12");
    expect(close.className).toContain("px-7");
    expect(close.className).toContain("rounded-full");
    expect(close.className).toContain("var(--sat-attention-fg)");
    expect(close.className).toContain("var(--sat-attention-border)");
    expect(close.className).not.toContain("var(--sat-accent)");
  });

  it("keeps the dialog reachable read-only while blocked (timer running, answers untouched)", () => {
    render(<SatHelpModal open onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog", { name: "Help" });
    expect(dialog).not.toHaveAttribute("inert");
    for (const entry of SAT_HELP_ENTRIES) {
      expect(screen.getByRole("button", { name: new RegExp(entry.title.replace(/[()+]/g, "")) })).not.toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Close", exact: true })).not.toBeDisabled();
  });

  it("closes via Close button and renders nothing when closed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<SatHelpModal open onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close", exact: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<SatHelpModal open={false} onClose={onClose} />);
    expect(screen.queryByRole("dialog", { name: "Help" })).not.toBeInTheDocument();
  });
});
