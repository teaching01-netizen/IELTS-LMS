import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * SAT personal single-operation entry contract.
 *
 * Before proctor Start: WAITING ROOM. Proctor Start: one idempotent
 * StartModule activates immediately at DB time and the browser renders the
 * exam. M1→M2 and break→next-M1 are server-driven (zero student mutations).
 * Reloads resume via bootstrap/state. No offers, no Enter/Visible handshake,
 * no recovery screens.
 */

const gatewayMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  state: vi.fn(),
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
    state: gatewayMocks.state,
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

const SERVER_NOW = "2026-09-24T08:00:00.000Z";
const MODULE_ID = "module-rw";
const ATTEMPT_ID = "attempt-1";
const AUTHORED_SECONDS = 120;

function baseModule(id: string, role = "base") {
  return {
    id,
    moduleKey: id,
    title: "Module 1",
    displayOrder: 0,
    durationSeconds: AUTHORED_SECONDS,
    targetQuestionCount: 1,
    adaptiveRole: role,
    instructions: { version: 1, nodes: [] },
    toolPolicy: [],
    questions: [{ examQuestionId: `${id}-q1` }],
  };
}

function moduleAttempt(moduleId: string, state: string, started: boolean) {
  const now = SERVER_NOW;
  return {
    id: `ma-${moduleId}`,
    moduleId,
    state,
    allocatedSeconds: AUTHORED_SECONDS,
    availableAt: started ? now : null,
    startedAt: started ? now : null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: started ? new Date(Date.parse(now) + AUTHORED_SECONDS * 1000).toISOString() : null,
    remainingSeconds: started ? AUTHORED_SECONDS : null,
    completionReason: state === "locked" ? "time_expired" : null,
    rawCorrect: null,
    operationalQuestionCount: null,
    toolState: {},
    revision: started ? 2 : 0,
  };
}

function payload(attempts: unknown[], serverNow = SERVER_NOW): AssessmentDeliveryBootstrap {
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow,
    candidateName: "Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "cohort_runtime",
      timingModel: "sat_personal_v1",
      stageKey: null,
      stageStatus: "live",
      serverNow,
      deadlineAt: null,
      remainingSeconds: 0,
      runtimeRevision: 1,
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
        modules: [baseModule(MODULE_ID)],
      },
    ],
    attempt: { id: ATTEMPT_ID, moduleAttempts: attempts, responses: [] },
    result: null,
  } as unknown as AssessmentDeliveryBootstrap;
}

function renderController() {
  return renderHook(() =>
    useSatExamController({
      scheduleId: "schedule",
      attemptId: ATTEMPT_ID,
      candidateId: "candidate",
      attemptUpdateToken: 0,
      liveSocketConnected: false,
    }),
  );
}

describe("SAT personal single-operation entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.startModule.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
  });

  it("activates the initial module with one StartModule and renders it", async () => {
    const seeded = payload([moduleAttempt(MODULE_ID, "not_started", false)]);
    const active = payload([moduleAttempt(MODULE_ID, "active", true)]);
    gatewayMocks.bootstrap.mockResolvedValue(seeded);
    gatewayMocks.startModule.mockResolvedValue(active);

    const hook = renderController();
    await waitFor(() => expect(hook.result.current.pendingModule?.id).toBe(MODULE_ID));
    await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1));
    expect(gatewayMocks.startModule).toHaveBeenCalledWith("schedule", ATTEMPT_ID, {
      moduleId: MODULE_ID,
    });
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.stateModule?.id).toBe(MODULE_ID);
    hook.unmount();
  });

  it("retries a lost StartModule response idempotently without a second window", async () => {
    const seeded = payload([moduleAttempt(MODULE_ID, "not_started", false)]);
    const active = payload([moduleAttempt(MODULE_ID, "active", true)]);
    gatewayMocks.bootstrap.mockResolvedValue(seeded);
    // First response lost (reject), retry sees already-active and resumes.
    gatewayMocks.startModule.mockRejectedValueOnce(new Error("network down"));
    gatewayMocks.startModule.mockResolvedValue(active);

    const hook = renderController();
    await waitFor(() => expect(hook.result.current.pendingModule?.id).toBe(MODULE_ID));
    await waitFor(() => expect(gatewayMocks.startModule.mock.calls.length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"), { timeout: 8000 });
    expect(hook.result.current.stateModule?.id).toBe(MODULE_ID);
    hook.unmount();
  });

  it("renders an already-active Module 2 with zero StartModule calls (server-driven)", async () => {
    const m1 = { ...moduleAttempt("m1", "locked", true), moduleId: "m1", id: "ma-m1" };
    const m2 = { ...moduleAttempt("m2", "active", true), moduleId: "m2", id: "ma-m2" };
    const handoff = {
      ...payload([m1, m2]),
      sections: [
        {
          id: "section-rw",
          sectionKey: "reading-writing",
          title: "Reading and Writing",
          displayOrder: 0,
          durationSeconds: 3600,
          breakAfterSeconds: 0,
          instructions: { version: 1, nodes: [] },
          modules: [baseModule("m1"), { ...baseModule("m2"), adaptiveRole: "higher_branch" }],
        },
      ],
    } as unknown as AssessmentDeliveryBootstrap;
    gatewayMocks.bootstrap.mockResolvedValue(handoff);

    const hook = renderController();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.stateModule?.id).toBe("m2");
    expect(gatewayMocks.startModule).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("resumes an active module on reload via bootstrap with no StartModule", async () => {
    const active = payload([moduleAttempt(MODULE_ID, "active", true)]);
    gatewayMocks.bootstrap.mockResolvedValue(active);

    const hook = renderController();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.stateModule?.id).toBe(MODULE_ID);
    expect(gatewayMocks.startModule).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("never calls enter/visible handshake endpoints", async () => {
    const seeded = payload([moduleAttempt(MODULE_ID, "not_started", false)]);
    const active = payload([moduleAttempt(MODULE_ID, "active", true)]);
    gatewayMocks.bootstrap.mockResolvedValue(seeded);
    gatewayMocks.startModule.mockResolvedValue(active);

    const hook = renderController();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    // The gateway mock exposes no enterModule/entryState/markStageVisible, and
    // the controller must not require them: single-op StartModule is enough.
    expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});
