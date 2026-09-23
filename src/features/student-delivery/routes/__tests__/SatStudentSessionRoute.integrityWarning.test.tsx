import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { SAT_COPY } from "../../domain/satCopy";
import { SatStudentSessionRoute } from "../SatStudentSessionRoute";

/**
 * Executable acceptance specification (ATDD) — SAT delivery wiring.
 *
 * Detection, persistence and policy all have their own tests; what is untested
 * without this file is the wiring in between: that the controller's pending
 * excursion reaches the SAT-styled hold in the answering phases, that
 * acknowledging resumes the exam without running any exam command, and that a
 * hold can never be raised outside the exam viewport.
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

function moduleData(): AssessmentDeliveryBootstrap {
  const now = new Date().toISOString();
  const sections = [
    {
      id: "sec-math",
      sectionKey: "math",
      title: "Math",
      displayOrder: 0,
      durationSeconds: 2100,
      breakAfterSeconds: 0,
      instructions: para("Math section directions"),
      modules: [
        {
          id: "math-m1",
          moduleKey: "math-m1",
          title: "Math Module",
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
              prompt: para("Integrity hold marker question"),
              answer: {
                kind: "single_choice" as const,
                options: ["A", "B"].map((id) => ({ id, content: para(`Choice ${id}`) })),
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
      moduleAttempts: [
        {
          id: "ma-1",
          moduleId: "math-m1",
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
      ] as unknown as AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"],
      responses: [],
    },
    result: null,
  } as AssessmentDeliveryBootstrap;
}

function moduleState() {
  const now = new Date().toISOString();
  return {
    phase: "module",
    scheduleId: "schedule-1",
    candidateId: "candidate-1",
    assessmentId: "exam-1",
    sectionKey: "math",
    moduleKey: "math-m1",
    questionIds: ["q1"],
    questionIndex: 0,
    responses: {
      q1: {
        questionId: "q1",
        answer: "A",
        markedForReview: false,
        eliminatedOptionIds: [],
        annotations: { version: 2, annotations: [], legacyQuestionNote: "" },
      },
    },
    responseRevisions: {},
    toolCapabilities: { calculator: false, referenceSheet: false },
    activeTool: null,
    activeTools: { calculator: false, referenceSheet: false },
    startedAt: now,
    endsAt: now,
  };
}

function directionsState() {
  return {
    ...moduleState(),
    phase: "directions",
    sectionKey: null,
    moduleKey: null,
    questionIds: [],
    responses: {},
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

function seed(
  state: Record<string, unknown>,
  data: AssessmentDeliveryBootstrap,
  pendingTabSwitchWarning: unknown,
) {
  const resolved = (data.sections?.length ?? 0) > 0;
  const module = resolved
    ? (data.sections.flatMap((section) => section.modules).find((entry) => entry.id === "math-m1") ?? null)
    : null;
  controllerMock.current = {
    state,
    data,
    result: null,
    error: null,
    setError: vi.fn(),
    isSubmitting: false,
    isStarting: false,
    autoEntryRecoverable: false,
    entryAutoStartPending: false,
    pendingModule: module,
    pendingBreakSeconds: 0,
    pendingSectionWaitSeconds: 0,
    pendingStageReady: true,
    effectiveTiming: data.timing,
    stateModule: module,
    stateModuleAttempt: resolved ? data.attempt.moduleAttempts[0] : undefined,
    stateSection: resolved ? data.sections[0] : null,
    remainingSeconds: 2100,
    blocked: false,
    warning: null,
    answersRecorded: false,
    showAlmostUp: false,
    pendingTabSwitchWarning,
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
    commands: baseCommands(),
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

async function renderRoute(
  state: Record<string, unknown>,
  data: AssessmentDeliveryBootstrap,
  pendingTabSwitchWarning: unknown,
) {
  const { default: ReactModule } = (await import("react")) as unknown as {
    default: typeof React;
  };
  seed(state, data, pendingTabSwitchWarning);
  return render(ReactModule.createElement(SatStudentSessionRoute, routeProps() as never));
}

const EXCURSION = {
  violationType: "TAB_SWITCH",
  source: "page_visibility",
  hiddenAt: "2026-01-01T00:00:10.000Z",
  returnedAt: "2026-01-01T00:00:40.000Z",
  hiddenDurationMs: 30_000,
};

describe("SatStudentSessionRoute exam-screen integrity hold", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    matchMediaMock();
  });

  it("AC-SAT-07: does not hold the student while no excursion is pending", async () => {
    await renderRoute(moduleState(), moduleData(), null);

    expect(screen.getByText("Integrity hold marker question")).toBeInTheDocument();
    expect(screen.queryByTestId("sat-integrity-warning")).not.toBeInTheDocument();
  });

  it("AC-SAT-08: holds the module with the shared copy and resumes only on continue", async () => {
    await renderRoute(moduleState(), moduleData(), EXCURSION);

    const hold = screen.getByTestId("sat-integrity-warning");
    expect(hold).toHaveTextContent(SAT_COPY.integrity.visibilityTitle);
    expect(hold).toHaveTextContent(SAT_COPY.integrity.visibilityBody);
    // The exam stays mounted behind the hold: the question, its answer and the
    // module attempt are untouched by rendering it.
    expect(screen.getByText("Integrity hold marker question")).toBeInTheDocument();

    const controller = controllerMock.current as {
      acknowledgeTabSwitchWarning: () => void;
      commands: Record<string, ReturnType<typeof vi.fn>>;
    };
    fireEvent.click(
      screen.getByRole("button", { name: SAT_COPY.integrity.visibilityContinue }),
    );

    expect(controller.acknowledgeTabSwitchWarning).toHaveBeenCalledTimes(1);
    // Acknowledging runs no exam command: no submit, no navigation, no tool
    // change, no module start.
    for (const command of Object.values(controller.commands)) {
      expect(command).not.toHaveBeenCalled();
    }
  });

  it("AC-SAT-09: never raises the hold outside the answering phases", async () => {
    // A pending hold from the finished module must not cover the directions
    // screen: it reappears when answering resumes.
    await renderRoute(directionsState(), moduleData(), EXCURSION);

    expect(screen.queryByTestId("sat-integrity-warning")).not.toBeInTheDocument();
  });
});
