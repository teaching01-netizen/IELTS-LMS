import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { SatStudentSessionRoute } from "../SatStudentSessionRoute";

/**
 * The module handoff, at the route a student actually loads.
 *
 * The rule under test is continuity: when Module 1 closes and the server-routed
 * Module 2 opens, the student stays inside ONE exam frame. The finished frame
 * keeps its place (same DOM node, inert and hidden behind one live status card),
 * no transition screen replaces it, and the section-break surface stays out of a
 * handoff that never crosses a section — including in the Math section, whose
 * display order is what used to make Module 2 look like a boundary.
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
  return { version: 1 as const, nodes: [{ type: "paragraph" as const, id: `p-${text}`, text }] };
}

function satQuestion(id: string, prompt: string) {
  return {
    examQuestionId: id,
    questionId: id,
    displayOrder: 0,
    isPretest: false,
    questionType: "single_choice" as const,
    stimulus: para("Passage"),
    prompt: para(prompt),
    answer: {
      kind: "single_choice" as const,
      options: ["A", "B"].map((optionId) => ({ id: optionId, content: para(`Choice ${optionId}`) })),
    },
    metadata: { sectionKey: "math", domain: null, skill: null, difficulty: "medium" as const, tags: [] },
    accessibility: { longDescription: null },
  };
}

function satModule(id: string, displayOrder: number, role: string, prompt: string) {
  return {
    id,
    moduleKey: id,
    title: id,
    displayOrder,
    durationSeconds: 2100,
    targetQuestionCount: 1,
    adaptiveRole: role,
    instructions: para(`${id} directions`),
    toolPolicy: { calculator: false, reference_sheet: false },
    questions: [satQuestion(`${id}-q1`, prompt)],
  };
}

interface AttemptRow {
  id: string;
  moduleId: string;
  state: string;
  startedAt: string | null;
  completionReason: string | null;
  revision: number;
}

function attemptRow(
  id: string,
  moduleId: string,
  state: string,
  now: string,
  revision = 1,
): AttemptRow & Record<string, unknown> {
  return {
    id,
    moduleId,
    state,
    allocatedSeconds: 2100,
    availableAt: now,
    startedAt: state === "not_started" ? null : now,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: state === "not_started" ? null : new Date(Date.parse(now) + 2_100_000).toISOString(),
    remainingSeconds: 2100,
    completionReason: state === "submitted" ? "student_submit" : null,
    rawCorrect: null,
    operationalQuestionCount: null,
    toolState: {},
    revision,
  };
}

/**
 * A real exam order: Reading and Writing (0) then Math (1), each with a base
 * module and its routed Module 2.
 */
function examData(
  moduleAttempts: Array<AttemptRow & Record<string, unknown>>,
): AssessmentDeliveryBootstrap {
  const now = new Date("2026-09-23T09:00:00.000Z").toISOString();
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
      stageKey: "math",
      stageStatus: "live",
      serverNow: now,
      deadlineAt: null,
      remainingSeconds: 2100,
      waitingForNextSection: false,
      nextSectionStartAt: null,
      runtimeRevision: 9,
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
        durationSeconds: 3840,
        breakAfterSeconds: 0,
        instructions: para("Reading and Writing directions"),
        modules: [
          satModule("rw-m1", 0, "base", "Reading and Writing Module 1 marker"),
        ],
      },
      {
        id: "sec-math",
        sectionKey: "math",
        title: "Math",
        displayOrder: 1,
        durationSeconds: 4200,
        breakAfterSeconds: 0,
        instructions: para("Math section directions"),
        modules: [
          satModule("math-m1", 0, "base", "Math Module 1 marker"),
          satModule("math-m2-higher", 1, "higher_branch", "Math Module 2 marker"),
        ],
      },
    ] as unknown as AssessmentDeliveryBootstrap["sections"],
    attempt: {
      id: "attempt-1",
      moduleAttempts: moduleAttempts as unknown as AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"],
      responses: [],
    },
    result: null,
  };
}

