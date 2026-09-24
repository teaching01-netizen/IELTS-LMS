import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { SatStudentSessionRoute } from "../SatStudentSessionRoute";

// Route-level between-sections coverage. The break screen and the controller's
// break arithmetic each have unit tests; what was untested is the wiring in
// between — that the server's authored window reaches the scheduled break with the
// break mode and the countdown to the *next* section, not the finished
// section's frozen 0:00.

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

function mathData(): AssessmentDeliveryBootstrap {
  const now = new Date().toISOString();
  const moduleQuestion = {
    examQuestionId: "q1",
    questionId: "q1",
    displayOrder: 0,
    isPretest: false,
    questionType: "single_choice" as const,
    stimulus: para("Passage"),
    prompt: para("Between sections marker question"),
    answer: {
      kind: "single_choice" as const,
      options: ["A", "B"].map((id) => ({ id, content: para("Choice " + id) })),
    },
    metadata: {
      sectionKey: "math",
      domain: null,
      skill: null,
      difficulty: "medium" as const,
      tags: [],
    },
    accessibility: { longDescription: null },
  };
  const moduleShape = {
    id: "math-m1",
    moduleKey: "math-m1",
    title: "Math Module 1",
    displayOrder: 0,
    durationSeconds: 2100,
    targetQuestionCount: 1,
    adaptiveRole: "base",
    instructions: para("Math module directions"),
    toolPolicy: { calculator: false, reference_sheet: false },
    questions: [moduleQuestion],
  };
  // Exam order, not display order, decides a section boundary: the Math section
  // follows Reading and Writing, so it must be preceded by that section's own
  // last module here. A payload whose first section is already Math is not a
  // boundary — it is the shape that used to make Module 2 of a later section
  // look like a section crossing.
  const sections = [
    {
      id: "sec-rw",
      sectionKey: "reading-writing",
      title: "Reading and Writing",
      displayOrder: 0,
      durationSeconds: 1920,
      breakAfterSeconds: 0,
      instructions: para("Reading and Writing directions"),
      modules: [
        { ...moduleShape, id: "rw-m1", moduleKey: "rw-m1", title: "Reading and Writing Module 1" },
      ],
    },
    {
      id: "sec-math",
      sectionKey: "math",
      title: "Math",
      displayOrder: 1,
      durationSeconds: 2100,
      breakAfterSeconds: 0,
      instructions: para("Math section directions"),
      modules: [moduleShape],
    },
  ];
  const moduleAttemptShape = {
    id: "ma-1",
    moduleId: "math-m1",
    state: "not_started",
    allocatedSeconds: 2100,
    availableAt: now,
    startedAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: null,
    remainingSeconds: 2100,
    completionReason: null,
    rawCorrect: null,
    operationalQuestionCount: null,
    toolState: {},
    revision: 1,
  };
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
      stageStatus: "completed",
      serverNow: now,
      deadlineAt: null,
      remainingSeconds: 0,
      waitingForNextSection: true,
      nextSectionStartAt: new Date(Date.parse(now) + 640_000).toISOString(),
      runtimeRevision: 12,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: sections as unknown as AssessmentDeliveryBootstrap["sections"],
    attempt: {
      id: "attempt-1",
      moduleAttempts: [
        {
          ...moduleAttemptShape,
          id: "ma-rw-1",
          moduleId: "rw-m1",
          state: "submitted",
          startedAt: now,
          deadlineAt: now,
          completionReason: "student_submit",
        },
        moduleAttemptShape,
      ] as unknown as AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"],
      responses: [],
    },
    result: null,
  };
}

/**
 * The pending module the way the controller resolves it: the first not_started
 * attempt in the payload, looked up across every section. (The old
 * "sections[0].modules[0]" shortcut cannot express Module 2, which is the second
 * module of the section the student is already in.)
 */
function pendingModuleOf(
  data: AssessmentDeliveryBootstrap,
): AssessmentDeliveryBootstrap["sections"][number]["modules"][number] | null {
  const pending = data.attempt.moduleAttempts.find(
    (attempt) => attempt.state === "not_started",
  );
  if (!pending) return null;
  for (const section of data.sections) {
    const module = section.modules.find(
      (candidate) => candidate.id === pending.moduleId,
    );
    if (module) return module;
  }
  return null;
}

