import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import type { SatRunnerState } from "../../application/satRunnerReducer";
import { SatStudentSessionRoute } from "../SatStudentSessionRoute";

/**
 * Phase 03 prewarm-gating matrix (C1-C12).
 *
 * Real SatCalculatorPanel / DesmosCalculator / SatFloatingTool (no tool
 * mocks): bare branches must render ZERO hidden Desmos iframes, eligible
 * branches must keep the warm tree. Controller is the only mock.
 */

const controllerMock = vi.hoisted(() => ({
  current: null as unknown,
}));

vi.mock("../../hooks/useSatExamController", () => ({
  useSatExamController: () => controllerMock.current,
}));

const SCI_TITLE = "Desmos scientific calculator, College Board testing version";
const GRAPH_TITLE = "Desmos graphing calculator, College Board testing version";

function matchMediaMock(matches: boolean) {
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
        }) satisfies MediaQueryList
    )
  );
}

interface FixtureModule {
  id: string;
  moduleKey?: string;
  toolPolicy: Record<string, unknown>;
  questions?: { examQuestionId: string }[];
  adaptiveRole?: string;
}

const content = (text: string) => ({
  version: 1 as const,
  nodes: [{ type: "paragraph" as const, id: `p-${text}`, text }],
});

function bootstrapFixture(opts: {
  rwModule: FixtureModule;
  mathModule: FixtureModule;
  activeModuleId?: string | null;
}): AssessmentDeliveryBootstrap {
  const now = new Date().toISOString();
  const sections = [
    {
      id: "sec-rw",
      sectionKey: "reading-writing",
      title: "Reading and Writing",
      displayOrder: 0,
      durationSeconds: 1920,
      breakAfterSeconds: 600,
      instructions: content("RW section directions"),
      modules: [
        {
          id: opts.rwModule.id,
          moduleKey: opts.rwModule.moduleKey,
          title: "RW Module",
          displayOrder: 0,
          durationSeconds: 1920,
          targetQuestionCount: 1,
          adaptiveRole: opts.rwModule.adaptiveRole ?? "base",
          instructions: content("RW module directions"),
          toolPolicy: opts.rwModule.toolPolicy,
          questions: (opts.rwModule.questions ?? [{ examQuestionId: "q1" }]).map((q, i) => ({
            examQuestionId: q.examQuestionId,
            questionId: q.examQuestionId,
            displayOrder: i,
            isPretest: false,
            questionType: "single_choice" as const,
            stimulus: content("Passage"),
            prompt: content("Prompt"),
            answer: {
              kind: "single_choice" as const,
              options: ["A", "B", "C", "D"].map((id) => ({ id, content: content(`Choice ${id}`) })),
            },
            metadata: {
              sectionKey: "reading-writing",
              domain: null,
              skill: null,
              difficulty: "medium" as const,
              tags: [],
            },
            accessibility: { longDescription: null },
          })),
        },
      ],
    },
    {
      id: "sec-math",
      sectionKey: "math",
      title: "Math",
      displayOrder: 1,
      durationSeconds: 2100,
      breakAfterSeconds: 0,
      instructions: content("Math section directions"),
      modules: [
        {
          id: opts.mathModule.id,
          moduleKey: opts.mathModule.moduleKey,
          title: "Math Module",
          displayOrder: 0,
          durationSeconds: 2100,
          targetQuestionCount: 1,
          adaptiveRole: opts.mathModule.adaptiveRole ?? "base",
          instructions: content("Math module directions"),
          toolPolicy: opts.mathModule.toolPolicy,
          questions: (opts.mathModule.questions ?? [{ examQuestionId: "q1" }]).map((q, i) => ({
            examQuestionId: q.examQuestionId,
            questionId: q.examQuestionId,
            displayOrder: i,
            isPretest: false,
            questionType: "single_choice" as const,
            stimulus: content("Passage"),
            prompt: content("Prompt"),
            answer: {
              kind: "single_choice" as const,
              options: ["A", "B", "C", "D"].map((id) => ({ id, content: content(`Choice ${id}`) })),
            },
            metadata: {
              sectionKey: "math",
              domain: null,
              skill: null,
              difficulty: "medium" as const,
              tags: [],
            },
            accessibility: { longDescription: null },
          })),
        },
      ],
    },
  ];
  const moduleAttempts =
    opts.activeModuleId == null
      ? []
      : [
          {
            id: `ma-${opts.activeModuleId}`,
            moduleId: opts.activeModuleId,
            state: "active",
            allocatedSeconds: 2100,
            availableAt: now,
            startedAt: now,
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
          },
        ];
  return {
    scheduleId: "schedule-1",
    examId: "exam-1",
    providerKey: "sat",
    versionId: "v1",
    serverNow: now,
    candidateName: "Ada Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "legacy_attempt",
      timingModel: "legacy_section_v1",
      stageKey: null,
      stageStatus: null,
      serverNow: now,
      deadlineAt: null,
      remainingSeconds: 2100,
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: sections as unknown as AssessmentDeliveryBootstrap["sections"],
    attempt: {
      id: "attempt-1",
      moduleAttempts: moduleAttempts as unknown as AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"],
      responses: [],
    },
    result: null,
  };
}

