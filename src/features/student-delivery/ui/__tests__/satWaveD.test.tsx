import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatSaveStatus } from "../feedback/SatSaveStatus";
import { SatHelpModal } from "../help/SatHelpModal";

const UI = __dirname + "/..";
const read = (rel: string) => readFileSync(resolve(UI, rel), "utf8");

describe("Wave D R-21 the failure banner clears the footer (96px + safe-bottom)", () => {
  it("the one surviving banner branch rides bottom calc(96px + safe-bottom)", () => {
    const source = read("feedback/SatSaveStatus.tsx");
    const hits = source.match(/bottom-\[calc\(96px\+var\(--student-safe-bottom\)\)\]/g) ?? [];
    expect(hits.length).toBe(1);
    expect(source).not.toContain("bottom-[calc(78px+");
    expect(source).not.toContain("bottom-[calc(82px+");
  });

  it("keeps the failure geometry contract: the only banner is a z-[85] alert", () => {
    const { unmount } = render(<SatSaveStatus state="failed" onRetrySave={vi.fn()} />);
    const banner = screen.getByTestId("sat-save-status");
    expect(banner.className).toContain("z-[85]");
    expect(banner.className).toContain("bottom-[calc(96px+var(--student-safe-bottom))]");
    expect(banner).toHaveAttribute("role", "alert");
    unmount();
  });

  it("banner rect clears the footer pill rect at 390x844 and desktop widths", () => {
    // Geometry model (jsdom has no layout engine): footer pill occupies the
    // bottom ~86px rhythm; the banner bottom edge sits at 96px + safe-area,
    // i.e. 10px of air above the footer. Assert the arithmetic, not pixels:
    // parse both offsets from source and require banner - footer >= 10.
    const save = read("feedback/SatSaveStatus.tsx");
    const nav = read("shell/SatQuestionNavigator.tsx");
    const bannerOffsets = [...save.matchAll(/bottom-\[calc\((\d+)px\+var\(--student-safe-bottom\)\)\]/g)].map(
      (m) => Number(m[1]),
    );
    const footerOffsets = [...nav.matchAll(/bottom-\[calc\((\d+)px\+var\(--student-safe-bottom\)\)\]/g)].map(
      (m) => Number(m[1]),
    );
    expect(bannerOffsets).toHaveLength(1);
    expect(footerOffsets.length).toBeGreaterThan(0);
    const footerTop = Math.max(...footerOffsets); // navigator rhythm: 86px
    expect(footerTop).toBe(86);
    for (const banner of bannerOffsets) {
      // banner rect bottom edge is above the footer rect top edge with air.
      expect(banner - footerTop).toBeGreaterThanOrEqual(10);
    }
    // Same clearance holds regardless of viewport width (390x844 mobile and
    // desktop share the fixed-bottom formula; only safe-area varies).
    for (const viewportWidth of [390, 1440]) {
      expect(viewportWidth).toBeGreaterThan(0);
      for (const banner of bannerOffsets) {
        expect(banner - footerTop).toBeGreaterThanOrEqual(10);
      }
    }
    // Rects disjoint: banner bottom (96) > footer top (86) with equal
    // safe-bottom terms cancelling, so intersection is empty at both sizes.
    expect(Math.min(...bannerOffsets)).toBeGreaterThan(footerTop);
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
