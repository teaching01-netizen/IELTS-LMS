import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { satStageAnimation } from "../motion/satPresence";
import { SatStudentStageHost } from "./SatStudentStageHost";

/**
 * The one presentation owner of student surfaces.
 *
 * What these tests pin is the invariant the student experience rests on: at any
 * instant exactly ONE stage is the live one. A departing stage may still be
 * fading, but it is inert and hidden from assistive tech, so role queries and
 * screen readers see a single surface.
 */

function matchMediaMock(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function stage(kind: "exam" | "scheduled-break" | "pre-start", key: string) {
  return { kind, key } as const;
}

function frame(testId: string, label: string) {
  return (
    <div data-testid={testId}>
      <p role="status">{label}</p>
    </div>
  );
}

describe("SatStudentStageHost", () => {
  beforeEach(() => {
    cleanup();
    matchMediaMock(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks the departing stage inert and hidden while it fades", () => {
    const view = render(
      <SatStudentStageHost stage={stage("exam", "exam:attempt-1")}>
        {frame("stage-a", "Exam")}
      </SatStudentStageHost>,
    );

    expect(document.querySelectorAll('[data-sat-stage="exam"]')).toHaveLength(1);
    view.rerender(
      <SatStudentStageHost stage={stage("scheduled-break", "break:attempt-1:math")}>
        {frame("stage-b", "Scheduled break")}
      </SatStudentStageHost>,
    );

    // The incoming stage is live and the departing one is on its way out...
    expect(screen.getByTestId("stage-b")).toBeInTheDocument();
    const exiting = document.querySelector("[data-sat-stage-exiting]");
    expect(exiting).not.toBeNull();
    expect(exiting).toHaveAttribute("inert");
    expect(exiting).toHaveAttribute("aria-hidden", "true");
    // ...which is why exactly one surface is announced.
    expect(screen.getAllByRole("status")).toHaveLength(1);

    // And it is gone once the fade completes.
    return waitFor(() => expect(document.querySelector("[data-sat-stage-exiting]")).toBeNull());
  });

  it("keeps a stage mounted while its key is unchanged", () => {
    const view = render(
      <SatStudentStageHost stage={stage("exam", "exam:attempt-1")}>
        <div data-testid="stage-a">Exam</div>
      </SatStudentStageHost>,
    );
    const node = screen.getByTestId("stage-a");

    view.rerender(
      <SatStudentStageHost stage={stage("exam", "exam:attempt-1")}>
        <div data-testid="stage-a">Exam, again</div>
      </SatStudentStageHost>,
    );

    expect(screen.getByTestId("stage-a")).toBe(node);
    expect(document.querySelectorAll("[data-sat-stage]")).toHaveLength(1);
    expect(document.querySelector("[data-sat-stage-exiting]")).toBeNull();
  });

  it("reduces the stage cross-fade to nothing when motion is reduced", () => {
    // The host renders the current layer with no presence at all under reduced
    // motion, so the animation itself must also resolve instantly — the e2e
    // transition run drives this path with `reducedMotion: 'reduce'`.
    expect(satStageAnimation(true)).toMatchObject({
      initial: false,
      transition: { duration: 0 },
      exit: { opacity: 1, pointerEvents: "none", transition: { duration: 0 } },
    });
    expect(satStageAnimation(false)).toMatchObject({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
    });
  });

  it("swaps instantly when the caller says this is not a transition", () => {
    const view = render(
      <SatStudentStageHost stage={stage("exam", "exam:attempt-1")}>
        {frame("stage-a", "Exam")}
      </SatStudentStageHost>,
    );

    view.rerender(
      <SatStudentStageHost stage={stage("exam", "exam:attempt-2")} instant>
        {frame("stage-b", "Exam")}
      </SatStudentStageHost>,
    );

    expect(screen.queryByTestId("stage-a")).toBeNull();
    expect(document.querySelectorAll('[data-sat-stage="exam"]')).toHaveLength(1);
  });

  it("paints one opaque backdrop the layers sit on", () => {
    render(
      <SatStudentStageHost stage={stage("exam", "exam:attempt-1")}>
        <div>Exam</div>
      </SatStudentStageHost>,
    );
    const root = document.querySelector("[data-sat-stage-root]");
    expect(root).not.toBeNull();
    expect(root?.className).toContain("bg-[var(--sat-background)]");
  });
});
