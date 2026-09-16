import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { SatStudentSessionRoute } from "../SatStudentSessionRoute";

// Route-level between-sections coverage. The break screen and the controller's
// break arithmetic each have unit tests; what was untested is the wiring in
// between — that the server's authored window reaches `SatBreakScreen` with the
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
  const sections = [
    {
      id: "sec-math",
      sectionKey: "math",
      title: "Math",
      displayOrder: 1,
      durationSeconds: 2100,
      breakAfterSeconds: 0,
      instructions: para("Math section directions"),
      modules: [
        {
          id: "math-m1",
          moduleKey: "math-m1",
          title: "Math Module 1",
          displayOrder: 0,
          durationSeconds: 2100,
          targetQuestionCount: 1,
          adaptiveRole: "base",
          instructions: para("Math module directions"),
          toolPolicy: { calculator: false, reference_sheet: false },
          questions: [
            {
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
            },
          ],
        },
      ],
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
        },
      ] as unknown as AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"],
      responses: [],
    },
    result: null,
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
  /** "break" renders the live break branch instead of the directions branch. */
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
  const module = data ? (data.sections[0]?.modules[0] ?? null) : null;
  controllerMock.current = {
    state,
    data,
    result: null,
    error: null,
    setError: () => undefined,
    isSubmitting: false,
    isStarting: entry.isStarting ?? false,
    autoEntryRecoverable: entry.autoEntryRecoverable ?? false,
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

    expect(screen.getByText("On break")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("10:40");
    expect(screen.getByRole("heading", { name: "Math is next" })).toBeInTheDocument();
    expect(screen.queryByText("Waiting for the break to start")).not.toBeInTheDocument();
  });

  it("renders the early-finish wait instead of a break until the section clock runs out", () => {
    renderRoute(mathData(), { breakSeconds: 0, waitSeconds: 300 });

    expect(screen.getByText("Waiting for the break to start")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("5:00");
    expect(screen.queryByText("On break")).not.toBeInTheDocument();
  });

  // Phase 4 (kill the silent 0:00): the countdown reaches zero while the server
  // is still advancing the section. The surface must name the entry progress
  // instead of freezing at 0:00 with no explanation and no path forward.
  it("explains the run-out break with the entry progress, not a frozen 0:00", () => {
    renderRoute(
      mathData(),
      { breakSeconds: 0, waitSeconds: 0 },
      { phase: "break", autoEntryRecoverable: true },
    );

    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
    expect(screen.getByText("Still opening your next section")).toBeInTheDocument();
    expect(screen.getByText(/Keep this screen open/)).toBeInTheDocument();
    // The recovery path stays named. No button: entry is automatic, and only
    // the preview route passes an advance handler.
    expect(screen.getByText(/wait 30 seconds then reload/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("On break")).not.toBeInTheDocument();
  });

  it("announces the entry attempt while it is still in flight", () => {
    renderRoute(mathData(), { breakSeconds: 0, waitSeconds: 0 }, { phase: "break", isStarting: true });

    expect(screen.getByText("Starting your next section")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("0:00");
  });
});
