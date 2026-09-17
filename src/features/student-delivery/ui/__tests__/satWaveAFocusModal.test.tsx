import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSatReadingPreferences } from "../../domain/satReadingPreferences";
import { SatExamShell, type SatExamShellProps } from "../SatExamShell";
import { useSatNotesSurface } from "../annotations/SatNotesSurfaceContext";
import { SatFloatingTool } from "../tools/SatFloatingTool";

/**
 * The route's workspace is what renders the Notes column out of the shell's
 * context; this stands in for it so the shell can be exercised on its own.
 */
function NotesWorkspace() {
  const notes = useSatNotesSurface();
  return <>{notes.open ? notes.column : null}</>;
}

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
    calculatorAvailable: true,
    calculatorOpen: false,
    referenceAvailable: true,
    referenceOpen: false,
    notesAvailable: true,
    blocked: false,
    saveState: "idle",
    questionNote: "",
    readingPreferences: createSatReadingPreferences(),
    children: (
      <>
        <div>Question body</div>
        <NotesWorkspace />
      </>
    ),
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

function stubCompactMatchMedia(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) satisfies MediaQueryList
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Wave A R-02 compact single-modal (option ii: tool sheet non-modal)", () => {
  it("open notes + calculator keeps aria-modal true count at most 1", async () => {
    stubCompactMatchMedia();
    render(
      <>
        <SatExamShell {...shellProps()} />
        <SatFloatingTool title="Calculator" open geometryKey={null} defaultGeometry={{ x: 600, y: 110, w: 420, h: 520 }} onClose={() => undefined}>
          <div>calc body</div>
        </SatFloatingTool>
      </>,
    );
    // Notes opens from its own disclosure; what it opens is a structural column,
    // so it adds no dialog to the stack.
    fireEvent.click(screen.getByRole("button", { name: /^Notes/ }));
    expect(await screen.findByRole("complementary", { name: "Notes" })).toBeInTheDocument();
    const tool = screen.getByRole("dialog", { name: "Calculator" });
    expect(tool).toHaveAttribute("data-sat-tool-presentation", "compact-sheet");
    expect(tool).not.toHaveAttribute("aria-modal");
    expect(document.querySelectorAll("[aria-modal=true]").length).toBeLessThanOrEqual(1);
  });
});

describe("Wave A R-03 focus return per surface (option A: mounted selectors)", () => {
  it("directions: open, Escape, focus returns to the Directions trigger", async () => {
    render(<SatExamShell {...shellProps()} />);
    const trigger = screen.getByRole("button", { name: "Directions" });
    expect(trigger).toHaveAttribute("data-sat-focus", "topbar-directions");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Directions" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Directions" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("display: open, Escape, focus returns to the Display trigger", async () => {
    render(<SatExamShell {...shellProps()} />);
    const trigger = screen.getByRole("button", { name: "Display", exact: true });
    expect(trigger).toHaveAttribute("data-sat-focus", "topbar-reading");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Display" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Display" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("notes: open, Escape, focus returns to the Notes disclosure", async () => {
    render(<SatExamShell {...shellProps()} />);
    const trigger = screen.getByRole("button", { name: /^Notes/ });
    expect(trigger).toHaveAttribute("data-sat-focus", "topbar-notes");
    fireEvent.click(trigger);
    expect(screen.getByRole("complementary", { name: "Notes" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Notes" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("navigator: open, Escape, focus returns to the footer navigator trigger", async () => {
    render(<SatExamShell {...shellProps()} />);
    const trigger = screen.getByRole("button", { name: /open question navigator/i });
    expect(trigger).toHaveAttribute("data-sat-focus", "footer-navigator");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: /Questions/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /Questions/i })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("more: open, Escape, focus returns to the More trigger", async () => {
    render(<SatExamShell {...shellProps()} />);
    const trigger = screen.getByRole("button", { name: "More tools" });
    expect(trigger).toHaveAttribute("data-sat-focus", "topbar-more");
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "More tools" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "More tools" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("Wave A R-05 module timer toggle treatment", () => {
  it("is a quiet text button at target size: no pill border, underline on hover", () => {
    render(<SatExamShell {...shellProps()} />);
    const toggle = screen.getByRole("button", { name: "Hide timer" });
    expect(toggle.className).toContain("sat-touch-target");
    expect(toggle.className).not.toContain("rounded-full");
    expect(toggle.className).not.toContain("border");
    expect(toggle.className).toContain("hover:underline");
    expect(toggle.querySelector("span")?.className).toContain("sat-type-control-secondary");
  });
});
