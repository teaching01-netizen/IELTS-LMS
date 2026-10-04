import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  createSatReadingPreferences,
  type SatReadingPreferences,
} from "../../domain/satReadingPreferences";
import { SatExamShell, type SatExamShellProps } from "../SatExamShell";
import { SatQuestionWorkspace } from "../question/SatQuestionWorkspace";

/**
 * The two systems that used to fight each other, on one page.
 *
 * The reading layout reflows the panes when the student raises Text size; the
 * auto-fit shrinks the whole exam so a question stops scrolling. Left
 * unconnected, one undoes the other: a student who asked for bigger text gets
 * the exam shrunk around it, and a student whose exam has already reflowed gets
 * a second, invisible layout change. So the shell reads the ONE measured layout
 * decision, and these cases pin what it does with it.
 */

/** A ResizeObserver a test can fire by hand, so a width change is a real event. */
class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  emit(box: { width: number; height: number }): void {
    const target = this.observed[this.observed.length - 1];
    if (!target) throw new Error("nothing is observed");
    this.callback(
      [
        {
          target,
          contentBoxSize: [{ inlineSize: box.width, blockSize: box.height }],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver
    );
  }
}

let workspaceBox = { width: 390, height: 844 };
let paneFits: (zoom: number) => boolean = () => true;
let paneMeasurements = 0;
const originalResizeObserver = globalThis.ResizeObserver;

/**
 * The DOM the exam is measured against: the workspace reports the logical box a
 * test chose, and the two reading panes report whether they scroll at the zoom
 * the exam is rendering — read back out of the DOM, so the stub cannot answer
 * the same thing for every candidate.
 */
function stubExamDom() {
  const define = (property: string, get: (element: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        return typeof this.matches === "function" ? get(this) : 0;
      },
    });
  define("clientWidth", (element) =>
    element.matches("[data-sat-reading-split]") ? workspaceBox.width : 0
  );
  define("clientHeight", (element) =>
    element.matches("[data-sat-reading-split]")
      ? workspaceBox.height
      : element.matches("[data-sat-passage-scroll], [data-sat-question-scroll]")
        ? 900
        : 0
  );
  define("scrollHeight", (element) => {
    if (!element.matches("[data-sat-passage-scroll], [data-sat-question-scroll]")) return 0;
    paneMeasurements += 1;
    const zoom = Number(
      document.querySelector("[data-sat-screen-zoom]")?.getAttribute("data-sat-screen-zoom") ?? 1
    );
    return paneFits(zoom) ? 600 : 1400;
  });
}

function clearExamDom() {
  for (const property of ["clientWidth", "clientHeight", "scrollHeight"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property];
  }
}

