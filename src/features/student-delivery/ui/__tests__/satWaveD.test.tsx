import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatSaveStatus } from "../feedback/SatSaveStatus";
import { SatHelpModal } from "../help/SatHelpModal";

const UI = __dirname + "/..";
const read = (rel: string) => readFileSync(resolve(UI, rel), "utf8");

describe("save failures stay in the exam layout", () => {
  it("uses an in-flow alert without fixed positioning or overlay stacking", () => {
    const source = read("feedback/SatSaveStatus.tsx");
    expect(source).not.toMatch(/\bfixed\b/);
    expect(source).not.toContain("z-[");
    const { unmount } = render(<SatSaveStatus state="failed" onRetrySave={vi.fn()} />);
    expect(screen.getByTestId("sat-save-status")).toHaveAttribute("role", "alert");
    unmount();
  });
});

describe("Wave D R-22 help glyphs 20px with 78px rows", () => {
  it("renders h-5 w-5 glyphs and keeps min-h-[78px] targets", () => {
    render(<SatHelpModal open onClose={() => undefined} />);
    const rows = screen.getAllByRole("button", { expanded: false });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.className).toContain("min-h-[78px]");
      expect(row.className).toContain("text-[18px]");
    }
    // Scoped to the accordion rows: the modal X close is also h-5 w-5.
    for (const row of rows) {
      expect(row.querySelector("svg.lucide.h-5.w-5")).not.toBeNull();
    }
    expect(document.querySelectorAll(".lucide.h-6.w-6").length).toBe(0);
    const source = read("help/SatHelpModal.tsx");
    expect(source).not.toContain("h-6 w-6");
  });
});

describe("Wave D R-24 comment-only diff (no behavior export changed)", () => {
  it("carries the coexistence contract wording; behavior surface unchanged", async () => {
    const source = readFileSync(resolve(UI, "../domain/satInteractionIntents.ts"), "utf8");
    expect(source).toContain(
      "calculator/reference are runner-owned independent layers; intents refuse them here and opening a tool never closes the exclusive surface (shell coexistence contract).",
    );
    expect(source).not.toContain("calculator/reference open closes the exclusive surface");
    const mod = await import("../../domain/satInteractionIntents");
    expect(typeof mod.resolveSatInteractionIntent).toBe("function");
    expect(Object.keys(mod).sort()).toEqual(["resolveSatInteractionIntent"]);
  });
});
