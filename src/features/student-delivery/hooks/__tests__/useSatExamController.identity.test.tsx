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
  useSatIntegrityControl: () => ({
    pendingTabSwitchWarning: null,
    acknowledgeTabSwitchWarning: () => undefined,
  }),
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
      expect(gatewayMocks.bootstrap).toHaveBeenCalledWith("schedule", "attempt-a", null)
    );
    hook.rerender({ attemptId: "attempt-b" });
    await waitFor(() =>
      expect(gatewayMocks.bootstrap).toHaveBeenCalledWith("schedule", "attempt-b", null)
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

  it("does not seed a fresh SAT browser writer from the server attempt projection", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(bootstrap("attempt-a"));

    renderHook(() => useSatExamController({
      scheduleId: "schedule",
      attemptId: "attempt-a",
      candidateId: "candidate",
      attemptSnapshot: {
        id: "attempt-a",
        recovery: { clientSessionId: "server-active-writer" },
        integrity: { clientSessionId: "server-active-writer" },
      } as never,
    }));

    await waitFor(() => expect(gatewayMocks.configureSatDeliveryAttempt).toHaveBeenCalled());
    expect(gatewayMocks.configureSatDeliveryAttempt).toHaveBeenCalledWith(
      "schedule",
      "attempt-a",
      "candidate",
    );
  });

  it("fires bootstrap exactly once across StrictMode double-effect + parent re-renders with churning snapshots", async () => {
    const gate = deferred<AssessmentDeliveryBootstrap>();
    gatewayMocks.bootstrap.mockImplementation(() => gate.promise);
    const seed = {
      scheduleId: "schedule",
      attemptId: "attempt-a",
      candidateId: "candidate",
      attemptSnapshot: { id: "attempt-a", revision: 1 } as never,
      runtimeSnapshot: { id: "r", revision: 1 } as never,
      liveSnapshotReceivedAt: 1,
      staticVersionId: "ver-1",
      attemptRevision: 1,
      runtimeRevision: 1,
      deliveryEtag: null,
      seedGeneration: 1,
    };

    const hook = renderHook(
      ({ token }: { token: number }) =>
        useSatExamController({
          scheduleId: "schedule",
          attemptId: "attempt-a",
          candidateId: "candidate",
          // New object identities at equal revision (parent re-render churn).
          attemptSnapshot: { id: "attempt-a", revision: 1 } as never,
          runtimeSnapshot: { id: "r", revision: 1 } as never,
          attemptUpdateToken: token,
          bootstrapSeed: seed,
        }),
      { initialProps: { token: 0 } },
    );

    // StrictMode double-effect (unmount/remount) + three parent re-renders
    // with churning snapshot object identities at equal revision.
    // attemptUpdateToken is held at 0: token bumps intentionally refire the
    // recovery-poll refresh path (out of scope here), so the token stays
    // fixed to isolate the initial bootstrap effect under test.
    hook.rerender({ token: 0 });
    hook.rerender({ token: 0 });
    hook.rerender({ token: 0 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(bootstrap("attempt-a"));
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.data?.attempt.id).toBe("attempt-a"));
    expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1);
  });

  it("forwards a matching seed ETag as ifNoneMatch and drops ETag on identity mismatch", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(bootstrap("attempt-a"));
    const matching = {
      scheduleId: "schedule",
      attemptId: "attempt-a",
      candidateId: "candidate",
      attemptSnapshot: null,
      runtimeSnapshot: null,
      liveSnapshotReceivedAt: null,
      staticVersionId: "ver-1",
      attemptRevision: null,
      runtimeRevision: null,
      deliveryEtag: '"etag-1"',
      seedGeneration: 1,
    };
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        bootstrapSeed: matching,
      }),
    );
    await waitFor(() => expect(hook.result.current.data?.attempt.id).toBe("attempt-a"));
    expect(gatewayMocks.bootstrap).toHaveBeenCalledWith("schedule", "attempt-a", '"etag-1"');

    gatewayMocks.bootstrap.mockClear();
    gatewayMocks.bootstrap.mockResolvedValue(bootstrap("attempt-a"));
    const mismatched = { ...matching, attemptId: "attempt-OTHER" };
    const hook2 = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        bootstrapSeed: mismatched,
      }),
    );
    await waitFor(() => expect(hook2.result.current.data?.attempt.id).toBe("attempt-a"));
    // No cross-identity ETag reuse: third arg is null.
    expect(gatewayMocks.bootstrap).toHaveBeenCalledWith("schedule", "attempt-a", null);
  });

  it("refires exactly once on staticVersionId republish; late old-version resolution does not clobber", async () => {
    const oldGate = deferred<AssessmentDeliveryBootstrap>();
    const newGate = deferred<AssessmentDeliveryBootstrap>();
    gatewayMocks.bootstrap.mockImplementation(
      (_: string, __: string, etag?: string | null) =>
        etag === '"new"' ? newGate.promise : oldGate.promise,
    );
    const base = {
      scheduleId: "schedule",
      attemptId: "attempt-a",
      candidateId: "candidate",
      attemptSnapshot: null,
      runtimeSnapshot: null,
      liveSnapshotReceivedAt: null,
      attemptRevision: null,
      runtimeRevision: null,
      seedGeneration: 1,
    };
    const hook = renderHook(
      ({ version }: { version: string }) =>
        useSatExamController({
          scheduleId: "schedule",
          attemptId: "attempt-a",
          candidateId: "candidate",
          bootstrapSeed: { ...base, staticVersionId: version, deliveryEtag: version === "ver-2" ? '"new"' : null },
        }),
      { initialProps: { version: "ver-1" } },
    );
    await waitFor(() => expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1));
    hook.rerender({ version: "ver-2" });
    await waitFor(() => expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(2));

    await act(async () => {
      newGate.resolve({ ...bootstrap("attempt-a"), versionId: "ver-2" });
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.data?.versionId).toBe("ver-2"));
    // Late old-version resolution is a generation/revision loser: silent.
    await act(async () => {
      oldGate.resolve({ ...bootstrap("attempt-a"), versionId: "ver-1" });
      await Promise.resolve();
    });
    expect(hook.result.current.data?.versionId).toBe("ver-2");
    expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(2);
  });

  it("keeps the error surface reachable on initial failure but silent on 304", async () => {
    gatewayMocks.bootstrap.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
      }),
    );
    await waitFor(() => expect(hook.result.current.error).not.toBeNull());
    expect(hook.result.current.data).toBeNull();

    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.bootstrap.mockRejectedValueOnce(
      Object.assign(new Error("not modified"), { statusCode: 304 }),
    );
    const hook2 = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook2.result.current.error).toBeNull();
    expect(hook2.result.current.data).toBeNull();
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