/** Math Module 1 live, Module 2 routed but not yet open. */
function mathModuleOneLive(): AssessmentDeliveryBootstrap {
  const now = new Date("2026-09-23T09:00:00.000Z").toISOString();
  return examData([
    attemptRow("ma-rw-1", "rw-m1", "submitted", now),
    attemptRow("ma-math-1", "math-m1", "active", now, 2),
    attemptRow("ma-math-2", "math-m2-higher", "not_started", now, 3),
  ]);
}

/** Math Module 1 closed; the server has routed Module 2. */
function mathModuleTwoRouted(): AssessmentDeliveryBootstrap {
  const now = new Date("2026-09-23T09:00:00.000Z").toISOString();
  return examData([
    attemptRow("ma-rw-1", "rw-m1", "submitted", now),
    attemptRow("ma-math-1", "math-m1", "submitted", now, 2),
    attemptRow("ma-math-2", "math-m2-higher", "not_started", now, 3),
  ]);
}

/** The section boundary: Math Module 1 is what opens next. */
function mathModuleOneRouted(): AssessmentDeliveryBootstrap {
  const now = new Date("2026-09-23T09:00:00.000Z").toISOString();
  return examData([
    attemptRow("ma-rw-1", "rw-m1", "submitted", now, 4),
    attemptRow("ma-math-1", "math-m1", "not_started", now),
    attemptRow("ma-math-2", "math-m2-higher", "not_started", now, 3),
  ]);
}

