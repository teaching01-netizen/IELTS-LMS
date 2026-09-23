import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { createSatReadingPreferences } from "../../domain/satReadingPreferences";
import {
  hasSatExamZoomDecision,
  loadSatReadingPreferences,
  satReadingPreferencesKey,
  saveSatReadingPreferences,
} from "../../infrastructure/satReadingPreferencesStore";
import { SatStudentSessionRoute } from "../SatStudentSessionRoute";

/**
 * The automatic screen-zoom fit, on the delivery route a student actually loads.
 *
 * The policy, the walk and the shell are tested where they live; what only these
 * tests can show is that the fit ENGAGES for a student at all — the route's
 * opt-in was otherwise a line of code with a browser proof from the dev harness.
 *
 * The second test is the one that matters most: a module boundary unmounts and
 * remounts the exam, and an attempt that already decided must not decide again.
 */

const controllerMock = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../hooks/useSatExamController", () => ({
  useSatExamController: () => controllerMock.current,
}));

function matchMediaMock() {
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
    })),
  );
}

function para(text: string) {
  return { version: 1 as const, nodes: [{ type: "paragraph" as const, id: "p-" + text, text }] };
}

const QUESTION = {
  examQuestionId: "q1",
  questionId: "q1",
  displayOrder: 0,
  isPretest: false,
  questionType: "single_choice" as const,
  stimulus: para("October, painted in the realist style by Jules Bastien-Lepage, depicts peasant women."),
  prompt: para("Which choice completes the text?"),
  answer: {
    kind: "single_choice" as const,
    options: ["A", "B"].map((id) => ({ id, content: para("Choice " + id) })),
  },
  metadata: {
    sectionKey: "reading-writing",
    domain: null,
    skill: null,
    difficulty: "medium" as const,
    tags: [],
  },
  accessibility: { longDescription: null },
};

function moduleData(): AssessmentDeliveryBootstrap {
  const now = new Date().toISOString();
  return {
    scheduleId: "schedule-1",
    examId: "exam-1",
    providerKey: "sat",
    versionId: "v1",
    serverNow: now,
    candidateName: "Ada Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: "reading-writing",
      stageStatus: "live",
      serverNow: now,
      deadlineAt: null,
      remainingSeconds: 1200,
      waitingForNextSection: false,
      nextSectionStartAt: null,
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [
      {
        id: "sec-rw",
        sectionKey: "reading-writing",
        title: "Reading and Writing",
        displayOrder: 0,
        durationSeconds: 1920,
        breakAfterSeconds: 0,
        instructions: para("Reading and Writing directions"),
        modules: [],
      },
    ] as unknown as AssessmentDeliveryBootstrap["sections"],
    attempt: {
      id: "attempt-1",
      moduleAttempts: [],
    } as unknown as AssessmentDeliveryBootstrap["attempt"],
  } as unknown as AssessmentDeliveryBootstrap;
}

function commands() {
  return {
    startPendingModule: vi.fn(),
    submitModule: vi.fn(),
    retryFinalization: vi.fn(),
    takeOverDurabilityLease: vi.fn().mockResolvedValue(undefined),
    setAnswer: vi.fn(),
    toggleReview: vi.fn(),
    toggleEliminatedOption: vi.fn(),
    setAnnotationNote: vi.fn(),
    setAnnotations: vi.fn(),
    selectQuestion: vi.fn(),
    returnToQuestion: vi.fn(),
    previousQuestion: vi.fn(),
    nextQuestion: vi.fn(),
    reviewModule: vi.fn(),
    returnToModule: vi.fn(),
    showDirections: vi.fn(),
    toggleCalculator: vi.fn(),
    toggleReference: vi.fn(),
    closeTool: vi.fn(),
  };
}

function response(q: typeof QUESTION) {
  return {
    questionId: q.examQuestionId,
    answer: "",
    markedForReview: false,
    eliminatedOptionIds: [],
    annotations: { version: 2 as const, annotations: [], legacyQuestionNote: "" },
  };
}

