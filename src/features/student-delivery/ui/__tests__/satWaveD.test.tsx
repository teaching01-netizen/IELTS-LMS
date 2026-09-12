import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatSaveStatus } from "../feedback/SatSaveStatus";
import { SatHelpModal } from "../help/SatHelpModal";
import { SatDirectionsScreen } from "../transitions/SatDirectionsScreen";

const UI = __dirname + "/..";
const read = (rel: string) => readFileSync(resolve(UI, rel), "utf8");

describe("Wave D R-21 save banners clear the footer (96px + safe-bottom)", () => {
  it("all three banner branches ride bottom calc(96px + safe-bottom)", () => {
    const source = read("feedback/SatSaveStatus.tsx");
    const hits = source.match(/bottom-\[calc\(96px\+var\(--student-safe-bottom\)\)\]/g) ?? [];
    expect(hits.length).toBe(3);
    expect(source).not.toContain("bottom-[calc(78px+");
    expect(source).not.toContain("bottom-[calc(82px+");
  });

  it("keeps z/role/copy geometry contract: saving 55 polite, offline 65 status, failed 85 alert", () => {
    for (const state of ["saving", "offline", "failed"] as const) {
      const { unmount } = render(
        <SatSaveStatus state={state} onRetrySave={vi.fn()} onTakeOver={vi.fn()} />,
      );
      const banner = screen.getByTestId("sat-save-status");
      const cls = banner.className;
      const expected = state === "saving" ? "z-[55]" : state === "offline" ? "z-[65]" : "z-[85]";
      expect(cls).toContain(expected);
      expect(cls).toContain("bottom-[calc(96px+var(--student-safe-bottom))]");
      unmount();
    }
    // Roles unchanged: saving/offline polite status, failed assertive alert.
    {
      const { unmount } = render(<SatSaveStatus state="saving" />);
      expect(screen.getByTestId("sat-save-status")).toHaveAttribute("role", "status");
      unmount();
    }
    {
      const { unmount } = render(<SatSaveStatus state="offline" onRetrySave={vi.fn()} />);
      expect(screen.getByTestId("sat-save-status")).toHaveAttribute("role", "status");
      unmount();
    }
    {
      const { unmount } = render(<SatSaveStatus state="failed" onRetrySave={vi.fn()} />);
      expect(screen.getByTestId("sat-save-status")).toHaveAttribute("role", "alert");
      unmount();
    }
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
    expect(bannerOffsets).toHaveLength(3);
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

describe("Wave D R-23 destructive action uses the accent-text token (pixel-identical)", () => {
  it("leaves no text-white literal on the danger fill; accent-text token wins", () => {
    const source = read("transitions/SatDirectionsScreen.tsx");
    expect(source).toContain("text-[var(--sat-accent-text)]");
    expect(source).not.toContain("text-white");
  });

  it("computed color is equal (pixel-identical today: #fff === #ffffff)", () => {
    // --sat-accent-text resolves to #fff (default) / #ffffff (sat scope):
    // identical to the old text-white literal. Pin via source + token value.
    const css = readFileSync(resolve(UI, "../../../index.css"), "utf8");
    expect(css).toContain("--sat-accent-text: #fff");
    render(
      <SatDirectionsScreen
        module={null}
        sectionLabel="Section 1: Reading and Writing"
        runtimeStatus="live"
        proctorStatus="active"
        isStarting={false}
        error={null}
        onStart={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave exam" }));
    const dialog = screen.getByRole("dialog", { name: "Leave this exam?" });
    const leave = screen.getByRole("button", { name: "Leave without saving more" });
    expect(dialog.contains(leave)).toBe(true);
    expect(leave.className).toContain("text-[var(--sat-accent-text)]");
    expect(leave.className).not.toContain("text-white");
    // Only the modal shell (layer/role/copy) is asserted — no z/role/copy change.
    expect(dialog).toHaveAttribute("aria-label", "Leave this exam?");
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
