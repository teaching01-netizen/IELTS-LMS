import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SAT_EXAM_ZOOM_MAX,
  SAT_EXAM_ZOOM_MIN,
  createSatReadingPreferences,
} from "../domain/satReadingPreferences";
import { createSatTextAnnotation, emptySatAnnotations } from "../domain/satResponses";
import { SatExamShell, type SatExamShellProps } from "./SatExamShell";
import { useSatNotesSurface } from "./annotations/SatNotesSurfaceContext";

/**
 * Mirrors the real composition: the route's question workspace is what renders
 * the Notes column out of the shell's context. A shell rendered with no
 * workspace has nowhere to put the column — which is exactly the production
 * contract, since the column is grid furniture between passage and question.
 */
function NotesWorkspace() {
  const notes = useSatNotesSurface();
  return <>{notes.open ? notes.column : null}</>;
}

function props(overrides: Partial<SatExamShellProps> = {}): SatExamShellProps {
  return {
    sectionLabel: "Section 2: Math",
    directions: null,
    remainingLabel: "34:58",
    candidateName: "Ada Candidate",
    questionIndex: 0,
    questionCount: 3,
    navigationItems: [
      { id: "q1", index: 0, number: 1, status: "answered", current: true, markedForReview: false },
      {
        id: "q2",
        index: 1,
        number: 2,
        status: "unanswered",
        current: false,
        markedForReview: true,
      },
      {
        id: "q3",
        index: 2,
        number: 3,
        status: "unanswered",
        current: false,
        markedForReview: false,
      },
    ],
    calculatorAvailable: true,
    calculatorOpen: false,
    referenceAvailable: true,
    referenceOpen: false,
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

describe("SatExamShell", () => {
  it("keeps compact chrome shrinkable while preserving long section labels", () => {
    const longSectionLabel = "Section 1, Module 1: Reading and Writing";
    const { container } = render(<SatExamShell {...props({ sectionLabel: longSectionLabel })} />);
    const shell = screen.getByTestId("sat-exam-shell");
    const blockedRegion = screen.getByTestId("sat-exam-blocked-region");
    const topbar = container.querySelector<HTMLElement>(".sat-exam-topbar > div")!;
    const footer = container.querySelector<HTMLElement>(".sat-exam-footer > div")!;
    const main = container.querySelector<HTMLElement>("#sat-question-content")!;
    const zoom = container.querySelector<HTMLElement>("[data-sat-fit-root]")!;

    expect(shell).toHaveClass("min-w-0");
    expect(blockedRegion).toHaveClass("min-w-0");
    expect(topbar).toHaveClass(
      "min-w-0",
      "lg:grid-cols-[minmax(280px,1fr)_180px_minmax(280px,1fr)]"
    );
    expect(topbar.className).not.toContain("sm:grid-cols");
    expect(footer).toHaveClass(
      "min-w-0",
      "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]",
      "lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
    );
    expect(footer.className).not.toContain("sm:grid-cols");
    expect(main).toHaveClass("min-w-0");
    expect(zoom).toHaveClass("min-w-0");
    expect(screen.getByText(longSectionLabel)).toHaveTextContent(longSectionLabel);
  });

  it("keeps the compact navigator label readable while preserving its full accessible name", () => {
    const { container } = render(<SatExamShell {...props({ questionIndex: 0, questionCount: 3 })} />);
    const navigator = screen.getByRole("button", {
      name: "Open question navigator. Question 1 of 3",
    });
    const compactLabel = container.querySelector<HTMLElement>(
      '[data-sat-position-label="compact"]'
    )!;
    const labels = navigator.querySelectorAll<HTMLElement>("[data-sat-position-label]");

    expect(navigator).toHaveAttribute(
      "aria-label",
      "Open question navigator. Question 1 of 3"
    );
    expect(labels).toHaveLength(2);
    expect(compactLabel).toHaveTextContent("1/3");
    expect(compactLabel).toHaveClass("whitespace-nowrap", "min-[420px]:hidden");
    for (const label of labels) {
      expect(label.className).not.toMatch(/(?:^|\s)(?:truncate|overflow-hidden)(?:\s|$)/);
    }
    expect(navigator).not.toHaveClass("truncate", "overflow-hidden");
    expect(screen.getByRole("button", { name: "Previous question" })).toHaveTextContent("Prev");
  });

  it("exposes dialog controls only while open, always pointing at the dialog root", () => {
    const { container } = render(<SatExamShell {...props()} />);

    const directions = screen.getByRole("button", { name: "Directions" });
    expect(directions).not.toHaveAttribute("aria-controls");
    fireEvent.click(directions);
    const directionsPanelId = directions.getAttribute("aria-controls");
    expect(directionsPanelId).toBeTruthy();
    const directionsDialog = screen.getByRole("dialog", { name: "Directions" });
    expect(directionsDialog).toHaveAttribute("id", directionsPanelId);
    expect(directionsDialog.closest("[data-sat-exam-overlay-root]")).toBe(
      container.querySelector("[data-sat-exam-overlay-root]"),
    );
    // Exactly one element carries the id, and it is the dialog itself — never
    // an inner scroll body.
    expect(document.querySelectorAll(`[id="${directionsPanelId}"]`)).toHaveLength(1);
    expect(container.querySelector(`[id="${directionsPanelId}"]`)).toBe(directionsDialog);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(directions).not.toHaveAttribute("aria-controls");

    const displayTrigger = screen.getByRole("button", { name: "Display" });
    fireEvent.click(displayTrigger);
    const displayDialog = screen.getByRole("dialog", { name: "Display" });
    expect(displayDialog.closest("[data-sat-exam-overlay-root]")).toBe(
      container.querySelector("[data-sat-exam-overlay-root]"),
    );
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(container.querySelector<HTMLElement>('[data-sat-focus="topbar-more"]')!);
    const moreMenu = screen.getByRole("menu");
    expect(moreMenu.closest("[data-sat-exam-overlay-root]")).toBe(
      container.querySelector("[data-sat-exam-overlay-root]"),
    );
    fireEvent.keyDown(document, { key: "Escape" });

    const navigator = screen.getByRole("button", { name: /Open question navigator/ });
    expect(navigator).not.toHaveAttribute("aria-controls");
    fireEvent.click(navigator);
    const navigatorPanelId = navigator.getAttribute("aria-controls");
    expect(navigatorPanelId).toBeTruthy();
    const navigatorDialog = screen.getByRole("dialog", { name: /Section 2: Math Questions/ });
    expect(navigatorDialog).toHaveAttribute("id", navigatorPanelId);
    expect(document.querySelectorAll(`[id="${navigatorPanelId}"]`)).toHaveLength(1);
    expect(navigatorDialog.closest("[data-sat-exam-overlay-root]")).toBe(
      container.querySelector("[data-sat-exam-overlay-root]"),
    );
  });

  it("keeps failure recovery in the shell status row outside inert content", () => {
    render(
      <SatExamShell
        {...props({ saveState: "failed", saveFailure: "Could not save", onRetrySave: vi.fn() })}
      />,
    );
    const shell = screen.getByTestId("sat-exam-shell");
    const status = screen.getByTestId("sat-save-status");

    expect(shell).toContainElement(status);
    expect(status.closest("[data-sat-exam-overlay-root]")).toBeNull();
    expect(status.parentElement?.className).toContain("row-start-4");
    expect(status.closest("[inert]")).toBeNull();
    expect(within(status).getByRole("button")).toBeEnabled();
  });

  it("publishes the stable viewport height and keyboard state without remounting the shell", () => {
    const { rerender, container } = render(
      <SatExamShell {...props({ examHeight: 900, keyboardOpen: false })} />,
    );
    const shell = screen.getByTestId("sat-exam-shell");

    expect(container.querySelector("[data-sat-exam-viewport]")).toHaveStyle("--student-exam-height: 900px");
    expect(shell).toHaveAttribute("data-sat-keyboard-open", "false");

    rerender(<SatExamShell {...props({ examHeight: 900, keyboardOpen: true })} />);

    expect(screen.getByTestId("sat-exam-shell")).toBe(shell);
    expect(container.querySelector("[data-sat-exam-viewport]")).toHaveStyle("--student-exam-height: 900px");
    expect(shell).toHaveAttribute("data-sat-keyboard-open", "true");
  });

  // Two controls, two meanings. The labeled entry arms annotation and must not
  // open anything; the disclosure opens the Notes column and must not arm.
  it("toggles the annotation mode from the labeled entry, and opens nothing for it", () => {
    render(<SatExamShell {...props({ notesAvailable: true })}><NotesWorkspace /></SatExamShell>);
    const entry = () => screen.getByRole('button', { name: /^Highlights & Notes/ });
    expect(entry()).toHaveTextContent('Highlights & Notes');
    expect(entry()).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(entry());

    // Armed — visibly and in state…
    expect(entry()).toHaveAttribute('aria-pressed', 'true');
    // …and nothing else happened. Arming is not opening: no column, no popover,
    // no draft, no layout move.
    expect(screen.queryByRole('complementary', { name: 'Notes' })).not.toBeInTheDocument();

    fireEvent.click(entry());
    expect(entry()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('complementary', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it("opens the Notes column from its own disclosure, and closes on Escape", () => {
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: true })}><NotesWorkspace /></SatExamShell>);
    const disclosure = () => screen.getByRole('button', { name: /^Notes/ });
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(disclosure());

    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
    // Opening notes is not arming annotation.
    expect(screen.getByRole('button', { name: /^Highlights & Notes/ })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Notes' })).not.toBeInTheDocument();
    // Navigation closes the column (notes never survive a question change) but
    // both controls stay permanent chrome.
    fireEvent.click(disclosure());
    rerender(<SatExamShell {...props({ notesAvailable: true, questionIndex: 1 })}><NotesWorkspace /></SatExamShell>);
    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Highlights & Notes/ })).toBeInTheDocument();
  });
  it("announces existing work on the Notes disclosure, never on the mode toggle", () => {
    const annotations = emptySatAnnotations();
    annotations.annotations = [createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 0, endOffset: 4, exact: 'tree' })];
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: true, annotations, onAnnotationsChange: vi.fn() })} />);
    // The dot marks the entry that SHOWS the work, and the spoken name says why.
    expect(screen.getByRole('button', { name: 'Notes, has highlights' })).toBeInTheDocument();
    // The mode toggle keeps one stable name: its state is pressed/not, never
    // content — a control that renames itself as work accumulates has to be
    // re-found every time.
    expect(screen.getByRole('button', { name: 'Highlights & Notes' })).toBeInTheDocument();
    rerender(<SatExamShell {...props({ notesAvailable: true, annotations: emptySatAnnotations(), onAnnotationsChange: vi.fn() })} />);
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
  });
  it("pins Display and More to the top bar, and keeps Notes out of the overlay layer entirely", () => {
    render(<SatExamShell {...props({ notesAvailable: true })}><NotesWorkspace /></SatExamShell>);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    const display = screen.getByRole("dialog", { name: "Display" });
    expect(display).toHaveAttribute("data-sat-popover-panel", "anchored");
    expect(display.className).toMatch(/fixed/);
    fireEvent.keyDown(document, { key: "Escape" });
    // Notes are a structural column between passage and question, so they are
    // neither a fixed top-bar panel nor a dialog: nothing floats over the exam.
    fireEvent.click(screen.getByRole("button", { name: /^Notes/ }));
    const notes = screen.getByRole('complementary', { name: 'Notes' });
    expect(notes).not.toHaveAttribute("data-sat-popover-panel");
    expect(notes.className).not.toMatch(/fixed|absolute/);
    expect(screen.queryByRole("dialog", { name: /Notes/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    const menu = screen.getByRole("menu", { name: "More tools" });
    expect(menu).toHaveAttribute("data-sat-popover-panel", "anchored");
    expect(menu.className).toMatch(/fixed/);
  });
  it("shows both annotation controls in Reading and Writing and hides them in Math", () => {
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: true })}><NotesWorkspace /></SatExamShell>);
    expect(screen.getByRole('button', { name: /^Highlights & Notes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Notes/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Notes/ }));
    expect(screen.getByRole('complementary', { name: 'Notes' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(<SatExamShell {...props({ notesAvailable: false })}><NotesWorkspace /></SatExamShell>);
    // Hidden, not disabled: with no annotation surface there is nothing behind
    // either control, and a disabled control would promise one.
    expect(screen.queryByRole('button', { name: /^Highlights & Notes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Notes/ })).not.toBeInTheDocument();
  });
  it("disables both annotation controls while the exam is blocked", () => {
    render(<SatExamShell {...props({ notesAvailable: true, blocked: true })} />);
    expect(screen.getByRole('button', { name: /^Highlights & Notes/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Notes/ })).toBeDisabled();
  });
  it("shows SAT timer/tools with no save chrome anywhere in the shell", () => {
    render(<SatExamShell {...props()} />);
    expect(screen.getByText("34:58")).toBeInTheDocument();
    expect(screen.getByText("Ada Candidate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Calculator" })).toBeInTheDocument();
    // Healthy persistence is invisible: no footer token and no banner.
    expect(screen.queryByTestId("sat-footer-save-indicator")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sat-save-status")).not.toBeInTheDocument();
  });

  it("opens Display settings and emits presentation-only preference changes", () => {
    const onReadingPreferencesChange = vi.fn();
    render(<SatExamShell {...props({ onReadingPreferencesChange })} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    const dialog = screen.getByRole("dialog", { name: "Display" });
    expect(dialog).toHaveTextContent("Only changes how the exam looks.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Increase text size" }));
    expect(onReadingPreferencesChange).toHaveBeenCalledWith({
      version: 1,
      textScale: 1.15,
      lineSpacing: "standard",
      splitRatio: 0.5,
    });
  });

  it("draws real minus glyphs in Display, never the raw escape text", () => {
    render(<SatExamShell {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    const dialog = screen.getByRole("dialog", { name: "Display" });
    expect(within(dialog).getByRole("button", { name: "Decrease text size" }).textContent).toBe(
      "A\u2212"
    );
    expect(within(dialog).getByRole("button", { name: "Decrease screen zoom" }).textContent).toBe(
      "\u2212"
    );
    expect(dialog.textContent).not.toContain("\\u2212");
  });

  it("steps screen zoom below 100% and stops at the 50% floor and 200% ceiling", () => {
    const onReadingPreferencesChange = vi.fn();
    render(<SatExamShell {...props({ onReadingPreferencesChange })} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    const zoomSection = within(screen.getByRole("dialog", { name: "Display" })).getByRole(
      "region",
      { name: "Screen zoom" }
    );
    expect(within(zoomSection).getByText("100%")).toBeInTheDocument();
    fireEvent.click(within(zoomSection).getByRole("button", { name: "Decrease screen zoom" }));
    expect(onReadingPreferencesChange).toHaveBeenCalledWith(
      expect.objectContaining({ examZoom: 0.75 })
    );
  });

  it("disables screen zoom decrease at 50% and increase at 200%", () => {
    const { rerender } = render(
      <SatExamShell
        {...props({
          readingPreferences: { ...createSatReadingPreferences(), examZoom: SAT_EXAM_ZOOM_MIN },
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    let zoomSection = within(screen.getByRole("dialog", { name: "Display" })).getByRole(
      "region",
      { name: "Screen zoom" }
    );
    expect(within(zoomSection).getByText("50%")).toBeInTheDocument();
    expect(within(zoomSection).getByRole("button", { name: "Decrease screen zoom" })).toBeDisabled();
    expect(
      within(zoomSection).getByRole("button", { name: "Increase screen zoom" })
    ).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Close display settings" }));
    rerender(
      <SatExamShell
        {...props({
          readingPreferences: { ...createSatReadingPreferences(), examZoom: SAT_EXAM_ZOOM_MAX },
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    zoomSection = within(screen.getByRole("dialog", { name: "Display" })).getByRole("region", {
      name: "Screen zoom",
    });
    expect(within(zoomSection).getByText("200%")).toBeInTheDocument();
    expect(within(zoomSection).getByRole("button", { name: "Increase screen zoom" })).toBeDisabled();
    expect(
      within(zoomSection).getByRole("button", { name: "Decrease screen zoom" })
    ).toBeEnabled();
  });

  it("does not render calculator controls when the module policy excludes them", () => {
    render(<SatExamShell {...props({ calculatorAvailable: false })} />);
    expect(screen.queryByRole("button", { name: "Calculator" })).not.toBeInTheDocument();
  });

  it("keeps the annotation controls out of Math and present in Reading and Writing", () => {
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: false })} />);
    expect(screen.queryByRole("button", { name: /^Highlights & Notes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Notes/ })).not.toBeInTheDocument();
    rerender(<SatExamShell {...props({ notesAvailable: true })} />);
    expect(screen.getByRole("button", { name: /^Highlights & Notes/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Notes/ })).toBeInTheDocument();
  });

  it("opens the bottom-anchored navigator and routes a selected question", () => {
    const onSelectQuestion = vi.fn();
    render(<SatExamShell {...props({ onSelectQuestion })} />);
    fireEvent.click(screen.getByRole("button", { name: /open question navigator/i }));
    const dialog = screen.getByRole("dialog", { name: /Section 2: Math Questions/i });
    expect(dialog).toHaveAttribute("data-sat-navigator-presentation", "anchored");
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(document.querySelector('[data-sat-navigator-anchor="footer"]')).toBeInTheDocument();
    expect(document.querySelector(".sat-dialog-backdrop")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /question 2/i }));
    expect(onSelectQuestion).toHaveBeenCalledWith(1);
    expect(
      screen.queryByRole("dialog", { name: /Section 2: Math Questions/i })
    ).not.toBeInTheDocument();
  });

  it("hides timer digits without changing the timer control", () => {
    render(<SatExamShell {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    expect(screen.queryByText("34:58")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show timer" })).toBeInTheDocument();
  });
  it("never announces routine saving", () => {
    render(<SatExamShell {...props({ saveState: "saving" })} />);
    const statuses = screen.getAllByRole("status");
    // No save-status region at all: the timer announcer is the only status,
    // and it stays empty outside threshold crossings.
    const saveStatuses = statuses.filter((node) => node.hasAttribute("data-sat-save-state"));
    expect(saveStatuses).toHaveLength(0);
  });

  it("surfaces a genuine save failure with its recovery action", () => {
    const onRetrySave = vi.fn();
    render(<SatExamShell {...props({ saveState: "failed", onRetrySave })} />);
    const banner = screen.getByTestId("sat-save-status");
    expect(banner).toHaveAttribute("role", "alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetrySave).toHaveBeenCalledOnce();
  });

  it("keeps notices and save recovery outside the inert question region in flow rows", () => {
    const { container } = render(
      <SatExamShell
        {...props({
          blocked: true,
          saveState: "superseded",
          onTakeOver: vi.fn(),
          notices: <div role="status">Proctor message</div>,
        })}
      />,
    );
    const shell = screen.getByTestId("sat-exam-shell");
    const inert = screen.getByTestId("sat-exam-blocked-region");
    const notices = screen.getByTestId("sat-exam-notices");
    const saveStatus = screen.getByTestId("sat-save-status");
    expect(shell.className).toContain("grid-rows-[auto_auto_minmax(0,1fr)_auto_auto]");
    expect(inert).toHaveAttribute("inert");
    expect(inert).not.toContainElement(notices);
    expect(inert).not.toContainElement(saveStatus);
    expect(notices.className).toContain("row-start-2");
    expect(saveStatus.parentElement?.className).toContain("row-start-4");
    expect(saveStatus.className).not.toMatch(/fixed|absolute/);
    expect(container.querySelector("#sat-question-content")).toBeInTheDocument();
  });

  it("auto-reveals the hidden timer without covering the exam and announces it", () => {
    const { rerender } = render(<SatExamShell {...props({ remainingLabel: "05:02", remainingSeconds: 302 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    expect(screen.queryByText("05:02")).not.toBeInTheDocument();
    rerender(<SatExamShell {...props({ remainingLabel: "05:00", remainingSeconds: 300 })} />);
    expect(screen.getAllByText("05:00")).toHaveLength(1);
    expect(screen.queryByTestId("sat-timer-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId("sat-timer-reveal-announcement")).toHaveTextContent(
      "Timer shown — under 5 minutes left. You can hide it again.",
    );
    expect(screen.getByRole("button", { name: "Hide timer" })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("05:00");
    // One-shot: hiding again after the reveal must stick.
    fireEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    rerender(<SatExamShell {...props({ remainingLabel: "04:59", remainingSeconds: 299 })} />);
    expect(screen.queryByText("04:59")).not.toBeInTheDocument();
    // A fresh module (time back above five minutes) re-arms the reveal.
    rerender(<SatExamShell {...props({ remainingLabel: "32:00", remainingSeconds: 1920 })} />);
    rerender(<SatExamShell {...props({ remainingLabel: "04:59", remainingSeconds: 299 })} />);
    expect(screen.getAllByText("04:59")).toHaveLength(1);
    expect(screen.getByRole("timer")).toHaveTextContent("04:59");
    expect(screen.queryByTestId("sat-timer-warning")).not.toBeInTheDocument();
  });

  it("fires the reveal only once while remaining below five minutes", () => {
    const { rerender } = render(<SatExamShell {...props({ remainingLabel: "04:58", remainingSeconds: 298 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    // Still below the threshold but the one-shot already fired: stays hidden.
    rerender(<SatExamShell {...props({ remainingLabel: "04:57", remainingSeconds: 297 })} />);
    expect(screen.getByRole("button", { name: "Show timer" })).toBeInTheDocument();
  });

  it("arbitrates shell Escape: open Help owns it, Line Reader survives underneath", () => {
    const onReadingPreferencesChange = vi.fn();
    const readingPreferences = {
      ...createSatReadingPreferences(),
      lineReaderEnabled: true,
      lineReaderPosition: 0.5,
    };
    render(
      <SatExamShell
        {...props({
          notesAvailable: true,
          readingPreferences,
          onReadingPreferencesChange,
          helpOpen: true,
          onCloseHelp: vi.fn(),
        })}
      />,
    );
    // Help owns Escape here: the route modal stays open and the shell must
    // not double-handle (no Line Reader disable while Help is up).
    expect(screen.getByRole("dialog", { name: "Help" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onReadingPreferencesChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ lineReaderEnabled: false }),
    );
  });

  it("arbitrates shell Escape: open Shortcuts owns it, Line Reader survives underneath", () => {
    const onReadingPreferencesChange = vi.fn();
    const readingPreferences = {
      ...createSatReadingPreferences(),
      lineReaderEnabled: true,
      lineReaderPosition: 0.5,
    };
    render(
      <SatExamShell
        {...props({
          notesAvailable: true,
          readingPreferences,
          onReadingPreferencesChange,
          shortcutsOpen: true,
          onCloseShortcuts: vi.fn(),
        })}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onReadingPreferencesChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ lineReaderEnabled: false }),
    );
  });

  it("keeps Help and Shortcuts reachable read-only while blocked", () => {
    const { rerender } = render(
      <SatExamShell {...props({ blocked: true, helpOpen: true, onCloseHelp: vi.fn() })} />,
    );
    const help = screen.getByRole("dialog", { name: "Help" });
    expect(help).toBeInTheDocument();
    expect(help).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Close", exact: true })).not.toBeDisabled();
    // The blocked exam grid is inert (answers locked), but Help lives outside it.
    expect(screen.getByTestId("sat-exam-blocked-region")).toHaveAttribute("inert");
    expect(screen.getByTestId("sat-exam-blocked-region").contains(help)).toBe(false);
    rerender(
      <SatExamShell {...props({ blocked: true, shortcutsOpen: true, onCloseShortcuts: vi.fn() })} />,
    );
    const shortcuts = screen.getByRole("dialog", { name: "Keyboard Shortcuts" });
    expect(shortcuts).toBeInTheDocument();
    expect(shortcuts).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Close" })).not.toBeDisabled();
  });

  it("announces the 5-minute warning once and never per tick (T2.5)", () => {
    // remainingSeconds drives the shared threshold announcer: 299s crosses
    // the 5-minute threshold exactly once; a re-render at 298s must not
    // change the announcement, and the per-tick label carries no live region.
    const { rerender } = render(<SatExamShell {...props({ remainingLabel: "04:59", remainingSeconds: 299 })} />);
    const announcement = screen.getByTestId("sat-timer-announcement");
    expect(announcement).toHaveAttribute("aria-live", "polite");
    expect(announcement).toHaveTextContent("Low time: 5 minutes remaining");
    rerender(<SatExamShell {...props({ remainingLabel: "04:58", remainingSeconds: 298 })} />);
    expect(screen.getByTestId("sat-timer-announcement")).toHaveTextContent(
      "Low time: 5 minutes remaining"
    );
  });

  it("renders the whole shell through the logical screen-zoom plane", () => {
    const { container } = render(
      <SatExamShell
        {...props({
          readingPreferences: { ...createSatReadingPreferences(), examZoom: 0.75 },
        })}
      />,
    );
    const plane = container.querySelector<HTMLElement>("[data-sat-zoom-plane]")!;
    const shell = screen.getByTestId("sat-exam-shell");
    expect(plane).toHaveAttribute("data-sat-screen-zoom", "0.75");
    expect(plane.style.transform).toBe("scale(0.75)");
    expect(Number.parseFloat(plane.style.width)).toBeCloseTo(100 / 0.75, 8);
    expect(Number.parseFloat(plane.style.height)).toBeCloseTo(100 / 0.75, 8);
    expect(shell.parentElement).toBe(plane);
    expect(plane.querySelector(".sat-exam-topbar")).toBeInTheDocument();
    expect(plane.querySelector(".sat-exam-footer")).toBeInTheDocument();
    expect(plane.querySelector("#sat-question-content")).toBeInTheDocument();
    expect(plane.querySelector(".sat-exam-shell [style*=zoom]")).toBeNull();
  });

  it("routes normal dialogs into exam space and keeps the break veil in viewport space", () => {
    const { container } = render(
      <SatExamShell
        {...props({
          helpOpen: true,
          onCloseHelp: vi.fn(),
          breakVeilOpen: true,
          onReturnFromBreak: vi.fn(),
          floatingToolChildren: <div data-testid="zoomed-tool">Tool</div>,
        })}
      />,
    );

    const examOverlay = container.querySelector("[data-sat-exam-overlay-root]")!;
    const viewportOverlay = container.querySelector("[data-sat-viewport-overlay-root]")!;
    expect(screen.getByRole("dialog", { name: "Help" }).parentElement).toBe(examOverlay);
    expect(screen.getByTestId("sat-break-veil").parentElement).toBe(viewportOverlay);
    expect(screen.getByTestId("zoomed-tool").closest("[data-sat-zoom-plane]")).toBe(
      container.querySelector("[data-sat-zoom-plane]"),
    );
  });

  it("keeps text size and screen zoom in separate preference fields", () => {
    const onReadingPreferencesChange = vi.fn();
    const { rerender } = render(<SatExamShell {...props({ onReadingPreferencesChange })} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    const dialog = screen.getByRole("dialog", { name: "Display" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Increase text size" }));
    expect(onReadingPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ textScale: 1.15 }));
    onReadingPreferencesChange.mockClear();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close display settings" }));
    rerender(<SatExamShell {...props({
      onReadingPreferencesChange,
      readingPreferences: { ...createSatReadingPreferences(), textScale: 1.15 },
    })} />);
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Display" })).getByRole("button", { name: "Increase screen zoom" }));
    expect(onReadingPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ textScale: 1.15, examZoom: 1.25 }));
  });

  it("offers Fit to screen in Display, and measures rather than guesses when pressed", () => {
    const onReadingPreferencesChange = vi.fn();
    const onScreenZoomDecided = vi.fn();
    render(<SatExamShell {...props({ onReadingPreferencesChange, onScreenZoomDecided })} />);

    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));

    // This page has no panes to measure, so the walk ends without inventing a
    // zoom: the exam renders the student's 100%, and no decision is reported.
    expect(document.querySelector("[data-sat-screen-zoom]")).toHaveAttribute(
      "data-sat-screen-zoom",
      "1",
    );
    expect(onReadingPreferencesChange).not.toHaveBeenCalled();
    expect(onScreenZoomDecided).not.toHaveBeenCalled();
  });
});