/** The module-phase frame the route renders the exam from. */
function seedModulePhase() {
  const data = moduleData();
  const module = {
    id: "rw-m1",
    moduleKey: "rw-m1",
    title: "Module 1",
    displayOrder: 0,
    durationSeconds: 1200,
    targetQuestionCount: 1,
    adaptiveRole: "base",
    instructions: para("Module directions"),
    toolPolicy: { calculator: false, reference_sheet: false },
    questions: [QUESTION],
  };
  controllerMock.current = {
    state: {
      phase: "module",
      scheduleId: "schedule-1",
      candidateId: "candidate-1",
      assessmentId: "exam-1",
      sectionKey: "reading-writing",
      moduleKey: "rw-m1",
      nextSectionKey: "math",
      questionIds: ["q1"],
      questionIndex: 0,
      responses: { q1: response(QUESTION) },
      responseRevisions: {},
      toolCapabilities: { calculator: false, referenceSheet: false },
      activeTool: null,
      activeTools: { calculator: false, referenceSheet: false },
      startedAt: data.serverNow,
      endsAt: data.timing.deadlineAt,
    },
    data,
    result: null,
    error: null,
    setError: () => undefined,
    isSubmitting: false,
    isStarting: false,
    autoEntryRecoverable: false,
    entryAutoStartPending: true,
    pendingModule: null,
    pendingBreakSeconds: 0,
    pendingSectionWaitSeconds: 0,
    pendingStageReady: true,
    prewarmEligibleModule: null,
    effectiveTiming: data.timing,
    stateModule: module,
    stateModuleAttempt: { id: "ma-rw-1", moduleId: "rw-m1", state: "in_progress" },
    stateSection: data.sections[0],
    remainingSeconds: 1200,
    blocked: false,
    warning: null,
    autoSubmitted: false,
    answersRecorded: false,
    showAlmostUp: false,
    persistence: {
      pendingCount: 0,
      visibleDrafts: {},
      failure: null,
      failureKind: null,
      isTakingOver: false,
      flush: vi.fn().mockResolvedValue(undefined),
      retryFailed: vi.fn(),
      takeOverLease: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(),
      submit: vi.fn(),
    },
    commands: commands(),
  };
  return data;
}

/**
 * A fake layout for the two panes, driven by the zoom the exam is RENDERING —
 * read back out of the DOM, so the stub cannot answer the same thing for every
 * candidate. Otherwise the test would prove only that a walk happens, not that
 * it stops where the layout says it can.
 */
function stubPaneLayout(fits: (zoom: number) => boolean) {
  // One measurement of one pane is counted once: the scroll height is what the
  // verdict turns on, and the client height that goes with it is the same
  // measurement, not a second one.
  const measurements = { count: 0 };
  const heightOf = (property: "scrollHeight" | "clientHeight"): number => {
    const zoom = Number(
      document.querySelector("[data-sat-screen-zoom]")?.getAttribute("data-sat-screen-zoom") ?? 1,
    );
    if (property === "clientHeight") return 900;
    return fits(zoom) ? 600 : 1400;
  };
  for (const property of ["scrollHeight", "clientHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.matches?.("[data-sat-passage-scroll], [data-sat-question-scroll]")) return 0;
        if (property === "scrollHeight") measurements.count += 1;
        return heightOf(property);
      },
    });
  }
  return measurements;
}

function routeElement(attemptId = "attempt-1") {
  return (
    <SatStudentSessionRoute
      scheduleId="schedule-1"
      attemptId={attemptId}
      candidateId="candidate-1"
      runtimeSnapshot={null}
      liveSocketConnected={false}
      attemptUpdateToken={0}
      onExit={() => undefined}
    />
  );
}

function renderRoute(attemptId = "attempt-1") {
  return render(routeElement(attemptId));
}

const contentBox = () => document.querySelector("[data-sat-zoom-plane]")!;
const fitRoot = () => document.querySelector("[data-sat-fit-root]")!;

