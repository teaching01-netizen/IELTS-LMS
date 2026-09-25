import { cleanup, fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import {
  satEliminatorArmsKey,
  saveSatEliminatorArms,
} from "../../infrastructure/satEliminatorArmStore";
import { SatStudentSessionRoute } from "../SatStudentSessionRoute";

/**
 * The eliminator is QUESTION-SCOPED.
 *
 * Arming it used to be one route-wide boolean that every navigation reset, so a
 * student who armed the cut control, moved on, and came back found it closed
 * again — even though the choices they crossed out had survived (those are
 * data, in `eliminatedOptionIds`). These tests pin the split: the crossing-out
 * survives navigation because it is persisted, and the open/closed arm survives
 * navigation because it is keyed per question. Nothing about it is server state.
 */

const controllerMock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

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
  const question = (examQuestionId: string, prompt: string) => ({
    examQuestionId,
    questionId: examQuestionId,
    displayOrder: examQuestionId === "q1" ? 0 : 1,
    isPretest: false,
    questionType: "single_choice" as const,
    stimulus: para("Passage"),
    prompt: para(prompt),
    answer: {
      kind: "single_choice" as const,
      options: [
        { id: "a", content: para(`Choice a of ${examQuestionId}`) },
        { id: "b", content: para(`Choice b of ${examQuestionId}`) },
      ],
    },
    metadata: {
      sectionKey: "math",
      domain: null,
      skill: null,
      difficulty: "medium" as const,
      tags: [],
    },
    accessibility: { longDescription: null },
  });
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
          targetQuestionCount: 2,
          adaptiveRole: "base",
          instructions: para("Math module directions"),
          toolPolicy: { calculator: false, reference_sheet: false },
          questions: [question("q1", "First marker question"), question("q2", "Second marker question")],
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

function responseFor(questionId: string, eliminatedOptionIds: string[] = [], answer = "") {
  return {
    questionId,
    answer,
    markedForReview: false,
    eliminatedOptionIds,
    annotations: { version: 2, annotations: [], legacyQuestionNote: "" },
  };
}

function moduleState(args: {
  questionIndex: number;
  responses?: Record<string, unknown>;
  moduleAttemptId?: string;
}) {
  const now = new Date().toISOString();
  return {
    phase: "module",
    scheduleId: "schedule-1",
    candidateId: "candidate-1",
    assessmentId: "exam-1",
    sectionKey: "math",
    moduleKey: "math-m1",
    questionIds: ["q1", "q2"],
    questionIndex: args.questionIndex,
    responses: args.responses ?? { q1: responseFor("q1"), q2: responseFor("q2") },
    responseRevisions: {},
    toolCapabilities: { calculator: false, referenceSheet: false },
    activeTool: null,
    activeTools: { calculator: false, referenceSheet: false },
    startedAt: now,
    endsAt: now,
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

function routeProps(attemptId = "attempt-1") {
  return {
    scheduleId: "schedule-1",
    attemptId,
    candidateId: "candidate-1",
    runtimeSnapshot: null,
    liveSocketConnected: false,
    attemptUpdateToken: 0,
    onExit: () => undefined,
  } as unknown as never;
}

let moduleAttemptId = "ma-1";

function seed(state: Record<string, unknown>) {
  const data = moduleData();
  const module = data.sections.flatMap((section) => section.modules).find((entry) => entry.id === "math-m1")!;
  const attempt = data.attempt.moduleAttempts[0]!;
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
    stateModuleAttempt: { ...attempt, id: moduleAttemptId },
    stateSection: data.sections[0],
    remainingSeconds: 2100,
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
    commands: baseCommands(),
  };
}

/** Render at a question, then drive navigation the way the controller does: state. */
function renderAt(questionIndex: number, responses?: Record<string, unknown>) {
  seed(moduleState({ questionIndex, ...(responses ? { responses } : {}) }));
  return render(createElement(SatStudentSessionRoute, routeProps()));
}

function goToQuestion(view: RenderResult, questionIndex: number, responses?: Record<string, unknown>) {
  seed(moduleState({ questionIndex, ...(responses ? { responses } : {}) }));
  view.rerender(createElement(SatStudentSessionRoute, routeProps()));
}

const eliminatorToggle = () =>
  screen.getByRole("button", { name: /Turn (on|off) cross-out mode/ });

const commands = () =>
  (controllerMock.current as { commands: Record<string, ReturnType<typeof vi.fn>> }).commands;

describe("SatStudentSessionRoute question-scoped eliminator", () => {
  beforeEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
    moduleAttemptId = "ma-1";
    matchMediaMock();
  });

  it("keeps the eliminator open per question across navigation", () => {
    const view = renderAt(0);

    expect(eliminatorToggle()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(eliminatorToggle());
    expect(screen.getByRole("button", { name: "Turn off cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Q2 starts closed — the arm is not global.
    goToQuestion(view, 1);
    expect(screen.getByRole("button", { name: "Turn on cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on cross-out mode" }));
    expect(screen.getByRole("button", { name: "Turn off cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Back to Q1: still armed, and the two states stayed independent.
    goToQuestion(view, 0);
    expect(screen.getByRole("button", { name: "Turn off cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    goToQuestion(view, 1);
    expect(screen.getByRole("button", { name: "Turn off cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("closes only the question the student disarms", () => {
    const view = renderAt(0);
    fireEvent.click(eliminatorToggle());
    goToQuestion(view, 1);
    fireEvent.click(eliminatorToggle());

    // Disarm Q2, then confirm Q1 kept its own arm.
    fireEvent.click(screen.getByRole("button", { name: "Turn off cross-out mode" }));
    expect(screen.getByRole("button", { name: "Turn on cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    goToQuestion(view, 0);
    expect(screen.getByRole("button", { name: "Turn off cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("crosses a choice out through the response command, never as an answer", () => {
    renderAt(0);
    expect(commands().toggleEliminatedOption).not.toHaveBeenCalled();

    fireEvent.click(eliminatorToggle());
    // The control is named by the choice's LETTER; the option id it reports is
    // the payload's own id.
    fireEvent.click(screen.getByRole("button", { name: "Eliminate option B" }));

    expect(commands().toggleEliminatedOption).toHaveBeenCalledWith("q1", "b");
    // Crossing out is its own action: it never answers the question.
    expect(commands().setAnswer).not.toHaveBeenCalled();
  });

  it("keeps a crossed-out choice and its Undo across navigation, and Undo restores without answering", () => {
    const view = renderAt(0);
    const eliminated = { q1: responseFor("q1", ["b"]), q2: responseFor("q2") };

    // Elimination mode is off here on purpose: the crossed-out choice stays
    // recoverable because the state lives in the response, not in the mode.
    goToQuestion(view, 1, eliminated);
    goToQuestion(view, 0, eliminated);

    const undo = screen.getByRole("button", { name: "Undo option B" });
    expect(undo).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: /Option B/ })).toHaveAccessibleDescription(/eliminated/i);

    fireEvent.click(undo);
    expect(commands().toggleEliminatedOption).toHaveBeenCalledWith("q1", "b");
    expect(commands().setAnswer).not.toHaveBeenCalled();
  });

  it("regression: selecting an answer still saves it normally", () => {
    renderAt(0);
    fireEvent.click(screen.getByText("Choice a of q1"));
    expect(commands().setAnswer).toHaveBeenCalledWith("q1", "a");
    expect(commands().toggleEliminatedOption).not.toHaveBeenCalled();
  });

  it("regression: the selected answer offers no cut or Undo control", () => {
    renderAt(0, { q1: responseFor("q1", [], "a"), q2: responseFor("q2") });
    fireEvent.click(eliminatorToggle());

    expect(screen.queryByRole("button", { name: "Eliminate option A" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo option A" })).toBeNull();
    expect(screen.getByRole("button", { name: "Eliminate option B" })).toBeInTheDocument();
  });

  it("remembers the armed question through a reload of the same attempt", () => {
    const first = renderAt(0);
    fireEvent.click(eliminatorToggle());
    // Armed means armed for the attempt, on this device.
    expect(
      window.localStorage.getItem(satEliminatorArmsKey("schedule-1", "attempt-1"))
    ).toContain("ma-1:q1");
    first.unmount();

    // A reload is a fresh mount of the same attempt: the exam comes back with
    // the question the student left armed still armed.
    seed(moduleState({ questionIndex: 0 }));
    render(createElement(SatStudentSessionRoute, routeProps()));
    expect(screen.getByRole("button", { name: "Turn off cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Disarming is remembered too — no stale record to reopen on the next load.
    fireEvent.click(eliminatorToggle());
    expect(
      window.localStorage.getItem(satEliminatorArmsKey("schedule-1", "attempt-1"))
    ).toBeNull();
  });

  it("shows each attempt its own remembered arms", () => {
    const view = renderAt(0);
    fireEvent.click(eliminatorToggle());
    expect(eliminatorToggle()).toHaveAttribute("aria-pressed", "true");

    // The next attempt was armed on a different module attempt: it opens with
    // ITS record, not the one the previous attempt left on this device.
    saveSatEliminatorArms("schedule-1", "attempt-2", new Set(["ma-2:q1"]));
    moduleAttemptId = "ma-2";
    seed(moduleState({ questionIndex: 0 }));
    view.rerender(createElement(SatStudentSessionRoute, routeProps("attempt-2")));
    expect(screen.getByRole("button", { name: "Turn off cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // And an attempt with nothing remembered opens closed.
    seed(moduleState({ questionIndex: 0 }));
    view.rerender(createElement(SatStudentSessionRoute, routeProps("attempt-3")));
    expect(screen.getByRole("button", { name: "Turn on cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("does not leak an arm from a previous attempt or module attempt", () => {
    const view = renderAt(0);
    fireEvent.click(eliminatorToggle());
    expect(eliminatorToggle()).toHaveAttribute("aria-pressed", "true");

    // Same question id, different module attempt: the arm is not inherited.
    moduleAttemptId = "ma-2";
    goToQuestion(view, 0);
    expect(screen.getByRole("button", { name: "Turn on cross-out mode" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });
});
