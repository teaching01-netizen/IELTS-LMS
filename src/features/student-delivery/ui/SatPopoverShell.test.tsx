import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSatReadingPreferences } from "../domain/satReadingPreferences";
import { SatExamShell, type SatExamShellProps } from "./SatExamShell";
import { SatPopoverShell } from "./primitives/SatPopoverShell";

function shellProps(overrides: Partial<SatExamShellProps> = {}): SatExamShellProps {
  return {
    sectionLabel: "Section 1: Reading and Writing",
    directions: null,
    remainingLabel: "27:14",
    candidateName: "Ada Candidate",
    questionIndex: 0,
    questionCount: 3,
    navigationItems: [
      { id: "q1", index: 0, number: 1, status: "answered", current: true, markedForReview: false },
      { id: "q2", index: 1, number: 2, status: "unanswered", current: false, markedForReview: false },
      { id: "q3", index: 2, number: 3, status: "unanswered", current: false, markedForReview: false },
    ],
    calculatorAvailable: false,
    calculatorOpen: false,
    referenceAvailable: false,
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

describe("SatPopoverShell focus contract", () => {
  it("moves focus into Directions on desktop open and returns it on Escape", async () => {
    render(<SatExamShell {...shellProps()} />);
    const trigger = screen.getByRole("button", { name: "Directions" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Directions" });
    expect(dialog).toBeInTheDocument();
    // Focus moves on the next animation frame (shared popover contract).
    await waitFor(() => expect(screen.getByRole("button", { name: "Close directions" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Directions" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("puts the trigger's panel id on the dialog root, never an inner body", () => {
    render(<SatExamShell {...shellProps()} />);
    const trigger = screen.getByRole("button", { name: "Directions" });
    fireEvent.click(trigger);
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.querySelectorAll(`[id="${panelId}"]`)).toHaveLength(1);
    const dialog = screen.getByRole("dialog", { name: "Directions" });
    expect(dialog).toHaveAttribute("id", panelId);
    expect(dialog.querySelector(`[id="${panelId}"]`)).toBeNull();
  });

  it("returns focus to the trigger when an outside press closes the panel", async () => {
    render(<SatExamShell {...shellProps()} />);
    const trigger = screen.getByRole("button", { name: "Directions" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Directions" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Directions" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("moves focus into Display settings on open", async () => {
    render(<SatExamShell {...shellProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    expect(screen.getByRole("dialog", { name: "Display" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Close display settings" })).toHaveFocus());
  });

  it("keeps save retry reachable while blocked (save UI lives outside inert)", () => {
    const onRetrySave = vi.fn();
    render(<SatExamShell {...shellProps({ blocked: true, saveState: "failed", onRetrySave })} />);
    // One Retry only (banner owns recovery; the footer token stays quiet).
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).not.toHaveAttribute("inert");
    const blockedRegion = screen.getByTestId("sat-exam-blocked-region");
    expect(blockedRegion).toHaveAttribute("inert");
    expect(blockedRegion.contains(retry)).toBe(false);
    fireEvent.click(retry);
    expect(onRetrySave).toHaveBeenCalledOnce();
  });
});

/**
 * The presentation of a panel is not the same thing as the panel. A student can
 * change it with the panel open — raising Text size in Display is the live case —
 * and that has to move its classes, its backdrop and its aria-modal, and nothing
 * else: not the dialog node, not its scroll position, not the cursor's place in
 * the field they were using.
 */
describe("SatPopoverShell presentation", () => {
  const css = readFileSync(resolve(__dirname, "../../../index.css"), "utf8");

  function renderPlain(compact: boolean) {
    const trigger = createRef<HTMLButtonElement>();
    const view = render(
      <SatPopoverShell
        open
        title="Panel"
        triggerRef={trigger}
        onClose={vi.fn()}
        closeLabel="Close panel"
        anchoredClassName="anchored-panel"
        compactClassName="compact-panel"
        backdropClassName="backdrop-panel"
        forceCompact={compact}
        bodyClassName="min-h-0 flex-1 overflow-y-auto"
      >
        <button type="button">Inner control</button>
      </SatPopoverShell>,
    );
    return { ...view, trigger };
  }

  it("asks for the sheet presentation when its layout cannot afford an anchored panel", () => {
    const anchored = renderPlain(false);
    const anchoredDialog = screen.getByRole("dialog", { name: "Panel" });
    expect(anchoredDialog).toHaveAttribute("data-sat-popover-panel", "anchored");
    expect(anchoredDialog.className).toContain("anchored-panel");
    expect(anchoredDialog.className).not.toContain("compact-panel");
    // Not modal, and no backdrop to catch a press the student meant for the exam.
    expect(anchoredDialog).not.toHaveAttribute("aria-modal");
    expect(document.querySelector('[data-sat-popover-layer="modal"]')).toBeNull();
    anchored.unmount();

    renderPlain(true);
    const sheet = screen.getByRole("dialog", { name: "Panel" });
    expect(sheet).toHaveAttribute("data-sat-popover-panel", "modal");
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet.className).toContain("compact-panel");
    expect(document.querySelector('[data-sat-popover-layer="modal"]')).not.toBeNull();
  });

  it("swaps presentation in place, keeping one dialog node", () => {
    const { rerender } = render(
      <SatPopoverShell
        open
        title="Panel"
        triggerRef={createRef<HTMLButtonElement>()}
        onClose={vi.fn()}
        closeLabel="Close panel"
        anchoredClassName="anchored-panel"
        compactClassName="compact-panel"
        backdropClassName="backdrop-panel"
      >
        <p>Body</p>
      </SatPopoverShell>,
    );
    const dialogBefore = screen.getByRole("dialog", { name: "Panel" });

    rerender(
      <SatPopoverShell
        open
        title="Panel"
        triggerRef={createRef<HTMLButtonElement>()}
        onClose={vi.fn()}
        closeLabel="Close panel"
        anchoredClassName="anchored-panel"
        compactClassName="compact-panel"
        backdropClassName="backdrop-panel"
        forceCompact
      >
        <p>Body</p>
      </SatPopoverShell>,
    );

    expect(screen.getByRole("dialog", { name: "Panel" })).toBe(dialogBefore);
    expect(dialogBefore).toHaveAttribute("data-sat-popover-panel", "modal");
  });

  it("keeps the anchored layer a pass-through, so a fixed panel still measures against the exam plane", () => {
    // The identity above is only worth having if the stable layer itself does not
    // move the panel: `display: contents` generates no box, so it paints nothing,
    // traps no pointer, and is not a containing block for the anchored panel's
    // `fixed` offsets.
    expect(css).toContain(".sat-popover-layer {\n  display: contents;\n}");
  });

  it("keeps the header and the scroll body apart, so Close cannot scroll away", () => {
    renderPlain(true);
    const body = document.querySelector<HTMLElement>('[data-sat-popover-body="true"]')!;
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("flex-1");
    expect(body).toContainElement(screen.getByRole("button", { name: "Inner control" }));
    // The panel itself owns the column and hides its own overflow, so the header
    // (and its Close) stays outside the scrolling body in both presentations.
    const display = readFileSync(resolve(__dirname, "shell/SatReadingPopover.tsx"), "utf8");
    expect(display).toContain('bodyClassName="min-h-0 flex-1 overflow-y-auto"');
    expect(display.match(/flex-col overflow-hidden/g)).toHaveLength(2);
  });

  it("contains Tab while it presents as a sheet, and leaves Tab alone when anchored", async () => {
    const sheet = renderPlain(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close panel" })).toHaveFocus());
    const sheetLast = screen.getByRole("button", { name: "Inner control" });
    sheetLast.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close panel" })).toHaveFocus();
    sheet.unmount();

    // Anchored panels are not modal: the shell must not claim the key, or a
    // keyboard student could never leave the panel for the exam behind it.
    const anchored = renderPlain(false);
    const close = screen.getByRole("button", { name: "Close panel" });
    await waitFor(() => expect(close).toHaveFocus());
    const anchoredLast = screen.getByRole("button", { name: "Inner control" });
    anchoredLast.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    fireEvent(document, tab);
    expect(tab.defaultPrevented).toBe(false);
    anchored.unmount();
  });

  it("pulls the first Tab into a sheet that starts with nothing focused", async () => {
    // Safari does not focus a control on mouse press: it blurs to <body>. A
    // student who clicked a control in a modal sheet therefore arrives at the
    // next Tab with focus outside the panel it declared itself modal over, where
    // the wrap-around rules cannot match and the Tab would walk out behind the
    // sheet. The panel claims that Tab instead.
    const sheet = renderPlain(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close panel" })).toHaveFocus());
    screen.getByRole("button", { name: "Inner control" }).focus();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);

    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    fireEvent(document, tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "Close panel" })).toHaveFocus();

    // Shift+Tab from the same place lands on the last control rather than the first.
    (document.activeElement as HTMLElement).blur();
    const shiftTab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    fireEvent(document, shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "Inner control" })).toHaveFocus();
    sheet.unmount();
  });
});

/**
 * Display is the one panel whose width competes with reading room, so it is the
 * one panel the reading layout is allowed to move. This is that hand-off, on the
 * real shell: a Text size change mid-adjustment must not steal the student's
 * focus or rebuild the panel they are using.
 */
describe("Display presentation follows the measured reading layout", () => {
  function DisplayHarness() {
    const [preferences, setPreferences] = useState(createSatReadingPreferences());
    return (
      <SatExamShell
        {...shellProps({
          readingPreferences: preferences,
          onReadingPreferencesChange: setPreferences,
        })}
      />
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  /** A desktop-sized logical exam: no workspace reports a box in jsdom, so the
   *  provider's document-viewport fallback is what the layout sees. */
  function useDesktopViewport() {
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", 900);
  }

  async function openDisplay() {
    render(<DisplayHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Close display settings" })).toHaveFocus());
    return screen.getByRole("dialog", { name: "Display" });
  }

  it("anchors where the question can spare the panel, and sheets it where it cannot", () => {
    useDesktopViewport();
    render(<DisplayHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    const dialog = screen.getByRole("dialog", { name: "Display" });
    // 1440px of exam, 719px of question, 320px of panel: 375px of question still
    // above the readable budget.
    expect(dialog).toHaveAttribute("data-sat-popover-panel", "anchored");

    const increase = screen.getByRole("button", { name: "Increase text size" });
    increase.focus();
    fireEvent.click(increase);
    fireEvent.click(increase);

    // 130% text raises the budget past what is left of the question, so the panel
    // moves out of the reading line — the same dialog, presenting as a sheet.
    expect(dialog).toHaveAttribute("data-sat-popover-panel", "modal");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("keeps the student’s focus while the presentation changes under them", async () => {
    useDesktopViewport();
    const dialog = await openDisplay();
    const increase = screen.getByRole("button", { name: "Increase text size" });
    increase.focus();

    fireEvent.click(increase);
    fireEvent.click(increase);

    // The open lifecycle depends on `open`, not on the presentation: focus stays
    // on the control the student was using instead of jumping back to Close.
    expect(dialog).toHaveAttribute("data-sat-popover-panel", "modal");
    expect(increase).toHaveFocus();
    expect(screen.getByRole("button", { name: "Close display settings" })).not.toHaveFocus();
  });
});