describe("SatStudentSessionRoute auto-fit screen zoom", () => {
  beforeEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
    matchMediaMock();
  });

  afterEach(() => {
    for (const property of ["scrollHeight", "clientHeight"]) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property];
    }
    vi.unstubAllGlobals();
  });

  it("fits the question it opens on and stores the decision against the attempt", () => {
    seedModulePhase();
    const measurements = stubPaneLayout((zoom) => zoom <= 0.75);

    renderRoute();

    // Both panes measured at the resting zoom, then again at the candidate that
    // fits (4 = 2 panes x 2 candidates) — and the exam is rendering that
    // decision.
    expect(measurements.count).toBe(4);
    expect(contentBox()).toHaveAttribute("data-sat-screen-zoom", "0.75");
    expect(fitRoot()).toHaveAttribute("data-sat-fit-probing", "false");
    expect(loadSatReadingPreferences("schedule-1", "attempt-1").examZoom).toBe(0.75);
  });

  it("decides once per attempt: the next module does not decide again", async () => {
    seedModulePhase();
    const measurements = stubPaneLayout(() => true);

    const { rerender, unmount } = renderRoute();

    // Module 1 fits at the resting zoom, so the decision stores no zoom at all.
    expect(measurements.count).toBe(2);
    expect(contentBox()).toHaveAttribute("data-sat-screen-zoom", "1");
    expect(loadSatReadingPreferences("schedule-1", "attempt-1").examZoom).toBeUndefined();
    const firstShell = contentBox();

    // A section boundary: the exam leaves for the scheduled break. It departs
    // through the stage cross-fade, so the zoom plane is gone once that settles
    // — no exam surface is left behind.
    (controllerMock.current as { state: { phase: string } }).state.phase = "break";
    rerender(routeElement());
    await waitFor(() =>
      expect(document.querySelector("[data-sat-screen-zoom]")).toBeNull(),
    );

    // ...and comes back as a NEW shell inside the SAME attempt.
    (controllerMock.current as { state: { phase: string } }).state.phase = "module";
    rerender(routeElement());

    expect(screen.getByTestId("sat-exam-shell")).toBeInTheDocument();
    expect(contentBox()).not.toBe(firstShell);
    // Nothing was measured a second time: the attempt remembered its decision,
    // which is the only thing that could have stopped this — module 1 stored no
    // zoom to gate on.
    expect(measurements.count).toBe(2);
    expect(contentBox()).toHaveAttribute("data-sat-screen-zoom", "1");
    unmount();
  });

  it("keeps the decision across a page reload that stored no zoom", () => {
    seedModulePhase();
    const beforeReload = stubPaneLayout(() => true);

    const view = renderRoute();

    // Module 1 fits at the resting zoom: the attempt decided, and the decision
    // stored nothing at all — which is exactly the case an in-memory latch could
    // not carry, because there was no value to carry it in.
    expect(beforeReload.count).toBe(2);
    expect(
      window.localStorage.getItem(satReadingPreferencesKey("schedule-1", "attempt-1")),
    ).toBeNull();
    expect(hasSatExamZoomDecision("schedule-1", "attempt-1")).toBe(true);

    // Reload: same attempt, same storage, brand-new page. The panes now report
    // overflow, so a fresh decision would measure to find that out and shrink.
    view.unmount();
    seedModulePhase();
    const afterReload = stubPaneLayout(() => false);

    renderRoute();

    expect(afterReload.count).toBe(0);
    expect(contentBox()).toHaveAttribute("data-sat-screen-zoom", "1");
  });

  it("starts a new attempt undecided", () => {
    seedModulePhase();
    const measurements = stubPaneLayout(() => true);

    const { rerender } = renderRoute();
    // Attempt 1 decides that nothing needs to change.
    expect(measurements.count).toBe(2);

    // The same route carries a different attempt, and that attempt reaches its
    // own module boundary. It has decided nothing, so its exam fits for itself —
    // a decision must never leak from one attempt into the next.
    rerender(routeElement("attempt-2"));
    (controllerMock.current as { state: { phase: string } }).state.phase = "break";
    rerender(routeElement("attempt-2"));
    (controllerMock.current as { state: { phase: string } }).state.phase = "module";
    rerender(routeElement("attempt-2"));

    expect(screen.getByTestId("sat-exam-shell")).toBeInTheDocument();
    expect(measurements.count).toBe(4);
  });

  it("never overrides the zoom the student chose, at any value", () => {
    // 100% included: a stored 1 is a choice the student made, not an empty
    // attempt, and only the store's round trip keeps that distinction alive.
    for (const examZoom of [1, 0.75, 1.5]) {
      window.localStorage.clear();
      saveSatReadingPreferences("schedule-1", "attempt-1", {
        ...createSatReadingPreferences(),
        examZoom,
      });
      seedModulePhase();
      const measurements = stubPaneLayout(() => false);

      renderRoute();

      expect(measurements.count, `examZoom ${examZoom}`).toBe(0);
      expect(contentBox(), `examZoom ${examZoom}`).toHaveAttribute(
        "data-sat-screen-zoom",
        String(examZoom),
      );
      cleanup();
    }
  });
});
