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

function cohortBootstrap(): AssessmentDeliveryBootstrap {
  const serverNow = new Date("2026-09-10T08:00:00.000Z").toISOString();
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
      timingModel: "cohort_section_v3",
      stageKey: "reading-writing",
      stageStatus: "live",
      serverNow,
      deadlineAt: new Date("2026-09-10T08:02:00.000Z").toISOString(),
      remainingSeconds: 120,
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [
      {
        id: "section", sectionKey: "reading-writing", title: "RW", displayOrder: 0,
        durationSeconds: 120, breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: [
          {
            id: "module", moduleKey: "module", title: "Module", displayOrder: 0,
            durationSeconds: 60, targetQuestionCount: 1, adaptiveRole: "base",
            instructions: { version: 1, nodes: [] }, toolPolicy: [], questions: [],
          },
        ],
      },
    ],
    attempt: {
      id: "attempt-a",
      moduleAttempts: [
        {
          id: "ma", moduleId: "module", state: "active", allocatedSeconds: 60,
          availableAt: serverNow, startedAt: serverNow, pausedAt: null,
          accumulatedPausedSeconds: 0, extensionSeconds: 0,
          deadlineAt: new Date("2026-09-10T08:01:00.000Z").toISOString(),
          remainingSeconds: 60, completionReason: null, rawCorrect: null,
          operationalQuestionCount: null, toolState: {}, revision: 1,
        },
      ],
      responses: [],
    },
    result: null,
  };
}

describe("SAT cohort module clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T08:00:00.000Z"));
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.submit.mockResolvedValue({} as never);
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
  });

  it("ticks the personal countdown between bootstraps (60 -> 50 after 10s)", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(cohortBootstrap());
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        liveSocketConnected: true,
      }),
    );
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    expect(hook.result.current.remainingSeconds).toBe(60);
    const bootstrapCalls = gatewayMocks.bootstrap.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    // No new bootstrap: the countdown must still advance from the deadline.
    expect(gatewayMocks.bootstrap.mock.calls.length).toBe(bootstrapCalls);
    expect(hook.result.current.remainingSeconds).toBe(50);
    vi.useRealTimers();
  });
});