/**
 * A reading-writing section with its adaptive Module 2 waiting to be opened.
 * `timedOut` says whether the finished Module 1 ended on its own clock (the
 * hand-off) or with time to spare (the student opens Module 2).
 */
function branchPendingData(timedOut: boolean): AssessmentDeliveryBootstrap {
  const data = mathData();
  const section = data.sections[0] as unknown as {
    id: string;
    sectionKey: string;
    title: string;
    displayOrder: number;
    modules: Array<Record<string, unknown>>;
  };
  const baseModule = { ...section.modules[0], id: "rw-m1", moduleKey: "rw-m1" };
  const branchModule = {
    ...section.modules[0],
    id: "rw-m2-higher",
    moduleKey: "rw-m2-higher",
    title: "Reading and Writing Module 2",
    displayOrder: 1,
    adaptiveRole: "higher_branch",
  };
  const module1 = data.attempt.moduleAttempts[0];
  return {
    ...data,
    sections: [
      {
        ...section,
        id: "sec-rw",
        sectionKey: "reading-writing",
        title: "Reading and Writing",
        displayOrder: 0,
        modules: [baseModule, branchModule],
      },
    ] as unknown as AssessmentDeliveryBootstrap["sections"],
    timing: {
      ...data.timing,
      stageKey: "reading-writing",
      stageStatus: "live",
      waitingForNextSection: false,
      nextSectionStartAt: null,
    },
    attempt: {
      ...data.attempt,
      moduleAttempts: [
        {
          ...module1,
          id: "ma-rw-1",
          moduleId: "rw-m1",
          state: "submitted",
          startedAt: data.serverNow,
          completionReason: "student_submit",
          deadlineAt: new Date(
            Date.parse(data.serverNow) + (timedOut ? -5_000 : 600_000),
          ).toISOString(),
        },
        {
          ...module1,
          id: "ma-rw-2",
          moduleId: "rw-m2-higher",
          // The server routed Module 2 exists but has not opened: no start, no
          // deadline, no completion reason — only a not_started row may be
          // entered (and an attempt carrying a started one is not a handoff).
          state: "not_started",
          startedAt: null,
          deadlineAt: null,
          completionReason: null,
          revision: 3,
        },
      ],
    } as unknown as AssessmentDeliveryBootstrap["attempt"],
  };
}

