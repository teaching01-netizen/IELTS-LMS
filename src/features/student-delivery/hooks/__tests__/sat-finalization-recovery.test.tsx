import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

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
  useSatIntegrityControl: () => undefined,
}));

function basePayload(): AssessmentDeliveryBootstrap {
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
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [],
    attempt: { id: "attempt-a", moduleAttempts: [], responses: [] },
    result: null,
  };
}

function activePayload(): AssessmentDeliveryBootstrap {
  const p = basePayload();
  p.sections = [{
    id: "section", sectionKey: "reading-writing", title: "RW", displayOrder: 0,
    durationSeconds: 120, breakAfterSeconds: 0,
    instructions: { version: 1, nodes: [] },
    modules: [{
      id: "module", moduleKey: "module", title: "Module", displayOrder: 0,
      durationSeconds: 60, targetQuestionCount: 1, adaptiveRole: "base",
      instructions: { version: 1, nodes: [] }, toolPolicy: [], questions: [],
    }],
  }];
  p.attempt.moduleAttempts = [{
    id: "ma", moduleId: "module", state: "active", allocatedSeconds: 60,
    availableAt: null, startedAt: new Date().toISOString(), pausedAt: null,
    accumulatedPausedSeconds: 0, extensionSeconds: 0,
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    remainingSeconds: 60, completionReason: null, rawCorrect: null,
    operationalQuestionCount: null, toolState: {}, revision: 1,
  }];
  return p;
}

const opts = { scheduleId: "schedule", attemptId: "attempt-a", candidateId: "candidate", liveSocketConnected: true };
async function settle() {
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
}

describe("SAT finalization recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T08:00:00Z"));
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.submit.mockResolvedValue({} as never);
  });

  it("recovers to complete via bootstrap polling after a submission outage", async () => {
    const p = activePayload();
    gatewayMocks.bootstrap.mockResolvedValue(p);
    const hook = renderHook(() => useSatExamController(opts));
    await settle();
    act(() => hook.result.current.commands.reviewModule());
    expect(hook.result.current.state.phase).toBe("review");
    const done = structuredClone(p);
    done.attempt.moduleAttempts[0].state = "submitted";
    gatewayMocks.submitModule.mockResolvedValue(done);
    persistenceMock.submit.mockRejectedValueOnce(new Error("Network unavailable"));
    gatewayMocks.bootstrap.mockRejectedValue(new Error("Network unavailable"));
    await act(async () => { await hook.result.current.commands.submitModule("module"); });
    expect(hook.result.current.error).toBe("Network unavailable");
    const calls = gatewayMocks.bootstrap.mock.calls.length;
    gatewayMocks.bootstrap.mockResolvedValue({
      ...done,
      result: {
        id: "completed-result", submissionId: "attempt-a", providerKey: "sat",
        totalScore: 800, scorePayload: {}, scoreKind: "practice", sections: [],
      },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(hook.result.current.state.phase).toBe("complete");
    expect(gatewayMocks.bootstrap.mock.calls.length - calls).toBeGreaterThan(0);
    hook.unmount();
    vi.useRealTimers();
  });

  it("retryFinalization replays the stable submission id exactly once", async () => {
    const p = activePayload();
    gatewayMocks.bootstrap.mockResolvedValue(p);
    const hook = renderHook(() => useSatExamController(opts));
    await settle();
    act(() => hook.result.current.commands.reviewModule());
    const done = structuredClone(p);
    done.attempt.moduleAttempts[0].state = "submitted";
    gatewayMocks.submitModule.mockResolvedValue(done);
    gatewayMocks.submitAssessment
      .mockRejectedValueOnce(new Error("completion backend down"))
      .mockResolvedValueOnce({
        id: "result-1", submissionId: "attempt-a", providerKey: "sat",
        totalScore: 800, scorePayload: {}, scoreKind: "practice", sections: [],
      });
    await act(async () => { await hook.result.current.commands.submitModule("module"); });
    expect(hook.result.current.state.phase).toBe("submitting");
    expect(hook.result.current.error).toBe("completion backend down");
    await act(async () => { await hook.result.current.commands.retryFinalization(); });
    expect(hook.result.current.state.phase).toBe("complete");
    const ids = gatewayMocks.submitAssessment.mock.calls.map((call) => (call[2] as { submissionId?: string }).submissionId);
    expect(ids).toEqual(["attempt-a", "attempt-a"]);
    hook.unmount();
    vi.useRealTimers();
  });
});
