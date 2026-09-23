import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * Reload at the exact adaptive handoff (plan rigorous test 6) + question
 * ownership (test 9) + atomic start-module commit (test 10).
 *
 * The payload carries BOTH Module 2 branches with the SAME business
 * `moduleKey` — the server routed HIGH, so only HIGH has a module attempt
 * and LOW must never be opened, rendered, or answered. The browser
 * "reloads" by mounting the controller fresh on this payload.
 *
 *   M1 expired -> server created HIGH attempt -> reload before M2 starts
 *   => pendingModule.id == HIGH, adaptiveRole == higher_branch
 *   => POST /modules/start { moduleId: HIGH }, never LOW
 *   => every rendered question belongs to HIGH, none to LOW
 *   => no render ever pairs new payload data with an old module identity
 */

const gatewayMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  configureSatDeliveryAttempt: vi.fn(),
  startModule: vi.fn(),
  submitModule: vi.fn(),
  submitAssessment: vi.fn(),
}));
const persistenceMock = vi.hoisted(() => ({
  pendingCount: 0,
  pendingDrafts: {},
  visibleDrafts: {},
  failure: null,
  failureKind: null,
  tombstoneCount: 0,
  hydrateRevisions: vi.fn(),
  hydrateBootstrap: vi.fn(),
  save: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn(),
  retryFailed: vi.fn(),
  takeOverLease: vi.fn(),
  isTakingOver: false,
}));

vi.mock("../../infrastructure/satDeliveryGateway", () => ({
  configureSatDeliveryAttempt: gatewayMocks.configureSatDeliveryAttempt,
  satDeliveryGateway: {
    bootstrap: gatewayMocks.bootstrap,
    startModule: gatewayMocks.startModule,
    submitModule: gatewayMocks.submitModule,
    submitAssessment: gatewayMocks.submitAssessment,
  },
}));
vi.mock("../useSatResponsePersistence", () => ({
  useSatResponsePersistence: () => persistenceMock,
}));
vi.mock("../useSatIntegrityControl", () => ({
  useSatIntegrityControl: () => ({
    pendingTabSwitchWarning: null,
    acknowledgeTabSwitchWarning: () => undefined,
  }),
}));

const SERVER_NOW = new Date("2026-09-10T08:00:00.000Z").toISOString();
const M1_ID = "rw-m1-id";
const LOW_ID = "rw-m2-lower-id";
const HIGH_ID = "rw-m2-higher-id";
const SHARED_KEY = "module-2";
const ATTEMPT_ID = "attempt-handoff";

type DeliveredModule = AssessmentDeliveryBootstrap["sections"][number]["modules"][number];
type ModuleAttempt = AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"][number];

function question(examQuestionId: string) {
  return { examQuestionId } as DeliveredModule["questions"][number];
}

function branchModule(
  id: string,
  role: "lower_branch" | "higher_branch",
  examQuestionIds: string[],
): DeliveredModule {
  return {
    id,
    // Deliberately identical across branches: the runtime must never use
    // this key as the module identity.
    moduleKey: SHARED_KEY,
    title: role === "higher_branch" ? "Module 2 Higher" : "Module 2 Lower",
    displayOrder: 1,
    durationSeconds: 1800,
    targetQuestionCount: examQuestionIds.length,
    adaptiveRole: role,
    instructions: { version: 1, nodes: [] },
    toolPolicy: { calculator: false, reference_sheet: false },
    questions: examQuestionIds.map(question),
  } as unknown as DeliveredModule;
}

/** M1 expired on its own clock; HIGH routed but not yet open; LOW attempt-free. */
function handoffBootstrap(): AssessmentDeliveryBootstrap {
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow: SERVER_NOW,
    candidateName: "Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: "reading-writing",
      stageStatus: "live",
      serverNow: SERVER_NOW,
      deadlineAt: new Date(Date.parse(SERVER_NOW) + 120_000).toISOString(),
      remainingSeconds: 120,
      runtimeRevision: 7,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [
      {
        id: "section-rw",
        sectionKey: "reading-writing",
        title: "Reading and Writing",
        displayOrder: 0,
        durationSeconds: 3600,
        breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: [
          {
            id: M1_ID,
            moduleKey: "module-1",
            title: "Module 1",
            displayOrder: 0,
            durationSeconds: 1800,
            targetQuestionCount: 1,
            adaptiveRole: "base",
            instructions: { version: 1, nodes: [] },
            toolPolicy: { calculator: false, reference_sheet: false },
            questions: [question("m1-q-1")],
          } as unknown as DeliveredModule,
          branchModule(LOW_ID, "lower_branch", ["low-q-1"]),
          branchModule(HIGH_ID, "higher_branch", ["high-q-1", "high-q-2"]),
        ],
      },
    ],
    attempt: {
      id: ATTEMPT_ID,
      moduleAttempts: [expiredAttempt(M1_ID), pendingAttempt(HIGH_ID)],
      responses: [],
    },
    result: null,
  } as unknown as AssessmentDeliveryBootstrap;
}

