import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap, AssessmentResponseSnapshot } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * Phase 04 convergence suite (T2/T5/T6/T7/T8 per phase-04 §8).
 * T3 skew-hold lives route-side in
 * routes/__tests__/SatStudentSessionRoute.skew.test.tsx.
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function payload(attemptId = "attempt-a"): AssessmentDeliveryBootstrap {
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
    attempt: { id: attemptId, moduleAttempts: [], responses: [] },
    result: null,
  };
}

function modulePayload(opts: {
  currentModuleId: string;
  currentModuleKey: string;
  currentState: string;
  nextModuleId?: string;
  nextModuleKey?: string;
}): AssessmentDeliveryBootstrap {
  const p = payload();
  const now = new Date().toISOString();
  p.sections = [
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
          id: opts.currentModuleId,
          moduleKey: opts.currentModuleKey,
          title: "Current",
          displayOrder: 0,
          durationSeconds: 60,
          targetQuestionCount: 1,
          adaptiveRole: "base",
          instructions: { version: 1, nodes: [] },
          toolPolicy: [],
          questions: [
            {
              examQuestionId: "q1",
              questionId: "q1",
              displayOrder: 0,
              isPretest: false,
              questionType: "single_choice",
              stimulus: { version: 1, nodes: [] },
              prompt: { version: 1, nodes: [] },
              answer: {
                kind: "single_choice",
                options: ["A", "B"].map((id) => ({
                  id,
                  content: { version: 1, nodes: [] },
                })),
              },
              metadata: {
                sectionKey: "reading-writing",
                domain: null,
                skill: null,
                difficulty: "medium",
                tags: [],
              },
              accessibility: { longDescription: null },
            },
          ],
        },
        ...(opts.nextModuleId
          ? [
              {
                id: opts.nextModuleId,
                moduleKey: opts.nextModuleKey ?? opts.nextModuleId,
                title: "Next",
                displayOrder: 1,
                durationSeconds: 60,
                targetQuestionCount: 1,
                adaptiveRole: "higher_branch",
                instructions: { version: 1, nodes: [] },
                toolPolicy: [],
                questions: [],
              },
            ]
          : []),
      ],
    },
  ];
  p.attempt.moduleAttempts = [
    {
      id: "ma-current",
      moduleId: opts.currentModuleId,
      state: opts.currentState,
      allocatedSeconds: 60,
      availableAt: null,
      startedAt: now,
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
    ...(opts.nextModuleId
      ? [
          {
            id: "ma-next",
            moduleId: opts.nextModuleId,
            state: "not_started",
            allocatedSeconds: 60,
            availableAt: null,
            startedAt: null,
            pausedAt: null,
            accumulatedPausedSeconds: 0,
            extensionSeconds: 0,
            deadlineAt: null,
            remainingSeconds: null,
            completionReason: null,
            rawCorrect: null,
            operationalQuestionCount: null,
            toolState: {},
            revision: 1,
          },
        ]
      : []),
  ];
  return p;
}

function runtimeResponse(overrides: Record<string, unknown> = {}): AssessmentResponseSnapshot {
  return {
    id: "v2:q1",
    moduleAttemptId: "ma-current",
    examQuestionId: "q1",
    response: "A",
    markedForReview: false,
    eliminatedOptions: [],
    annotations: {},
    revision: 7,
    ...overrides,
  } as unknown as AssessmentResponseSnapshot;
}