function moduleById(data: AssessmentDeliveryBootstrap, id: string) {
  return data.sections.flatMap((s) => s.modules).find((m) => m.id === id)!;
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

function basePersistence() {
  return {
    pendingCount: 0,
    visibleDrafts: {},
    failure: null,
    failureKind: null,
    failureCount: 0,
    isTakingOver: false,
    flush: vi.fn().mockResolvedValue(undefined),
    retryFailed: vi.fn(),
    takeOverLease: vi.fn().mockResolvedValue(undefined),
    save: vi.fn(),
    submit: vi.fn(),
  };
}

function setup(opts: {
  phase: SatRunnerState["phase"];
  questionIds?: string[];
  questionIndex?: number;
  toolCapabilities?: { calculator: boolean; referenceSheet: boolean };
  activeTools?: { calculator: boolean; referenceSheet: boolean };
  moduleKey?: string;
  sectionKey?: "reading-writing" | "math";
  stateModuleId: string | null;
  pendingModuleId: string | null;
  data: AssessmentDeliveryBootstrap;
  examOverrides?: Record<string, unknown>;
  routeError?: string | null;
  answersRecorded?: boolean;
}) {
  const state = {
    phase: opts.phase,
    scheduleId: "schedule-1",
    candidateId: "candidate-1",
    assessmentId: "exam-1",
    ...(opts.phase === "module" || opts.phase === "review"
      ? {
          sectionKey: opts.sectionKey ?? "math",
          moduleKey: opts.moduleKey ?? opts.stateModuleId ?? "math-m1",
          questionIds: opts.questionIds ?? ["q1"],
          questionIndex: opts.questionIndex ?? 0,
          responses: {},
          responseRevisions: {},
          toolCapabilities: opts.toolCapabilities ?? { calculator: true, referenceSheet: false },
          activeTool: null,
          activeTools: opts.activeTools ?? { calculator: false, referenceSheet: false },
          startedAt: new Date().toISOString(),
          endsAt: new Date().toISOString(),
        }
      : opts.phase === "break"
        ? { nextSectionKey: "math" as const, resumeAt: new Date().toISOString() }
        : {}),
  };
  const data = opts.data;
  const stateModule =
    opts.stateModuleId != null ? moduleById(data, opts.stateModuleId) : null;
  const pendingModule =
    opts.pendingModuleId != null ? moduleById(data, opts.pendingModuleId) : null;
  const stateModuleAttempt =
    opts.stateModuleId != null
      ? (data.attempt.moduleAttempts.find((a) => a.moduleId === opts.stateModuleId) ?? undefined)
      : undefined;
  const stateSection =
    opts.stateModuleId != null
      ? (data.sections.find((s) => s.modules.some((m) => m.id === opts.stateModuleId)) ?? null)
      : null;
  controllerMock.current = {
    state,
    data,
    result: null,
    error: opts.routeError ?? null,
    setError: vi.fn(),
    isSubmitting: false,
    isStarting: false,
    pendingModule: pendingModule ?? null,
    pendingBreakSeconds: 0,
    pendingSectionWaitSeconds: 0,
    pendingStageReady: true,
    effectiveTiming: null,
    stateModule: stateModule ?? null,
    stateModuleAttempt: stateModuleAttempt ?? undefined,
    stateSection: stateSection ?? null,
    remainingSeconds: 2100,
    blocked: false,
    warning: null,
    answersRecorded: opts.answersRecorded ?? false,
    showAlmostUp: false,
    persistence: basePersistence(),
    commands: baseCommands(),
    ...(opts.examOverrides ?? {}),
  };
  const routeElement = (
    <SatStudentSessionRoute
      scheduleId="schedule-1"
      attemptId="attempt-1"
      candidateId="candidate-1"
      runtimeSnapshot={null}
      liveSocketConnected={false}
      attemptUpdateToken={0}
      onExit={() => undefined}
    />
  );
  const renderResult = render(routeElement);
  return { renderResult, routeElement };
}

const RW_NO_CALC = { id: "rw-m1", toolPolicy: {} };
const MATH_CALC = { id: "math-m1", toolPolicy: { calculator: true } };

function expectBare(container: HTMLElement) {
  expect(container.querySelectorAll('iframe[data-desmos-mode]')).toHaveLength(0);
  expect(container.querySelector('[data-sat-trusted-tool="desmos"]')).toBeNull();
}

describe("SatStudentSessionRoute prewarm gating", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
    matchMediaMock(false);
  });

  it("C1 submitting, no error (B7b): single live region, no host", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: "math-m1" });
    setup({ phase: "submitting", stateModuleId: null, pendingModuleId: null, data });
    // Single live region owns the finalizing screen.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByTitle(/Desmos/)).toBeNull();
    expectBare(document.body);
  });

  it("C2 submitting + error (B7a): alert, zero status, zero iframes", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: "math-m1" });
    setup({
      phase: "submitting",
      stateModuleId: null,
      pendingModuleId: null,
      data,
      routeError: "finalize failed",
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTitle(/Desmos/)).toBeNull();
    expectBare(document.body);
  });

  it("C3 first-module entry stays on the pre-start surface", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: null });
    setup({ phase: "directions", stateModuleId: null, pendingModuleId: "rw-m1", data });
    expect(screen.getByRole("heading", { name: "Your exam is ready" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Begin module/i })).toBeNull();
    expect(screen.queryByTitle(/Desmos/)).toBeNull();
    expectBare(document.body);
  });

  it("C4 between-section entry uses the break surface without a hidden calculator tree", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: null });
    setup({ phase: "directions", stateModuleId: null, pendingModuleId: "math-m1", data });
    expect(screen.getByTestId("sat-scheduled-break")).toBeInTheDocument();
    expect(screen.queryByTitle(SCI_TITLE)).toBeNull();
    expect(screen.queryByTitle(GRAPH_TITLE)).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Calculator" })).toBeNull();
    expectBare(document.body);
  });

  it("C5 module, calculator closed (B12): hidden tree, open reveals dialog", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: "math-m1" });
    setup({
      phase: "module",
      stateModuleId: "math-m1",
      pendingModuleId: null,
      data,
    });
    // keepAlive closed tree: both iframes mounted hidden, no dialog role.
    expect(screen.getByTitle(SCI_TITLE)).toBeInTheDocument();
    expect(screen.getByTitle(GRAPH_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Calculator" })).toBeNull();
    expect(document.body.querySelector("[data-sat-tool-window=\"Calculator\"]")).not.toBeNull();
    // Open via activeTools: a second route instance with the tool open
    // renders the visible dialog with both warm modes. Node-level identity
    // (SAME iframe closed -> open) is covered by SatCalculatorPanel.test.tsx.
    const mocked = controllerMock.current as unknown as {
      state: Record<string, unknown>;
    };
    controllerMock.current = {
      ...(controllerMock.current as unknown as Record<string, unknown>),
      state: {
        ...mocked.state,
        activeTools: { calculator: true, referenceSheet: false },
      },
    } as unknown;
    cleanup();
    matchMediaMock(false);
    setup({
      phase: "module",
      stateModuleId: "math-m1",
      pendingModuleId: null,
      data,
      activeTools: { calculator: true, referenceSheet: false },
    });
    expect(screen.getByRole("dialog", { name: "Calculator" })).toBeInTheDocument();
    expect(screen.getByTitle(SCI_TITLE)).toBeInTheDocument();
    expect(screen.getByTitle(GRAPH_TITLE)).toBeInTheDocument();
  });

  it("C6 B7b compact (639px): compact hidden tree also gone", () => {
    matchMediaMock(true);
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: "math-m1" });
    setup({ phase: "submitting", stateModuleId: null, pendingModuleId: null, data });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expectBare(document.body);
  });

  it("C7 break (B6): break surface has no hidden calculator host", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: "math-m1" });
    setup({ phase: "break", stateModuleId: null, pendingModuleId: null, data });
    // Same break surface until the next active module replaces it — never Opening.
    expect(screen.getByTestId("sat-scheduled-break")).toBeInTheDocument();
    expect(screen.queryByText(/Opening Math/)).toBeNull();
    expect(screen.queryByTitle(/Desmos/)).toBeNull();
    expectBare(document.body);
  });

  it("C8 refreshing-module (B9): single status, zero iframes", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: null });
    setup({
      phase: "module",
      stateModuleId: null,
      pendingModuleId: null,
      data,
      sectionKey: "math",
      toolCapabilities: { calculator: true, referenceSheet: false },
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("Refreshing SAT module…")).toBeInTheDocument();
    expectBare(document.body);
  });

  it("C9 review math (B10): review content + hidden warm tree", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: "math-m1" });
    setup({ phase: "review", stateModuleId: "math-m1", pendingModuleId: null, data });
    expect(screen.getByRole("heading", { name: "Review your answers" })).toBeInTheDocument();
    expect(screen.getByTitle(SCI_TITLE)).toBeInTheDocument();
    expect(screen.getByTitle(GRAPH_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Calculator" })).toBeNull();
  });

  it("C10 question-unavailable (B11): alert, zero iframes", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: "math-m1" });
    setup({
      phase: "module",
      stateModuleId: "math-m1",
      pendingModuleId: null,
      data,
      questionIds: ["missing-q"],
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expectBare(document.body);
  });

  it("C11 state-unavailable (B8): error surface, zero iframes", () => {
    const data = bootstrapFixture({ rwModule: RW_NO_CALC, mathModule: MATH_CALC, activeModuleId: null });
    setup({ phase: "loading", stateModuleId: null, pendingModuleId: null, data });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("SAT state unavailable")).toBeInTheDocument();
    expectBare(document.body);
  });

  it("C12 module R+W no calc (B12): shell present, zero iframes (fallback-removal proof)", () => {
    const rwWithQ = { id: "rw-m1", toolPolicy: {} };
    const data = bootstrapFixture({ rwModule: rwWithQ, mathModule: MATH_CALC, activeModuleId: "rw-m1" });
    setup({
      phase: "module",
      stateModuleId: "rw-m1",
      pendingModuleId: null,
      data,
      sectionKey: "reading-writing",
      moduleKey: "rw-m1",
      toolCapabilities: { calculator: false, referenceSheet: false },
    });
    // Shell renders the R+W question; the math fallback must NOT prewarm.
    expect(screen.queryByTitle(/Desmos/)).toBeNull();
    expectBare(document.body);
  });
});