function expiredAttempt(moduleId: string): ModuleAttempt {
  return {
    id: `ma-${moduleId}`,
    moduleId,
    state: "submitted",
    allocatedSeconds: 1800,
    availableAt: SERVER_NOW,
    startedAt: SERVER_NOW,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: new Date(Date.parse(SERVER_NOW) - 5_000).toISOString(),
    remainingSeconds: 0,
    completionReason: "time_expired",
    rawCorrect: 20,
    operationalQuestionCount: 27,
    toolState: {},
    revision: 2,
  };
}

function pendingAttempt(moduleId: string): ModuleAttempt {
  return {
    id: `ma-${moduleId}`,
    moduleId,
    state: "not_started",
    allocatedSeconds: 1800,
    availableAt: SERVER_NOW,
    startedAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: null,
    remainingSeconds: 1800,
    completionReason: null,
    rawCorrect: null,
    operationalQuestionCount: null,
    toolState: {},
    revision: 1,
  };
}

function activeAttempt(moduleId: string): ModuleAttempt {
  return {
    ...pendingAttempt(moduleId),
    state: "active",
    startedAt: SERVER_NOW,
    deadlineAt: new Date(Date.parse(SERVER_NOW) + 1_800_000).toISOString(),
    revision: 2,
  };
}

function renderController(seen: Array<{ phase: string; moduleId: string | null }>) {
  return renderHook(() => {
    const controller = useSatExamController({
      scheduleId: "schedule",
      attemptId: ATTEMPT_ID,
      candidateId: "candidate",
      attemptUpdateToken: 0,
      liveSocketConnected: false,
    });
    seen.push({
      phase: controller.state.phase,
      moduleId:
        controller.state.phase === "module" || controller.state.phase === "review"
          ? controller.state.moduleId
          : null,
    });
    return controller;
  });
}

describe("useSatExamController adaptive handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.startModule.mockReset();
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
    gatewayMocks.configureSatDeliveryAttempt.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
  });

  it("resumes into HIGH (never LOW) after a reload at the Module 1 boundary", async () => {
    const handoff = handoffBootstrap();
    gatewayMocks.bootstrap.mockResolvedValue(handoff);
    gatewayMocks.startModule.mockResolvedValue({
      ...handoff,
      attempt: {
        ...handoff.attempt,
        moduleAttempts: [expiredAttempt(M1_ID), activeAttempt(HIGH_ID)],
      },
    });

    const seen: Array<{ phase: string; moduleId: string | null }> = [];
    const hook = renderController(seen);

    // The pending module is the routed HIGH branch with its adaptive role.
    await waitFor(() => expect(hook.result.current.pendingModule?.id).toBe(HIGH_ID));
    expect(hook.result.current.pendingModule?.adaptiveRole).toBe("higher_branch");

    // Automatic entry posts the HIGH id — never LOW.
    await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1));
    expect(gatewayMocks.startModule).toHaveBeenCalledWith("schedule", ATTEMPT_ID, {
      moduleId: HIGH_ID,
    });
    for (const call of gatewayMocks.startModule.mock.calls) {
      expect(call[2]).not.toEqual(expect.objectContaining({ moduleId: LOW_ID }));
    }

    // The committed runner state carries the HIGH identity.
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    const state = hook.result.current.state;
    expect(state.phase === "module" && state.moduleId).toBe(HIGH_ID);

    // Rendered module and attempt ownership follow the same id.
    expect(hook.result.current.stateModule?.id).toBe(HIGH_ID);
    expect(hook.result.current.stateModuleAttempt?.moduleId).toBe(HIGH_ID);

    // Question ownership: every rendered question belongs to HIGH, none to LOW.
    const rendered = (hook.result.current.stateModule?.questions ?? []).map(
      (q) => q.examQuestionId,
    );
    expect(rendered).toEqual(["high-q-1", "high-q-2"]);
    expect(rendered).not.toContain("low-q-1");

    // Atomic commit: no render ever paired module/review phase with a stale
    // or LOW identity — not even for a single frame.
    for (const frame of seen) {
      if (frame.phase === "module" || frame.phase === "review") {
        expect(frame.moduleId).toBe(HIGH_ID);
      }
    }
    hook.unmount();
  });

  it("keeps a stale pre-handoff poll from regressing the routed module", async () => {
    const handoff = handoffBootstrap();
    gatewayMocks.bootstrap.mockResolvedValue(handoff);
    gatewayMocks.startModule.mockResolvedValue({
      ...handoff,
      attempt: {
        ...handoff.attempt,
        moduleAttempts: [expiredAttempt(M1_ID), activeAttempt(HIGH_ID)],
      },
    });

    const seen: Array<{ phase: string; moduleId: string | null }> = [];
    const hook = renderController(seen);
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.state.phase === "module" && hook.result.current.state.moduleId).toBe(
      HIGH_ID,
    );

    // A stale poll that still shows Module 1 as the open module arrives late.
    // The commit layer must not route back to it.
    const stalePoll = {
      ...handoff,
      timing: { ...handoff.timing, runtimeRevision: 1 },
      attempt: {
        ...handoff.attempt,
        moduleAttempts: [pendingAttempt(M1_ID)],
      },
    } as unknown as AssessmentDeliveryBootstrap;
    await hook.result.current.commitForTest(stalePoll);

    const state = hook.result.current.state;
    expect(state.phase === "module" && state.moduleId).toBe(HIGH_ID);
    expect(hook.result.current.stateModule?.id).toBe(HIGH_ID);
    hook.unmount();
  });
});
