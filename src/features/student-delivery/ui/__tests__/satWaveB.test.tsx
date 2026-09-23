import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSatReadingPreferences } from "../../domain/satReadingPreferences";
import { SAT_OVERLAY_Z } from "../primitives/satOverlayZ";
import { SatMoreMenu } from "../shell/SatMoreMenu";
import { SatFloatingTool } from "../tools/SatFloatingTool";
import { SatExamShell, type SatExamShellProps } from "../SatExamShell";

const UI = __dirname + "/..";
const read = (rel: string) => readFileSync(resolve(UI, rel), "utf8");

function shellProps(overrides: Partial<SatExamShellProps> = {}): SatExamShellProps {
  return {
    sectionLabel: "Section 1: Reading and Writing",
    directions: null,
    remainingLabel: "05:00",
    remainingSeconds: 300,
    candidateName: "Ada Candidate",
    questionIndex: 0,
    questionCount: 3,
    navigationItems: [
      { id: "q1", index: 0, number: 1, status: "answered", current: true, markedForReview: false },
      { id: "q2", index: 1, number: 2, status: "unanswered", current: false, markedForReview: false },
      { id: "q3", index: 2, number: 3, status: "unanswered", current: false, markedForReview: false },
    ],
    calculatorAvailable: true,
    calculatorOpen: false,
    referenceAvailable: true,
    referenceOpen: false,
    notesAvailable: true,
    blocked: false,
    saveState: "idle",
    questionNote: "",
    readingPreferences: createSatReadingPreferences(),
    children: <div>Question body</div>,
    onSelectQuestion: vi.fn(),
    onToggleCalculator: vi.fn(),
    onToggleReference: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onReviewModule: vi.fn(),
    onSaveNote: vi.fn(),
    onReadingPreferencesChange: vi.fn(),
    ...overrides,
  };
}

function stubMatchMedia(matches: boolean): void {
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
        }) satisfies MediaQueryList,
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("save-failed stays available without covering exam content", () => {
  it("keeps the overlay contract for modal layers", () => {
    expect(SAT_OVERLAY_Z.routeAlert).toBeGreaterThan(SAT_OVERLAY_Z.moreMenu);
    expect(SAT_OVERLAY_Z.moreMenu).toBeGreaterThan(SAT_OVERLAY_Z.navigator);
    expect(SAT_OVERLAY_Z.routeAlert).toBeLessThanOrEqual(SAT_OVERLAY_Z.breakConfirm);
  });

  it("renders the failure surface in normal flow without overlay positioning", () => {
    const source = read("feedback/SatSaveStatus.tsx");
    expect(source).not.toMatch(/\bfixed\b|\babsolute\b|z-\[/);
    // The routine layers are gone with their branches (no saving hint, no
    // offline dock): only a failure or lost lease status renders in flow.
    expect(source).not.toContain("z-[55]");
    expect(source).not.toContain("z-[65]");
  });

  it("navigator open + save-failed keeps Retry accessible in the save row", async () => {
    const onRetrySave = vi.fn();
    render(<SatExamShell {...shellProps({ saveState: "failed", onRetrySave })} />);
    fireEvent.click(screen.getByRole("button", { name: /open question navigator/i }));
    expect(screen.getByRole("dialog", { name: /Questions/i })).toBeInTheDocument();
    const banner = screen.getByTestId("sat-save-status");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner.parentElement?.className).toContain("row-start-4");
    expect(banner.className).not.toMatch(/fixed|absolute/);
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(onRetrySave).toHaveBeenCalledTimes(1);
  });
});