function baseCommands() {
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

function directionsState() {
  return {
    phase: "directions",
    scheduleId: "schedule-1",
    candidateId: "candidate-1",
    assessmentId: "exam-1",
    sectionKey: null,
    moduleKey: null,
    questionIds: [],
    questionIndex: 0,
    responses: {},
    responseRevisions: {},
    toolCapabilities: { calculator: false, referenceSheet: false },
    activeTool: null,
    activeTools: { calculator: false, referenceSheet: false },
    startedAt: null,
    endsAt: null,
    pendingNextSectionKey: "math",
  };
}

function routeProps() {
  return {
    scheduleId: "schedule-1",
    attemptId: "attempt-1",
    candidateId: "candidate-1",
    runtimeSnapshot: null,
    liveSocketConnected: false,
    attemptUpdateToken: 0,
    onExit: () => undefined,
  } as unknown as Record<string, never>;
}

interface EntryOptions {
  /** "break" renders the scheduled break while its timer runs out. */
  phase?: "directions" | "break";
  isStarting?: boolean;
  autoEntryRecoverable?: boolean;
}

function seed(
  data: AssessmentDeliveryBootstrap | null,
  pending: {
    breakSeconds: number;
    waitSeconds: number;
  },
  entry: EntryOptions = {},
) {
  const state = { ...directionsState(), phase: entry.phase ?? "directions" };
  const module = data ? pendingModuleOf(data) : null;
  controllerMock.current = {
    state,
    data,
    result: null,
    error: null,
    setError: () => undefined,
    isSubmitting: false,
    isStarting: entry.isStarting ?? false,
    autoEntryRecoverable: entry.autoEntryRecoverable ?? false,
    entryReason: "next-module-entry",
    retryModuleEntry: vi.fn(),
    pendingModule: module,
    pendingBreakSeconds: pending.breakSeconds,
    pendingSectionWaitSeconds: pending.waitSeconds,
    pendingStageReady: true,
    effectiveTiming: data?.timing ?? null,
    stateModule: module,
    stateModuleAttempt: data ? (data.attempt.moduleAttempts[0] ?? undefined) : undefined,
    stateSection: data ? (data.sections[0] ?? null) : null,
    remainingSeconds: 0,
    blocked: false,
    warning: null,
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
    commands: baseCommands(),
  };
}

function renderRoute(
  data: AssessmentDeliveryBootstrap,
  pending: { breakSeconds: number; waitSeconds: number },
  entry: EntryOptions = {},
) {
  seed(data, pending, entry);
  return render(<SatStudentSessionRoute {...(routeProps() as never)} />);
}

describe("SatStudentSessionRoute between-sections window", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    matchMediaMock();
  });

  it("renders the authored break counting down to the next section", () => {
    renderRoute(mathData(), { breakSeconds: 640, waitSeconds: 0 });

    expect(screen.getByText("Scheduled break")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("10:40");
    expect(screen.getByText("Math is next")).toBeInTheDocument();
    expect(screen.queryByText("Section complete")).not.toBeInTheDocument();
  });

  it("shows a configured two-minute break as 2:00 when the break starts", () => {
    renderRoute(mathData(), { breakSeconds: 120, waitSeconds: 0 });

    expect(screen.getByText("Scheduled break")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("2:00");
    expect(screen.queryByText("0:00")).not.toBeInTheDocument();
  });

  it("renders the early-finish wait instead of a break until the section clock runs out", () => {
    renderRoute(mathData(), { breakSeconds: 0, waitSeconds: 300 });

    expect(screen.getByText("Section complete")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("5:00");
    expect(screen.queryByText("Scheduled break")).not.toBeInTheDocument();
  });

  // At 0:00 the same break surface stays mounted for the tiny propagation
  // window and is replaced directly by Math Module 1 when state arrives —
  // never "Opening Math…".
  it("holds the same break surface at 0:00 with no opening copy", () => {
    renderRoute(
      mathData(),
      { breakSeconds: 0, waitSeconds: 0 },
      { phase: "break" },
    );

    expect(screen.getByTestId("sat-scheduled-break")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Take a short break." })).toBeInTheDocument();
    expect(screen.queryByText(/Opening Math/)).toBeNull();
    expect(screen.queryByText(/Still opening/)).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps one scheduled-break surface mounted through waiting, break, and opening", () => {
    const data = mathData();
    const view = renderRoute(data, { breakSeconds: 0, waitSeconds: 300 });
    const surface = screen.getByTestId("sat-scheduled-break");

    seed(data, { breakSeconds: 120, waitSeconds: 0 });
    view.rerender(<SatStudentSessionRoute {...(routeProps() as never)} />);
    expect(screen.getByTestId("sat-scheduled-break")).toBe(surface);

    seed(data, { breakSeconds: 0, waitSeconds: 0 }, { phase: "break" });
    view.rerender(<SatStudentSessionRoute {...(routeProps() as never)} />);
    expect(screen.getByTestId("sat-scheduled-break")).toBe(surface);
  });
});

// The server-selected Module 2 appears without the old directions surface.
describe("SatStudentSessionRoute module advance", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    matchMediaMock();
  });

  it.each([false, true])("does not show directions for the routed Module 2 (timeout=%s)", (timedOut) => {
    renderRoute(
      branchPendingData(timedOut),
      { breakSeconds: 0, waitSeconds: 0 },
    );

    // Server-driven M1→M2: no directions, no opening, no recovery — the waiting
    // room holds transiently (or the skew-hold with a frame) until the active
    // Module 2 replaces it.
    expect(screen.queryByText(/Module directions/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Begin module/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Opening/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry now/ })).toBeNull();
  });
});