describe("useSatExamController convergence (Phase 04)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.configureSatDeliveryAttempt.mockReset();
    gatewayMocks.startModule.mockReset();
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
    persistenceMock.hydrateBootstrap.mockReset();
    persistenceMock.visibleDrafts = {};
    persistenceMock.pendingDrafts = {};
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.submit.mockResolvedValue({} as never);
  });

  it("T2a: bootstrap commits data+directions in one update (no data-with-loading frame)", async () => {
    const gate = deferred<AssessmentDeliveryBootstrap>();
    gatewayMocks.bootstrap.mockImplementation(() => gate.promise);
    const seen: { dataNull: boolean; phase: string }[] = [];
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
      }),
    );
    seen.push({
      dataNull: hook.result.current.data == null,
      phase: hook.result.current.state.phase,
    });
    await act(async () => {
      gate.resolve(payload());
      await gate.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    seen.push({
      dataNull: hook.result.current.data == null,
      phase: hook.result.current.state.phase,
    });
    expect(hook.result.current.state.phase).toBe("directions");
    // No committed frame may pair a new payload with the old loading phase
    // when the transition was knowable synchronously (C1).
    expect(seen).not.toContainEqual({ dataNull: false, phase: "loading" });
  });

  it("T2b: poll carrying a finalized current module + different pending dispatches showDirections synchronously", async () => {
    const first = modulePayload({
      currentModuleId: "m-1",
      currentModuleKey: "rw-m1",
      currentState: "active",
    });
    gatewayMocks.bootstrap.mockResolvedValueOnce(first);
    gatewayMocks.startModule.mockImplementation(async () =>
      modulePayload({
        currentModuleId: "m-1",
        currentModuleKey: "rw-m1",
        currentState: "active",
      }),
    );
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
      }),
    );
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    // Bootstrap commits data+phase atomically; the mock bootstrap carries
    // no active attempt, so the safety-net auto-route may not have fired —
    // drive module entry explicitly through the atomic start path.
    await act(async () => {
      await hook.result.current.commands.startPendingModule();
    });
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    // Poll-hint commit carrying the finalized predicate: data + phase must
    // advance in the same tick (no second tick needed for showDirections).
    const finalized = modulePayload({
      currentModuleId: "m-1",
      currentModuleKey: "rw-m1",
      currentState: "submitted",
      nextModuleId: "m-2",
      nextModuleKey: "rw-m2",
    });
    finalized.timing.runtimeRevision = 2;
    const hookWithSeam = hook.result.current as unknown as {
      commitForTest: (p: AssessmentDeliveryBootstrap) => boolean;
    };
    act(() => {
      expect(hookWithSeam.commitForTest(finalized)).toBe(true);
    });
    expect(hook.result.current.data?.timing.runtimeRevision).toBe(2);
    expect(hook.result.current.state.phase).toBe("directions");
  });

  it("T5a: three consecutive identical polls are no-ops (data ref + clock stable)", async () => {
    const frozen = new Date("2026-09-10T08:00:00.000Z").toISOString();
    const mk = () => {
      const p = payload();
      p.serverNow = frozen;
      p.timing.serverNow = frozen;
      return p;
    };
    gatewayMocks.bootstrap.mockResolvedValue(mk());
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        liveSocketConnected: true,
      }),
    );
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    const firstData = hook.result.current.data;
    const firstRemaining = hook.result.current.remainingSeconds;
    // Three identical polls (same bytes, new object identity): the commit
    // layer must skip all state writes (C3) — data ref + countdown stable.
    const hookWithSeam = () =>
      hook.result.current as unknown as {
        commitForTest: (p: AssessmentDeliveryBootstrap) => boolean;
      };
    act(() => {
      expect(hookWithSeam().commitForTest(structuredClone(mk()))).toBe(false);
    });
    act(() => {
      expect(hookWithSeam().commitForTest(structuredClone(mk()))).toBe(false);
    });
    act(() => {
      expect(hookWithSeam().commitForTest(structuredClone(mk()))).toBe(false);
    });
    expect(hook.result.current.data).toBe(firstData);
    expect(hook.result.current.remainingSeconds).toBe(firstRemaining);
  });

  it("hydrates the complete V2 response aggregate into the active module", async () => {
    const first = modulePayload({
      currentModuleId: "m-1",
      currentModuleKey: "rw-m1",
      currentState: "active",
    });
    first.attempt.responses = [
      runtimeResponse({
        response: "A",
        markedForReview: true,
        eliminatedOptions: ["B"],
        annotations: {
          version: 2,
          annotations: [],
          legacyQuestionNote: "Compare the evidence",
        },
      }),
    ];
    gatewayMocks.bootstrap.mockResolvedValue(first);
    gatewayMocks.startModule.mockResolvedValue(first);
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
      }),
    );
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    await act(async () => {
      await hook.result.current.commands.startPendingModule();
    });
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.state.responses.q1).toMatchObject({
      answer: "A",
      markedForReview: true,
      eliminatedOptionIds: ["B"],
      annotations: {
        version: 2,
        annotations: [],
        legacyQuestionNote: "Compare the evidence",
      },
    });
  });

  it.each([
    {
      label: "missing optional fields",
      response: { response: "B", markedForReview: false, eliminatedOptions: undefined, annotations: undefined },
    },
    {
      label: "null optional fields",
      response: { response: "C", markedForReview: true, eliminatedOptions: null, annotations: null },
    },
  ])("defaults $label during module hydration", async ({ response }) => {
    const bootstrap = modulePayload({
      currentModuleId: "m-1",
      currentModuleKey: "rw-m1",
      currentState: "not_started",
    });
    const started = modulePayload({
      currentModuleId: "m-1",
      currentModuleKey: "rw-m1",
      currentState: "active",
    });
    bootstrap.attempt.responses = [runtimeResponse(response)];
    started.attempt.responses = bootstrap.attempt.responses;
    gatewayMocks.bootstrap.mockResolvedValue(bootstrap);
    gatewayMocks.startModule.mockResolvedValue(started);
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
      }),
    );
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    let outcome: Awaited<ReturnType<typeof hook.result.current.commands.startPendingModule>>;
    await act(async () => {
      outcome = await hook.result.current.commands.startPendingModule();
    });
    expect(outcome).toBe("opened");
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.state.responses.q1).toMatchObject({
      answer: response.response,
      markedForReview: response.markedForReview,
      eliminatedOptionIds: [],
      annotations: {
        version: 2,
        annotations: [],
        legacyQuestionNote: "",
      },
    });
  });

  it("keeps a newer visible local draft ahead of a stale bootstrap response", async () => {
    const first = modulePayload({
      currentModuleId: "m-1",
      currentModuleKey: "rw-m1",
      currentState: "active",
    });
    first.attempt.responses = [runtimeResponse({ response: "server-stale", revision: 2 })];
    persistenceMock.visibleDrafts = {
      q1: {
        questionId: "q1",
        answer: "local-newer",
        markedForReview: true,
        eliminatedOptionIds: ["B"],
        annotations: {
          version: 2,
          annotations: [],
          legacyQuestionNote: "local note",
        },
      },
    };
    gatewayMocks.bootstrap.mockResolvedValue(first);
    gatewayMocks.startModule.mockResolvedValue(first);
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
      }),
    );
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    await act(async () => {
      await hook.result.current.commands.startPendingModule();
    });
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.state.responses.q1).toMatchObject({
      answer: "local-newer",
      markedForReview: true,
      eliminatedOptionIds: ["B"],
      annotations: {
        legacyQuestionNote: "local note",
      },
    });
  });

  it("T5b: no bootstrap read is conditional, so a 304-shaped failure is a visible contract break", async () => {
    // The runner used to send a version-scoped If-None-Match and treat a 304 as
    // "nothing changed". That silently rehydrated the pre-routing module after
    // the server had already selected Module 2 Higher, so the conditional read
    // is gone: bootstrap is always an unconditional attempt-state read, and the
    // mock asserts the call shape rather than swallowing a 304.
    gatewayMocks.bootstrap.mockRejectedValueOnce(
      Object.assign(new Error("not modified"), { statusCode: 304 }),
    );
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(gatewayMocks.bootstrap).toHaveBeenCalledWith("schedule", "attempt-a");
    expect(hook.result.current.error).not.toBeNull();
    expect(hook.result.current.data).toBeNull();
  });

  it("T8: candidateId swap mid-bootstrap drops the late first-identity payload", async () => {
    // Route the in-flight bootstrap by candidate: candidate-1 in flight,
    // candidate-2 resolves first, late candidate-1 must drop.
    const first = deferred<AssessmentDeliveryBootstrap>();
    const second = deferred<AssessmentDeliveryBootstrap>();
    let currentCandidate = "candidate-1";
    gatewayMocks.bootstrap.mockImplementation(() =>
      currentCandidate === "candidate-1" ? first.promise : second.promise,
    );
    const hook = renderHook(
      ({ candidateId }: { candidateId: string }) =>
        useSatExamController({
          scheduleId: "schedule",
          attemptId: "attempt-a",
          candidateId,
        }),
      { initialProps: { candidateId: "candidate-1" } },
    );
    await waitFor(() => expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1));
    currentCandidate = "candidate-2";
    hook.rerender({ candidateId: "candidate-2" });
    await waitFor(() => expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve(payload());
      await second.promise;
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.data?.attempt.id).toBe("attempt-a"));
    await act(async () => {
      first.resolve(payload());
      await first.promise;
      await Promise.resolve();
    });
    expect(hook.result.current.data?.attempt.id).toBe("attempt-a");
    expect(hook.result.current.state.candidateId).toBe("candidate-2");
  });

  it("T6: phase transitions do not reset the poll cadence (stable loop deps)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T08:00:00.000Z"));
    const first = modulePayload({
      currentModuleId: "m-1",
      currentModuleKey: "rw-m1",
      currentState: "active",
    });
    gatewayMocks.bootstrap.mockResolvedValue(first);
    gatewayMocks.startModule.mockImplementation(async () =>
      modulePayload({
        currentModuleId: "m-1",
        currentModuleKey: "rw-m1",
        currentState: "active",
      }),
    );
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        liveSocketConnected: true,
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const bootstrapCalls = gatewayMocks.bootstrap.mock.calls.length;
    // Drive directions -> module -> review without wall-clock advancing:
    // no phase transition may fire a bootstrap by itself.
    await act(async () => {
      await hook.result.current.commands.startPendingModule();
    });
    persistenceMock.flush.mockClear();
    act(() => {
      hook.result.current.commands.reviewModule();
    });
    expect(persistenceMock.flush).toHaveBeenCalledTimes(1);
    act(() => {
      hook.result.current.commands.returnToModule();
    });
    expect(persistenceMock.flush).toHaveBeenCalledTimes(2);
    expect(gatewayMocks.bootstrap.mock.calls.length).toBe(bootstrapCalls);
    hook.unmount();
    vi.useRealTimers();
  });

  it("T7: a resolved zero-time frame freezes answers, flushes saves, and reconciles without submitting", async () => {
    const p = modulePayload({
      currentModuleId: "m-1",
      currentModuleKey: "rw-m1",
      currentState: "active",
    });
    p.attempt.moduleAttempts[0].remainingSeconds = 0;
    p.attempt.moduleAttempts[0].deadlineAt = new Date(Date.now() - 1000).toISOString();
    p.attempt.moduleAttempts[0].startedAt = new Date(Date.now() - 120_000).toISOString();
    gatewayMocks.bootstrap.mockResolvedValue(p);
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
      }),
    );
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    // Resolve the pending-module entry so the zero-time active frame is live.
    gatewayMocks.startModule.mockImplementation(async () => p);
    await act(async () => {
      await hook.result.current.commands.startPendingModule();
    });
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    await waitFor(() => expect(persistenceMock.flush).toHaveBeenCalled());
    expect(hook.result.current.answerInteractionBlocked).toBe(true);
    expect("submitModule" in hook.result.current.commands).toBe(false);
    expect(gatewayMocks.submitModule).not.toHaveBeenCalled();
    expect(gatewayMocks.bootstrap.mock.calls.length).toBeGreaterThan(1);
  });

  it("identity: state.candidateId equals the candidate prop after bootstrap", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(payload());
    const hook = renderHook(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate-9",
      }),
    );
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    expect(hook.result.current.state.candidateId).toBe("candidate-9");
  });
});