function shellProps(overrides: Partial<SatExamShellProps> = {}): SatExamShellProps {
  return {
    sectionLabel: "Section 1: Reading and Writing",
    sectionKey: "reading-writing",
    directions: null,
    remainingLabel: "27:14",
    candidateName: "Ada Candidate",
    questionIndex: 0,
    questionCount: 3,
    navigationItems: [
      { id: "q1", index: 0, number: 1, status: "answered", current: true, markedForReview: false },
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

/**
 * The exam as delivery renders it: a real reading workspace inside the shell,
 * with the preferences the shell writes flowing back in.
 */
function Harness({
  autoFit = false,
  onScreenZoomDecided,
  preferences: initialPreferences,
  onPreferencesChange,
}: {
  autoFit?: boolean;
  onScreenZoomDecided?: () => void;
  preferences?: SatReadingPreferences;
  onPreferencesChange?: (preferences: SatReadingPreferences) => void;
}) {
  const [preferences, setPreferences] = useState(
    initialPreferences ?? createSatReadingPreferences()
  );
  // The attempt-scoped half of the rule, held exactly where delivery holds it:
  // "this attempt has had its automatic zoom decision" outlives the shell.
  const [screenZoomDecided, setScreenZoomDecided] = useState(false);
  return (
    <SatExamShell
      {...shellProps({
        readingPreferences: preferences,
        autoFitScreenZoom: autoFit,
        screenZoomDecided,
        onScreenZoomDecided: () => {
          setScreenZoomDecided(true);
          onScreenZoomDecided?.();
        },
        onReadingPreferencesChange: (next) => {
          setPreferences(next);
          onPreferencesChange?.(next);
        },
      })}
    >
      <SatQuestionWorkspace
        split
        stimulus={<p>Passage text</p>}
        question={<p>Question text</p>}
        readingPreferences={preferences}
        onSplitRatioChange={vi.fn()}
      />
    </SatExamShell>
  );
}

const zoomPlane = () => document.querySelector("[data-sat-screen-zoom]")!;
const workspace = () => document.querySelector("[data-sat-reading-layout]")!;
const readingLayoutObserver = () =>
  [...ResizeObserverStub.instances]
    .reverse()
    .find(
      (observer) =>
        !observer.disconnected &&
        observer.observed.some((element) => element.matches("[data-sat-reading-split]"))
    );

beforeEach(() => {
  workspaceBox = { width: 390, height: 844 };
  paneFits = () => true;
  paneMeasurements = 0;
  ResizeObserverStub.instances = [];
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
  stubExamDom();
});

afterEach(() => {
  cleanup();
  clearExamDom();
  globalThis.ResizeObserver = originalResizeObserver;
  vi.unstubAllGlobals();
});

describe("auto-fit under the adaptive reading layout", () => {
  it("lets a stacked reading layout answer the zoom question, without shrinking the exam", () => {
    // The panes overflow at every zoom, so a fit that ran would find something to
    // do. It must not run: the student raised Text size, the panes stacked, and
    // shrinking everything now would take the reading size back.
    paneFits = () => false;
    const onScreenZoomDecided = vi.fn();
    render(<Harness autoFit onScreenZoomDecided={onScreenZoomDecided} />);

    expect(workspace()).toHaveAttribute("data-sat-reading-layout", "stacked");
    expect(paneMeasurements).toBe(0);
    expect(zoomPlane()).toHaveAttribute("data-sat-screen-zoom", "1");
    // The decision is made, and it is "no automatic zoom": the attempt is not
    // left undecided for a later measurement to pick up.
    expect(onScreenZoomDecided).toHaveBeenCalledTimes(1);
  });

  it("never starts an automatic fit later, when the layout grows a passage pane again", () => {
    paneFits = () => false;
    const onScreenZoomDecided = vi.fn();
    render(<Harness autoFit onScreenZoomDecided={onScreenZoomDecided} />);
    expect(onScreenZoomDecided).toHaveBeenCalledTimes(1);

    // Rotate or widen: the panes fit side by side again.
    act(() => {
      workspaceBox = { width: 1024, height: 768 };
      const observer = readingLayoutObserver();
      expect(observer).toBeDefined();
      observer!.emit(workspaceBox);
    });

    expect(workspace()).toHaveAttribute("data-sat-reading-layout", "split");
    // Nothing measured, nothing fitted: the decision was already made.
    expect(paneMeasurements).toBe(0);
    expect(zoomPlane()).toHaveAttribute("data-sat-screen-zoom", "1");
  });

  it("still fits when the student presses Fit to screen themselves", () => {
    paneFits = (zoom) => zoom <= 0.75;
    const changed: SatReadingPreferences[] = [];
    render(<Harness autoFit onPreferencesChange={(next) => changed.push(next)} />);
    // The automatic pass declined: the layout owns the widths.
    expect(paneMeasurements).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    fireEvent.click(screen.getByRole("button", { name: /Fit to screen/i }));

    // Two panes measured at the resting zoom and two at the candidate that fits.
    expect(paneMeasurements).toBe(4);
    expect(zoomPlane()).toHaveAttribute("data-sat-screen-zoom", "0.75");
    expect(changed.at(-1)?.examZoom).toBe(0.75);
  });

  it("fits normally when the reading layout is split and the attempt is undecided", () => {
    workspaceBox = { width: 1440, height: 900 };
    paneFits = () => true;
    const onScreenZoomDecided = vi.fn();
    render(<Harness autoFit onScreenZoomDecided={onScreenZoomDecided} />);

    expect(workspace()).toHaveAttribute("data-sat-reading-layout", "split");
    // Both panes measured once at the resting zoom, which fits: the fit decided,
    // and decided that nothing changes.
    expect(paneMeasurements).toBe(2);
    expect(zoomPlane()).toHaveAttribute("data-sat-screen-zoom", "1");
    expect(onScreenZoomDecided).toHaveBeenCalledTimes(1);
  });

  it("never runs the automatic fit twice in one attempt", async () => {
    workspaceBox = { width: 1440, height: 900 };
    const onScreenZoomDecided = vi.fn();
    const { rerender } = render(<Harness autoFit onScreenZoomDecided={onScreenZoomDecided} />);
    expect(paneMeasurements).toBe(2);

    // The attempt reports its decision, and the exam re-renders with it.
    rerender(<Harness autoFit onScreenZoomDecided={onScreenZoomDecided} />);
    await waitFor(() => expect(paneMeasurements).toBe(2));
  });
});
