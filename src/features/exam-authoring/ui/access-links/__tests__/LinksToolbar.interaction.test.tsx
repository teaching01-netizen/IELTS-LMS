import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinksToolbar } from "../LinksToolbar";

/**
 * AT-18 — the status filter is one control with one selection, marked by a
 * single thumb that travels between pills (weight + position, never color
 * alone), and every pill presses in place.
 */
const counts = { live: 1, upcoming: 1, ended: 0, paused: 0, revoked: 0 };

function renderToolbar(statusFilter: "all" | "live" = "all") {
  return render(
    <LinksToolbar
      search=""
      onSearchChange={vi.fn()}
      statusFilter={statusFilter}
      onStatusFilterChange={vi.fn()}
      counts={counts}
      total={2}
      resultCount={2}
    />,
  );
}

describe("LinksToolbar interaction contract", () => {
  it("AT-18: the selection thumb marks the active pill only", () => {
    renderToolbar("live");
    const live = screen.getByRole("button", { name: /Live 1/ });
    const all = screen.getByRole("button", { name: /All 2/ });

    expect(live).toHaveAttribute("aria-pressed", "true");
    expect(live.querySelector(".sat-selection-thumb")).not.toBeNull();
    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(all.querySelector(".sat-selection-thumb")).toBeNull();
  });

  it("AT-18: every pill presses through the shared vocabulary", () => {
    renderToolbar("live");
    const live = screen.getByRole("button", { name: /Live 1/ });
    const all = screen.getByRole("button", { name: /All 2/ });
    // The selected pill presses with the accent fill; the quiet ones with the
    // neutral fill. Both keep the 44px hit box while doing so.
    expect(live).toHaveClass("sat-press", "sat-press-fill-accent");
    expect(all).toHaveClass("sat-press", "sat-press-fill");
    for (const pill of [live, all]) {
      expect(pill.className).toContain("min-h-11");
    }
  });
});