describe("Wave B R-08 More menu traps Tab on compact only", () => {
  function moreProps(overrides: Partial<Parameters<typeof SatMoreMenu>[0]> = {}) {
    return {
      open: true,
      blocked: false,
      lineReaderOn: false,
      lineReaderAvailable: true,
      breakAvailable: true,
      onSelectHelp: vi.fn(),
      onSelectShortcuts: vi.fn(),
      onToggleLineReader: vi.fn(),
      onSelectBreak: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
  }

  it("desktop: Tab on the last item does NOT wrap to the first", () => {
    stubMatchMedia(false);
    render(<SatMoreMenu {...moreProps()} />);
    const items = screen.getAllByRole("menuitem");
    const last = items[items.length - 1]!;
    last.focus();
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    // No trap: focus is not pulled back to the first row.
    expect(screen.getAllByRole("menuitem")[0]).not.toHaveFocus();
  });

  it("desktop: Shift+Tab on the first item does NOT wrap to the last", () => {
    stubMatchMedia(false);
    render(<SatMoreMenu {...moreProps()} />);
    const first = screen.getAllByRole("menuitem")[0]!;
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    const items = screen.getAllByRole("menuitem");
    expect(items[items.length - 1]).not.toHaveFocus();
  });

  it("compact: Tab on the last item still wraps (trap kept)", () => {
    stubMatchMedia(true);
    render(<SatMoreMenu {...moreProps()} />);
    const items = screen.getAllByRole("menuitem");
    const first = items[0]!;
    const last = items[items.length - 1]!;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();
  });
});

describe("Wave B R-09 resize grip 44px + keyboard", () => {
  it("grip hit area is 44x44 with the 32px glyph kept visual-only inside", () => {
    stubMatchMedia(false);
    render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>,
    );
    const grip = screen.getByRole("separator", { name: /Resize Calculator/ });
    expect(grip.className).toContain("h-11");
    expect(grip.className).toContain("w-11");
    expect(grip.getAttribute("aria-label")).toContain("Use arrow keys to resize");
    const glyph = grip.querySelector("span[aria-hidden=true]");
    expect(glyph?.className).toContain("h-8");
    expect(glyph?.className).toContain("w-8");
  });

  it("ArrowRight grows +8px, Shift+ArrowDown grows +24px", () => {
    stubMatchMedia(false);
    const { container } = render(
      <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 60, y: 110, w: 420, h: 520 }} resizable onClose={() => undefined}>
        <div>calc body</div>
      </SatFloatingTool>,
    );
    const panel = container.querySelector("[data-sat-tool-window=Calculator]") as HTMLElement;
    expect(panel.style.width).toBe("420px");
    const grip = screen.getByRole("separator", { name: /Resize Calculator/ });
    fireEvent.keyDown(grip, { key: "ArrowRight" });
    expect(panel.style.width).toBe("428px");
    fireEvent.keyDown(grip, { key: "ArrowDown", shiftKey: true });
    expect(panel.style.height).toBe("544px");
    fireEvent.keyDown(grip, { key: "ArrowLeft" });
    expect(panel.style.width).toBe("420px");
    fireEvent.keyDown(grip, { key: "ArrowUp", shiftKey: true });
    expect(panel.style.height).toBe("520px");
  });
});

describe("Wave B R-10/R-17 token swap is size-preserving", () => {
  const scoped = [
    "feedback/SatSaveStatus.tsx",
    "shell/SatReadingPopover.tsx",
    "annotations/SatNotesColumn.tsx",
    "transitions/SatPreStartScreen.tsx",
    "transitions/SatEntryRecoveryScreen.tsx",
    "break/SatScheduledBreakScreen.tsx",
    "shell/SatQuestionNavigator.tsx",
  ];

  it("no text-[13/14/15/18px] literals remain in the Wave B files", () => {
    for (const file of scoped) {
      const source = read(file);
      expect(source, file).not.toContain("text-[13px]");
      expect(source, file).not.toContain("text-[14px]");
      expect(source, file).not.toContain("text-[15px]");
      expect(source, file).not.toContain("text-[18px]");
    }
  });

  it("token classes carry the identical px sizes (13/14/15/18)", () => {
    const css = readFileSync(resolve(UI, "../../../index.css"), "utf8");
    // 0.8125rem=13px metadata, 0.875rem=14px control-secondary, 0.9375rem=15px control-primary, 1.125rem=18px input.
    expect(css).toContain("--sat-type-metadata: 0.8125rem");
    expect(css).toContain("--sat-type-control-secondary: 0.875rem");
    expect(css).toContain("--sat-type-control-primary: 0.9375rem");
    expect(css).toContain("--sat-type-input: 1.125rem");
    for (const file of scoped) {
      expect(read(file), file).toMatch(/sat-type-(metadata|control-secondary|control-primary|input)/);
    }
  });

  it("kept literals (12/22/30px) each carry a scale-exception comment", () => {
    for (const file of scoped) {
      const source = read(file);
      const kept = source.match(/text-\[(12|16|22|30)px\]/g) ?? [];
      for (const literal of new Set(kept)) {
        expect(source, file + " " + literal).toContain("scale-exception");
      }
    }
    // Spot pin: 12px display subtitle/output.
    expect(read("shell/SatReadingPopover.tsx")).toContain("text-[12px]");
  });
});

describe("Wave B R-18 navigator shadow contract", () => {
  it("panel uses the modal shadow token; badge carries no shadow", () => {
    const source = read("shell/SatQuestionNavigator.tsx");
    expect(source).toContain("shadow-[var(--sat-shadow-modal)]");
    expect(source).not.toContain("shadow-[0_18px_48px_rgba(0,0,0,0.20)]");
    expect(source).not.toContain("shadow-sm");
    // Badge keeps the review-red fill + white surround that carries it without elevation.
    expect(source).toContain("fill-[var(--sat-review)]");
    expect(source).toContain("bg-[var(--sat-surface)]");
  });
});
