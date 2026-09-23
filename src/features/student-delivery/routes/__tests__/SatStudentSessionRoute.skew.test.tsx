import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { SKEW_HOLD_MS, SatStudentSessionRoute } from "../SatStudentSessionRoute";

const controllerMock = vi.hoisted(() => ({
  current: null as unknown,
}));

vi.mock("../../hooks/useSatExamController", () => ({
  useSatExamController: () => controllerMock.current,
}));

function matchMediaMock(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() })),
  );
}

function para(text: string) { return { version: 1 as const, nodes: [{ type: "paragraph" as const, id: "p-" + text, text }] }; }

function moduleData(): AssessmentDeliveryBootstrap {
  const now = new Date().toISOString();
  const sections = [{ id: "sec-math", sectionKey: "math", title: "Math", displayOrder: 0, durationSeconds: 2100, breakAfterSeconds: 0, instructions: para("Math section directions"), modules: [{ id: "math-m1", moduleKey: "math-m1", title: "Math Module", displayOrder: 0, durationSeconds: 2100, targetQuestionCount: 1, adaptiveRole: "base", instructions: para("Math module directions"), toolPolicy: { calculator: false, reference_sheet: false }, questions: [{ examQuestionId: "q1", questionId: "q1", displayOrder: 0, isPretest: false, questionType: "single_choice" as const, stimulus: para("Passage"), prompt: para("Skew hold marker question"), answer: { kind: "single_choice" as const, options: ["A", "B"].map((id) => ({ id, content: para("Choice " + id) })) }, metadata: { sectionKey: "math", domain: null, skill: null, difficulty: "medium" as const, tags: [] }, accessibility: { longDescription: null } }] }] }];
  return { scheduleId: "schedule-1", examId: "exam-1", providerKey: "sat", versionId: "v1", serverNow: now, candidateName: "Ada Candidate", scheduleRuntimeStatus: "live", timing: { authority: "legacy_attempt", timingModel: "legacy_section_v1", stageKey: null, stageStatus: null, serverNow: now, deadlineAt: null, remainingSeconds: 2100, runtimeRevision: 1 }, proctorStatus: "active", proctorNote: null, deviceFingerprintHash: null, sections: sections as unknown as AssessmentDeliveryBootstrap["sections"], attempt: { id: "attempt-1", moduleAttempts: [{ id: "ma-1", moduleId: "math-m1", state: "active", allocatedSeconds: 2100, availableAt: now, startedAt: now, pausedAt: null, accumulatedPausedSeconds: 0, extensionSeconds: 0, deadlineAt: null, remainingSeconds: 2100, completionReason: null, rawCorrect: null, operationalQuestionCount: null, toolState: {}, revision: 1 }] as unknown as AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"], responses: [] }, result: null };
}

function baseCommands() { return { startPendingModule: vi.fn(), submitModule: vi.fn(), retryFinalization: vi.fn(), takeOverDurabilityLease: vi.fn().mockResolvedValue(undefined), setAnswer: vi.fn(), toggleReview: vi.fn(), toggleEliminatedOption: vi.fn(), setAnnotationNote: vi.fn(), setAnnotations: vi.fn(), selectQuestion: vi.fn(), returnToQuestion: vi.fn(), previousQuestion: vi.fn(), nextQuestion: vi.fn(), reviewModule: vi.fn(), returnToModule: vi.fn(), showDirections: vi.fn(), toggleCalculator: vi.fn(), toggleReference: vi.fn(), closeTool: vi.fn() }; }

function moduleState() { const now = new Date().toISOString(); return { phase: "module", scheduleId: "schedule-1", candidateId: "candidate-1", assessmentId: "exam-1", sectionKey: "math", moduleKey: "math-m1", questionIds: ["q1"], questionIndex: 0, responses: { q1: { questionId: "q1", answer: "", markedForReview: false, eliminatedOptionIds: [], annotations: { version: 2, annotations: [], legacyQuestionNote: "" } } }, responseRevisions: {}, toolCapabilities: { calculator: false, referenceSheet: false }, activeTool: null, activeTools: { calculator: false, referenceSheet: false }, startedAt: now, endsAt: now }; }

function skewData(): AssessmentDeliveryBootstrap { const data = moduleData(); return { ...data, sections: [], attempt: { id: "attempt-1", moduleAttempts: [], responses: [] } } as unknown as AssessmentDeliveryBootstrap; }

function routeProps() { return { scheduleId: "schedule-1", attemptId: "attempt-1", candidateId: "candidate-1", runtimeSnapshot: null, liveSocketConnected: false, attemptUpdateToken: 0, onExit: () => undefined } as unknown as Record<string, never>; }

async function renderRoute() { const { default: React } = await import("react"); seedMock(); const utils = render(React.createElement(SatStudentSessionRoute, routeProps() as never)); const refresh = async () => { const { default: R2 } = await import("react"); utils.rerender(R2.createElement(SatStudentSessionRoute, routeProps() as never)); }; return { ...utils, refresh }; }

function seedMock() { (controllerMock as { current: unknown }).current = { state: { phase: "loading", scheduleId: "schedule-1", candidateId: "candidate-1" }, data: null, result: null, error: null, setError: () => undefined, isSubmitting: false, isStarting: false, pendingModule: null, pendingBreakSeconds: 0, pendingSectionWaitSeconds: 0, pendingStageReady: true, effectiveTiming: null, stateModule: null, stateModuleAttempt: undefined, stateSection: null, remainingSeconds: 0, blocked: false, warning: null, autoSubmitted: false, answersRecorded: false, showAlmostUp: false, persistence: { pendingCount: 0, visibleDrafts: {}, failure: null, failureKind: null }, commands: baseCommands() }; }

function drive(
  state: unknown,
  data: AssessmentDeliveryBootstrap,
  rerender: (ui: React.ReactElement) => void,
  pendingModuleId?: string,
) {
  const { default: React } = { default: null as unknown as typeof import("react") };
  void React;
  const commands = baseCommands();
  controllerMock.current = { state, data, result: null, error: null, setError: vi.fn(), isSubmitting: false, isStarting: false, pendingModule: null, pendingBreakSeconds: 0, pendingSectionWaitSeconds: 0, pendingStageReady: true, autoEntryRecoverable: false, entryReason: "next-module-entry", retryModuleEntry: vi.fn(), effectiveTiming: null, stateModule: null, stateModuleAttempt: undefined, stateSection: null, remainingSeconds: 2100, blocked: false, warning: null, autoSubmitted: false, answersRecorded: false, showAlmostUp: false, persistence: { pendingCount: 0, visibleDrafts: {}, failure: null, failureKind: null, failureCount: 0, isTakingOver: false, flush: vi.fn().mockResolvedValue(undefined), retryFailed: vi.fn(), takeOverLease: vi.fn().mockResolvedValue(undefined), save: vi.fn(), submit: vi.fn() }, commands };
  const resolved = (data.sections?.length ?? 0) > 0;
  const mock = controllerMock.current as Record<string, unknown>;
  mock.stateModule = resolved ? (data.sections.flatMap((s) => s.modules).find((m) => m.id === "math-m1") ?? null) : null;
  mock.stateModuleAttempt = resolved ? (data.attempt.moduleAttempts.find((a) => a.moduleId === "math-m1") ?? undefined) : undefined;
  mock.stateSection = resolved ? (data.sections.find((s) => s.modules.some((m) => m.id === "math-m1")) ?? null) : null;
  mock.pendingModule = pendingModuleId
    ? data.sections.flatMap((section) => section.modules).find((module) => module.id === pendingModuleId) ?? null
    : null;
  return commands;
}

function routedBranchData(): AssessmentDeliveryBootstrap {
  const data = moduleData();
  const section = data.sections[0];
  const module1 = section.modules[0];
  const module2 = { ...module1, id: "math-m2", moduleKey: "math-m2", displayOrder: 1, adaptiveRole: "higher_branch" };
  const attempt1 = data.attempt.moduleAttempts[0];
  return {
    ...data,
    sections: [{ ...section, modules: [module1, module2] }],
    attempt: {
      ...data.attempt,
      moduleAttempts: [
        { ...attempt1, state: "submitted", completionReason: "student_submit" },
        { ...attempt1, id: "ma-2", moduleId: "math-m2", state: "not_started", startedAt: null, deadlineAt: null, completionReason: null },
      ],
    },
  } as AssessmentDeliveryBootstrap;
}

describe("SatStudentSessionRoute skew hold (Phase 04 T3)", () => {
  beforeEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.clearAllMocks(); vi.useRealTimers(); matchMediaMock(false); });

  it("holds the previous question UI on a one-frame skew (no spinner, no error)", async () => {
    const data = moduleData(); const state = moduleState();
    const { rerender, refresh } = await renderRoute();
    drive(state, data, (ui) => rerender(ui as never));
    await refresh();
    expect(screen.getByText("Skew hold marker question")).toBeInTheDocument();
    drive(state, skewData(), (ui) => rerender(ui as never));
    await refresh();
    expect(screen.getByText("Skew hold marker question")).toBeInTheDocument();
    expect(screen.queryByText("Refreshing SAT module…")).toBeNull();
    expect(screen.queryByText("SAT state unavailable")).toBeNull();
    drive(state, data, (ui) => rerender(ui as never));
    await refresh();
    expect(screen.getByText("Skew hold marker question")).toBeInTheDocument();
  });

  it("falls back to the bare Refreshing surface only after hold expiry with no recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T08:00:00Z"));
    const data = moduleData(); const state = moduleState();
    const { rerender, refresh } = await renderRoute();
    drive(state, data, (ui) => rerender(ui as never));
    await refresh();
    expect(screen.getByText("Skew hold marker question")).toBeInTheDocument();
    drive(state, skewData(), (ui) => rerender(ui as never));
    await refresh();
    expect(screen.getByText("Skew hold marker question")).toBeInTheDocument();
    const { act: actTl } = await import("@testing-library/react");
    actTl(() => { vi.advanceTimersByTime(SKEW_HOLD_MS + 100); });
    drive(state, skewData(), (ui) => rerender(ui as never));
    await refresh();
    expect(screen.getByText("Refreshing SAT module…")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.body.querySelectorAll("iframe[data-desmos-mode]")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("shows the fallback immediately with no previous valid frame", async () => {
    const state = moduleState();
    const { rerender, refresh } = await renderRoute();
    drive(state, skewData(), (ui) => rerender(ui as never));
    await refresh();
    expect(screen.getByText("Refreshing SAT module…")).toBeInTheDocument();
    expect(screen.queryByText("SAT state unavailable")).toBeNull();
  });

  it("holds Module 1 inert while the server-routed Module 2 opens", async () => {
    const data = moduleData();
    const state = moduleState();
    const { rerender, refresh } = await renderRoute();
    const commands = drive(state, data, (ui) => rerender(ui as never));
    await refresh();
    expect(screen.getByText("Skew hold marker question")).toBeInTheDocument();

    const nextModule = routedBranchData();
    drive({ ...state, phase: "directions" }, nextModule, (ui) => rerender(ui as never), "math-m2");
    await refresh();

    const heldExam = screen.getByTestId("sat-exam-shell").closest("[data-sat-transition-hold]");
    expect(heldExam).toHaveAttribute("inert");
    expect(heldExam).toHaveAttribute("aria-hidden", "true");
    fireEvent.keyDown(document, { key: "x", ctrlKey: true, altKey: true });
    fireEvent.keyDown(document, { key: "c", ctrlKey: true, altKey: true });
    expect(commands.nextQuestion).not.toHaveBeenCalled();
    expect(commands.toggleCalculator).not.toHaveBeenCalled();
  });

  it("shows a proctor pause immediately during a module-entry handoff", async () => {
    const activeData = moduleData();
    const activeState = moduleState();
    const { rerender, refresh } = await renderRoute();
    drive(activeState, activeData, (ui) => rerender(ui as never));
    await refresh();

    const data = routedBranchData();
    data.proctorStatus = "paused";
    const state = { ...activeState, phase: "directions" as const };
    drive(state, data, (ui) => rerender(ui as never), "math-m2");
    (controllerMock.current as { entryReason: string }).entryReason = "proctor-blocked";
    await refresh();

    expect(screen.getByRole("heading", { name: "Your exam is paused" })).toBeInTheDocument();
    expect(screen.queryByTestId("sat-scheduled-break")).toBeNull();
    expect(document.querySelector("[data-sat-transition-hold]")).toBeNull();
  });

  it("shows runtime termination instead of the held exam frame", async () => {
    const activeData = moduleData();
    const activeState = moduleState();
    const { rerender, refresh } = await renderRoute();
    drive(activeState, activeData, (ui) => rerender(ui as never));
    await refresh();

    const data = routedBranchData();
    data.scheduleRuntimeStatus = "completed";
    const state = { ...activeState, phase: "directions" as const };
    drive(state, data, (ui) => rerender(ui as never), "math-m2");
    await refresh();

    expect(screen.getByRole("heading", { name: "Your SAT attempt has ended" })).toBeInTheDocument();
    expect(document.querySelector("[data-sat-transition-hold]")).toBeNull();
  });
});
