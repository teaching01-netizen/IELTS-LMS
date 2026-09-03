import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentResult,
} from "../../contracts/assessmentDelivery";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function bootstrap(attemptId: string): AssessmentDeliveryBootstrap {
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow: new Date().toISOString(),
    candidateName: "Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "legacy_attempt",
      timingModel: "legacy_section_v1",
      stageKey: null,
      stageStatus: null,
      serverNow: new Date().toISOString(),
      deadlineAt: null,
      remainingSeconds: 600,
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [],
    attempt: {
      id: attemptId,
      moduleAttempts: [],
      responses: [],
    },
    result: null,
  };
}

describe("useSatExamController attempt identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.configureSatDeliveryAttempt.mockReset();
    persistenceMock.hydrateBootstrap.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.submit.mockResolvedValue({} as never);
  });

  it("does not let a late bootstrap from the previous attempt replace the current one", async () => {
    const first = deferred<AssessmentDeliveryBootstrap>();
    const second = deferred<AssessmentDeliveryBootstrap>();
    gatewayMocks.bootstrap.mockImplementation((_: string, attemptId: string) =>
      attemptId === "attempt-a" ? first.promise : second.promise
    );

    const hook = renderHook(
      ({ attemptId }: { attemptId: string }) =>
        useSatExamController({
          scheduleId: "schedule",
          attemptId,
          candidateId: "candidate",
        }),
      { initialProps: { attemptId: "attempt-a" } }
    );

    await waitFor(() =>
      expect(gatewayMocks.bootstrap).toHaveBeenCalledWith("schedule", "attempt-a")
    );
    hook.rerender({ attemptId: "attempt-b" });
    await waitFor(() =>
      expect(gatewayMocks.bootstrap).toHaveBeenCalledWith("schedule", "attempt-b")
    );

    await act(async () => {
      second.resolve(bootstrap("attempt-b"));
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.data?.attempt.id).toBe("attempt-b"));

    await act(async () => {
      first.resolve(bootstrap("attempt-a"));
      await Promise.resolve();
    });

    expect(hook.result.current.data?.attempt.id).toBe("attempt-b");
  });

  it("recovers provider scoring when all SAT modules were submitted before the page was reloaded", async () => {
    const submitted = bootstrap("attempt-a");
    submitted.sections = [
      {
        id: "section-1",
        sectionKey: "reading-writing",
        title: "Reading & Writing",
        displayOrder: 0,
        durationSeconds: 60,
        breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: [
          {
            id: "module-1",
            moduleKey: "module-1",
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
    ];
    submitted.attempt.moduleAttempts = [
      {
        id: "module-attempt-1",
        moduleId: "module-1",
        state: "submitted",
        allocatedSeconds: 60,
        availableAt: null,
        startedAt: new Date().toISOString(),
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionSeconds: 0,
        deadlineAt: null,
        remainingSeconds: 0,
        completionReason: "student_submit",
        rawCorrect: 0,
        operationalQuestionCount: 0,
        toolState: {},
        revision: 2,
      },
    ];
    gatewayMocks.bootstrap.mockResolvedValue(submitted);
    const result: AssessmentResult = {
      id: "result-1",
      submissionId: "attempt-a",
      providerKey: "sat",
      totalScore: 800,
      scorePayload: {},
      scoreKind: "practice",
      sections: [],
    };
    gatewayMocks.submitAssessment.mockResolvedValue(result);
    persistenceMock.submit.mockResolvedValue({} as never);

    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        useV2DurabilityEngine: true,
      })
    );

    await waitFor(() => expect(hook.result.current.result?.id).toBe("result-1"));
    expect(persistenceMock.flush).toHaveBeenCalled();
    expect(persistenceMock.submit).toHaveBeenCalled();
    expect(gatewayMocks.submitAssessment).toHaveBeenCalledWith("schedule", "attempt-a", {
      submissionId: "attempt-a",
    });
  });
});