function moduleState(moduleId: string, questionId: string) {
  return {
    phase: "module" as const,
    scheduleId: "schedule-1",
    candidateId: "candidate-1",
    assessmentId: "exam-1",
    sectionKey: "math",
    // The mock carries the authoritative id exactly like the production
    // runner state (SatWorkingState.moduleId); see findStateModule below.
    moduleId,
    moduleKey: moduleId,
    questionIds: [questionId],
    questionIndex: 0,
    responses: {
      [questionId]: {
        questionId,
        answer: "",
        markedForReview: false,
        eliminatedOptionIds: [],
        annotations: { version: 2, annotations: [], legacyQuestionNote: "" },
      },
    },
    responseRevisions: {},
    toolCapabilities: { calculator: false, referenceSheet: false },
    activeTool: null,
    activeTools: { calculator: false, referenceSheet: false },
    startedAt: "2026-09-23T09:00:00.000Z",
    endsAt: "2026-09-23T09:35:00.000Z",
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

interface SeedOptions {
  pendingModuleId?: string;
  handoffSeconds?: number | null;
  autoEntryRecoverable?: boolean;
  isStarting?: boolean;
}

/**
 * Test scaffolding that mirrors the production lookup direction
 * (useSatExamController: candidate.id === state.moduleId). Resolving by
 * moduleKey here would reintroduce the exact ambiguity the adaptive
 * runtime eliminated: two branches may share one business key.
 */
function findStateModule(data: AssessmentDeliveryBootstrap, moduleId: string) {
  return data.sections.flatMap((section) => section.modules).find((module) => module.id === moduleId) ?? null;
}

function findSection(data: AssessmentDeliveryBootstrap, moduleId: string) {
  return data.sections.find((section) => section.modules.some((module) => module.id === moduleId)) ?? null;
}

function seed(
  state: Record<string, unknown>,
  data: AssessmentDeliveryBootstrap,
  options: SeedOptions = {},
) {
  const commands = baseCommands();
  const moduleId = typeof state.moduleId === "string" ? state.moduleId : null;
  const stateModule = moduleId ? findStateModule(data, moduleId) : null;
  const stateModuleAttempt = stateModule
    ? data.attempt.moduleAttempts.find((attempt) => attempt.moduleId === stateModule.id)
    : undefined;
  const pendingModule = options.pendingModuleId
    ? data.sections.flatMap((section) => section.modules).find((module) => module.id === options.pendingModuleId) ?? null
    : null;
  controllerMock.current = {
    state,
    data,
    result: null,
    error: null,
    setError: vi.fn(),
    isSubmitting: false,
    isStarting: options.isStarting ?? false,
    pendingModule,
    pendingModuleWindow: null,
    pendingBreakSeconds: 0,
    pendingSectionWaitSeconds: 0,
    handoffSeconds: options.handoffSeconds ?? null,
    pendingStageReady: true,
    autoEntryRecoverable: options.autoEntryRecoverable ?? false,
    retryModuleEntry: vi.fn(),
    entryReason: "next-module-entry",
    entryAutoStartPending: true,
    effectiveTiming: data.timing,
    stateModule,
    stateModuleAttempt,
    stateSection: stateModule ? findSection(data, stateModule.id) : null,
    remainingSeconds: 1842,
    blocked: false,
    warning: null,
    answersRecorded: false,
    showAlmostUp: false,
    pendingTabSwitchWarning: null,
    acknowledgeTabSwitchWarning: vi.fn(),
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
    commands,
  };
  return commands;
}

function routeProps(attemptId = "attempt-1") {
  return {
    scheduleId: "schedule-1",
    attemptId,
    candidateId: "candidate-1",
    runtimeSnapshot: null,
    liveSocketConnected: false,
    attemptUpdateToken: 0,
    onExit: () => undefined,
  } as unknown as Record<string, never>;
}

function routeElement(attemptId = "attempt-1") {
  return <SatStudentSessionRoute {...(routeProps(attemptId) as never)} />;
}

/** Renders the live Math Module 1 frame, then returns the rerender handle. */
function renderLiveModule(data: AssessmentDeliveryBootstrap = mathModuleOneLive()) {
  seed(moduleState("math-m1", "math-m1-q1"), data);
  const view = render(routeElement());
  return { ...view, data };
}

describe("SatStudentSessionRoute module handoff", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    matchMediaMock();
  });

  it("keeps the same exam frame and shows one in-frame status", () => {
    const { rerender } = renderLiveModule();
    const shell = screen.getByTestId("sat-exam-shell");
    expect(screen.getByText("Math Module 1 marker")).toBeInTheDocument();

    seed(
      { ...moduleState("math-m1", "math-m1-q1"), phase: "directions" },
      mathModuleTwoRouted(),
      { pendingModuleId: "math-m2-higher", handoffSeconds: 754, isStarting: true },
    );
    rerender(routeElement());

    // The frame is the SAME DOM node: the shell, its tool hosts and its zoom
    // plane were reconciled, not remounted.
    expect(screen.getByTestId("sat-exam-shell")).toBe(shell);
    // The finished question is still on screen, frozen behind the status.
    expect(screen.getByText("Math Module 1 marker")).toBeInTheDocument();
    // No transition screen, no break surface.
    expect(screen.queryByTestId("sat-scheduled-break")).toBeNull();
    expect(screen.queryByText("We’re having trouble opening")).toBeNull();

    const hold = document.querySelector("[data-sat-transition-hold]");
    expect(hold).not.toBeNull();
    expect(hold).toHaveAttribute("inert");
    expect(hold).toHaveAttribute("aria-hidden", "true");
    expect(hold?.contains(shell)).toBe(true);

    // One live status, OUTSIDE the hidden frame, naming what is opening and the
    // section clock the student is still on.
    expect(screen.getByRole("heading", { name: "Opening Module 2…" })).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Opening Module 2.");
    expect(hold?.contains(status)).toBe(false);
    expect(document.querySelector("[data-sat-handoff-clock]")).toHaveTextContent("12:34");
  });

  it("escalates in frame while the entry retries, with the recovery action inline", () => {
    const { rerender } = renderLiveModule();
    const shell = screen.getByTestId("sat-exam-shell");

    seed(
      { ...moduleState("math-m1", "math-m1-q1"), phase: "directions" },
      mathModuleTwoRouted(),
      { pendingModuleId: "math-m2-higher", autoEntryRecoverable: true },
    );
    rerender(routeElement());

    expect(screen.getByRole("heading", { name: "Still opening Module 2…" })).toBeInTheDocument();
    expect(screen.getByTestId("sat-exam-shell")).toBe(shell);
    expect(screen.queryByTestId("sat-scheduled-break")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Still opening Module 2.");

    const retry = screen.getByRole("button", { name: "Retry now" });
    fireEvent.click(retry);
    const controller = controllerMock.current as { retryModuleEntry: () => void };
    expect(controller.retryModuleEntry).toHaveBeenCalledTimes(1);

    // No clock rather than a frozen or invented one when the frame has no
    // authority to quote a section clock.
    expect(document.querySelector("[data-sat-handoff-clock]")).toBeNull();
  });

  it("keeps the held frame inert to answers and shortcuts", () => {
    const { rerender } = renderLiveModule();
    const commands = seed(
      { ...moduleState("math-m1", "math-m1-q1"), phase: "directions" },
      mathModuleTwoRouted(),
      { pendingModuleId: "math-m2-higher" },
    );
    rerender(routeElement());

    const hold = document.querySelector("[data-sat-transition-hold]");
    const radio = hold?.querySelector('input[type="radio"]');
    expect(radio).not.toBeNull();
    fireEvent.click(radio as Element);
    expect(radio).not.toBeChecked();

    fireEvent.keyDown(document, { key: "x", ctrlKey: true, altKey: true });
    fireEvent.keyDown(document, { key: "c", ctrlKey: true, altKey: true });
    expect(commands.nextQuestion).not.toHaveBeenCalled();
    expect(commands.toggleCalculator).not.toHaveBeenCalled();
  });

  it("hands the same surface over to the next module", () => {
    const { rerender } = renderLiveModule();
    const shell = screen.getByTestId("sat-exam-shell");
    const stageKey = document.querySelector("[data-sat-stage]")?.getAttribute("data-sat-stage-key");

    seed(
      { ...moduleState("math-m1", "math-m1-q1"), phase: "directions" },
      mathModuleTwoRouted(),
      { pendingModuleId: "math-m2-higher" },
    );
    rerender(routeElement());
    expect(document.querySelector("[data-sat-stage-key]")).toHaveAttribute(
      "data-sat-stage-key",
      stageKey ?? "",
    );

    // Module 2 opens: the SAME frame renders its content, and the handoff
    // surface is gone.
    seed(moduleState("math-m2-higher", "math-m2-higher-q1"), mathModuleTwoRouted());
    rerender(routeElement());

    expect(screen.getByTestId("sat-exam-shell")).toBe(shell);
    expect(screen.getByText("Math Module 2 marker")).toBeInTheDocument();
    expect(document.querySelector("[data-sat-transition-hold]")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Opening Module 2/ })).toBeNull();
    expect(document.querySelectorAll('[data-sat-stage="exam"]')).toHaveLength(1);
  });

  it("still shows the scheduled break when the pending module really opens a new section", () => {
    const { rerender } = renderLiveModule();
    const shell = screen.getByTestId("sat-exam-shell");

    seed({ ...moduleState("math-m1", "math-m1-q1"), phase: "directions" }, mathModuleOneRouted(), {
      pendingModuleId: "math-m1",
      handoffSeconds: 240,
    });
    rerender(routeElement());

    expect(screen.getByTestId("sat-scheduled-break")).toBeInTheDocument();
    expect(document.querySelector("[data-sat-handoff]")).toBeNull();
    // The exam frame departs through the stage cross-fade.
    return waitFor(() => expect(screen.queryByTestId("sat-exam-shell")).toBeNull()).then(() => {
      expect(shell).not.toBeInTheDocument();
    });
  });

  it("restores an already-started later section instead of showing its old break", () => {
    const { rerender } = renderLiveModule();
    seed(moduleState("math-m1", "math-m1-q1"), mathModuleOneLive(), {
      pendingModuleId: "math-m1",
    });
    rerender(routeElement());

    expect(screen.getByTestId("sat-exam-shell")).toBeInTheDocument();
    expect(screen.getByText("Math Module 1 marker")).toBeInTheDocument();
    expect(screen.queryByTestId("sat-scheduled-break")).toBeNull();
  });

  it("replaces the stage at once when the route carries a different attempt", () => {
    const { rerender } = renderLiveModule();

    seed(moduleState("math-m1", "math-m1-q1"), mathModuleOneLive());
    rerender(routeElement("attempt-2"));

    // No layer of the previous attempt is left fading behind the new one.
    expect(screen.getAllByTestId("sat-exam-shell")).toHaveLength(1);
    expect(document.querySelectorAll("[data-sat-stage-exiting]")).toHaveLength(0);
    expect(document.querySelectorAll('[data-sat-stage="exam"]')).toHaveLength(1);
  });
});
