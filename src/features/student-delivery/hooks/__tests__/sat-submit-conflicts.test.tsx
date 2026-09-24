import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * Audit SAT-005 (stale mutation responses may not overwrite newer state) and
 * SAT-007 (HTTP 409 is not one thing: writer supersession, version collisions
 * and clock/state transitions must classify differently).
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
  assertBoundarySettled: vi.fn().mockResolvedValue(undefined),
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

function modulePayload(state: string, runtimeRevision = 1): AssessmentDeliveryBootstrap {
  const now = new Date().toISOString();
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow: now,
    candidateName: "Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "legacy_attempt",
      timingModel: "legacy_section_v1",
      stageKey: null,
      stageStatus: null,
      serverNow: now,
      deadlineAt: null,
      remainingSeconds: 600,
      runtimeRevision,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [
      {
        id: "section",
        sectionKey: "reading-writing",
        title: "RW",
        displayOrder: 0,
        durationSeconds: 120,
        breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: [
          {
            id: "m-1",
            moduleKey: "rw-m1",
            title: "Module 1",
            displayOrder: 0,
            durationSeconds: 60,
            targetQuestionCount: 1,
            adaptiveRole: "base",
            instructions: { version: 1, nodes: [] },
            toolPolicy: [],
            questions: [],
          },
        ],
      },
    ] as unknown as AssessmentDeliveryBootstrap["sections"],
    attempt: {
      id: "attempt-a",
      moduleAttempts: [
        {
          id: "ma-1",
          moduleId: "m-1",
          state,
          allocatedSeconds: 60,
          availableAt: null,
          startedAt: state === "active" ? now : null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionSeconds: 0,
          deadlineAt: null,
          remainingSeconds: 60,
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

const opts = {
  scheduleId: "schedule",
  attemptId: "attempt-a",
  candidateId: "candidate",
};

async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

/** Bootstraps into the question screen of the (only) module. */
async function armedHook() {
  const active = modulePayload("active");
  gatewayMocks.bootstrap.mockResolvedValue(active);
  gatewayMocks.startModule.mockResolvedValue(active);
  const hook = renderHook(() => useSatExamController(opts));
  await settle();
  await act(async () => {
    await hook.result.current.commands.startPendingModule();
  });
  await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
  return hook;
}

describe("SAT server-owned module lifecycle", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.startModule.mockReset();
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.assertBoundarySettled.mockResolvedValue(undefined);
  });

  it("keeps newer authoritative state and exposes no student submit command", async () => {
    const hook = await armedHook();
    // The server's authoritative frame has already been committed by the poll
    // loop. An older frame cannot replace it, and no student mutation exists
    // that could race that commit.
    const advanced = modulePayload("active", 9);
    const seam = hook.result.current as unknown as {
      commitForTest: (p: AssessmentDeliveryBootstrap) => boolean;
    };
    act(() => {
      expect(seam.commitForTest(advanced)).toBe(true);
    });
    act(() => {
      expect(seam.commitForTest(modulePayload("locked", 1))).toBe(false);
    });
    expect(hook.result.current.data?.timing.runtimeRevision).toBe(9);
    expect("submitModule" in hook.result.current.commands).toBe(false);
    expect(gatewayMocks.submitModule).not.toHaveBeenCalled();
  });
});
