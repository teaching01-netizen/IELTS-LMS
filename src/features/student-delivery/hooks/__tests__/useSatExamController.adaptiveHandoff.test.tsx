import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * Reload at the exact adaptive handoff (plan rigorous test 6) + question
 * ownership (test 9) + atomic start-module commit (test 10).
 *
 * The payload carries ONLY the assigned Module 2 branch (the server's
 * delivered-branch fence drops the other branch's modules entirely), with the
 * SAME business `moduleKey` as the dropped one. The server routed HIGH, so
 * only HIGH has a module attempt and LOW must never be opened, rendered, or
 * answered — a legacy/leaked payload that still carries LOW is covered by a
 * separate case below. The browser "reloads" by mounting the controller fresh
 * on this payload.
 *
 *   M1 expired -> server created AND ACTIVATED HIGH attempt (atomic) ->
 *   reload sees HIGH active
 *   => pendingModule.id == HIGH, adaptiveRole == higher_branch
 *   => zero POST /modules/start (server-driven, never LOW)
 *   => every rendered question belongs to HIGH, none to LOW
 *   => no render ever pairs new payload data with an old module identity
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

/** M1 expired on its own clock; HIGH routed AND activated atomically; LOW attempt-free. */
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
          branchModule(HIGH_ID, "higher_branch", ["high-q-1", "high-q-2"]),
        ],
      },
    ],
    attempt: {
      id: ATTEMPT_ID,
      moduleAttempts: [expiredAttempt(M1_ID), activeAttempt(HIGH_ID)],
      responses: [],
    },
    result: null,
  } as unknown as AssessmentDeliveryBootstrap;
}

/**
 * A legacy/leaked payload: the routed handoff plus the OTHER branch's module.
 * The client must still refuse to open LOW — server-side filtering is the
 * primary fence, this is the client-side backstop for a cached or older build.
 */
function leakedBootstrap(): AssessmentDeliveryBootstrap {
  const payload = handoffBootstrap();
  payload.sections[0].modules.splice(1, 0, branchModule(LOW_ID, "lower_branch", ["low-q-1"]));
  return payload;
}

/**
 * Before the handoff: Module 1 is the only module with an attempt row, so it
 * is the only module the fixed server delivers. Carries the SAME schedule-wide
 * runtimeRevision as the routed payload — that is the defect: only per-row
 * revisions can order these two.
 */
function preHandoffBootstrap(): AssessmentDeliveryBootstrap {
  const payload = handoffBootstrap();
  payload.sections = [
    {
      ...payload.sections[0],
      modules: payload.sections[0].modules.filter((module) => module.id === M1_ID),
    },
  ];
  payload.attempt = { ...payload.attempt, moduleAttempts: [activeAttempt(M1_ID)] };
  return payload;
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function bootstrapSeedFor(staticVersionId: string) {
  return {
    scheduleId: "schedule",
    attemptId: ATTEMPT_ID,
    candidateId: "candidate",
    attemptSnapshot: null,
    runtimeSnapshot: null,
    liveSnapshotReceivedAt: null,
    staticVersionId,
    attemptRevision: null,
    runtimeRevision: null,
    seedGeneration: 1,
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
    gatewayMocks.state.mockReset();
    gatewayMocks.startModule.mockReset();
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
    gatewayMocks.configureSatDeliveryAttempt.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    // The recovery poll must not race these cases unless a test opts in: an
    // in-flight state read that never settles keeps the poll cadence quiet
    // without producing a rejection.
    gatewayMocks.state.mockImplementation(() => new Promise(() => undefined));
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

    // Server-driven: zero client mutations for M1→M2 — never LOW, never even HIGH.
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(gatewayMocks.startModule).not.toHaveBeenCalled();

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

  it("never opens LOW even when a leaked payload still carries it", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(leakedBootstrap());

    const seen: Array<{ phase: string; moduleId: string | null }> = [];
    const hook = renderController(seen);
    await waitFor(() => expect(hook.result.current.pendingModule?.id).toBe(HIGH_ID));
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));

    expect(hook.result.current.stateModule?.id).toBe(HIGH_ID);
    const rendered = (hook.result.current.stateModule?.questions ?? []).map(
      (q) => q.examQuestionId,
    );
    expect(rendered).not.toContain("low-q-1");
    for (const frame of seen) {
      if (frame.phase === "module" || frame.phase === "review") {
        expect(frame.moduleId).toBe(HIGH_ID);
      }
    }
    hook.unmount();
  });

  it("drops an older payload at the SAME runtimeRevision (attempt-scoped guard)", async () => {
    const handoff = handoffBootstrap();
    gatewayMocks.bootstrap.mockResolvedValue(preHandoffBootstrap());

    const hook = renderController([]);
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.state.phase === "module" && hook.result.current.state.moduleId).toBe(
      M1_ID,
    );

    // The handoff arrives: same schedule-wide runtimeRevision, newer per-row
    // revisions. It must be accepted.
    expect(await hook.result.current.commitForTest(handoff)).toBe(true);
    await waitFor(() =>
      expect(hook.result.current.state.phase === "module" && hook.result.current.state.moduleId).toBe(
        HIGH_ID,
      ),
    );
    const afterHandoff = hook.result.current.data;

    // The pre-handoff snapshot arrives late — identical runtimeRevision, so
    // the schedule-wide guard cannot order the two.
    const stale = preHandoffBootstrap();
    expect(stale.timing.runtimeRevision).toBe(handoff.timing.runtimeRevision);
    expect(await hook.result.current.commitForTest(stale)).toBe(false);

    expect(hook.result.current.data).toBe(afterHandoff);
    expect(
      hook.result.current.state.phase === "module" && hook.result.current.state.moduleId,
    ).toBe(HIGH_ID);
    expect(hook.result.current.stateModule?.id).toBe(HIGH_ID);
    hook.unmount();
  });

  it("commits a break-only advance at the same runtime revision", async () => {
    const initial = handoffBootstrap();
    gatewayMocks.bootstrap.mockResolvedValue(initial);
    const hook = renderController([]);
    await waitFor(() => expect(hook.result.current.data).toBe(initial));

    const advanced = structuredClone(initial);
    advanced.attempt.personalBreaks = [{
      id: "break-1",
      afterSectionId: "section-rw",
      durationSeconds: 600,
      state: "active",
      startsAt: SERVER_NOW,
      deadlineAt: new Date(Date.parse(SERVER_NOW) + 600_000).toISOString(),
      enteredAt: SERVER_NOW,
      pausedAt: null,
      accumulatedPausedSeconds: 0,
      entryGeneration: 1,
      entryStartsAt: SERVER_NOW,
      entryConfirmedAt: SERVER_NOW,
      entryEnteredAt: SERVER_NOW,
      remainingSeconds: 600,
      revision: 2,
    }];
    expect(advanced.timing.runtimeRevision).toBe(initial.timing.runtimeRevision);
    act(() => {
      expect(hook.result.current.commitForTest(advanced)).toBe(true);
    });
    await waitFor(() => expect(hook.result.current.data?.attempt.personalBreaks).toEqual(advanced.attempt.personalBreaks));
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

  // The guard must hold on the async path too, where the payloads arrive out of
  // request order: a slow Module 1 bootstrap must not undo a fast handoff that
  // landed first. Both requests share one schedule-wide runtimeRevision, so only
  // the attempt-scoped revisions can order them.
  it("applies two in-flight bootstraps in reverse order without regressing", async () => {
    const older = preHandoffBootstrap();
    const newer = handoffBootstrap();
    const first = deferred<AssessmentDeliveryBootstrap>();
    const second = deferred<AssessmentDeliveryBootstrap>();
    gatewayMocks.bootstrap
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const hook = renderHook(
      ({ staticVersionId }: { staticVersionId: string }) =>
        useSatExamController({
          scheduleId: "schedule",
          attemptId: ATTEMPT_ID,
          candidateId: "candidate",
          attemptUpdateToken: 0,
          liveSocketConnected: false,
          bootstrapSeed: bootstrapSeedFor(staticVersionId),
        }),
      { initialProps: { staticVersionId: "version-a" } },
    );

    await waitFor(() => expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1));
    // A republish refires the bootstrap effect: the second request is in flight
    // while the first is still pending.
    hook.rerender({ staticVersionId: "version-b" });
    await waitFor(() => expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(2));

    // The NEWER payload wins the race.
    await act(async () => {
      second.resolve(newer);
    });
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.data).toBe(newer);

    // The older request finally answers. It must be dropped: a module that is
    // already locked cannot come back, and HIGH cannot vanish from the attempt.
    await act(async () => {
      first.resolve(older);
    });
    await waitFor(() =>
      expect(hook.result.current.state.phase === "module" && hook.result.current.state.moduleId).toBe(
        HIGH_ID,
      ),
    );
    expect(hook.result.current.data).toBe(newer);
    expect(hook.result.current.stateModule?.id).toBe(HIGH_ID);
    hook.unmount();
  });

  // The state endpoint answers without the immutable question tree, so when it
  // reveals a module attempt the retained sections do not know about (adaptive
  // routing just seeded a branch), the client must fetch the whole tree exactly
  // once — not per poll, and never by rendering the unknown module.
  it("re-runs exactly one full bootstrap when the state read reports an unknown module", async () => {
    gatewayMocks.bootstrap
      .mockResolvedValueOnce(preHandoffBootstrap())
      .mockResolvedValueOnce(handoffBootstrap());
    gatewayMocks.state.mockResolvedValue(handoffBootstrap());

    const seen: Array<{ phase: string; moduleId: string | null }> = [];
    const hook = renderHook(
      ({ token }: { token: number }) => {
        const controller = useSatExamController({
          scheduleId: "schedule",
          attemptId: ATTEMPT_ID,
          candidateId: "candidate",
          attemptUpdateToken: token,
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
      },
      { initialProps: { token: 0 } },
    );

    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.state.phase === "module" && hook.result.current.state.moduleId).toBe(
      M1_ID,
    );
    expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1);

    // A pull reveals the routed module attempt absent from the retained tree.
    hook.rerender({ token: 1 });
    await waitFor(() =>
      expect(hook.result.current.state.phase === "module" && hook.result.current.state.moduleId).toBe(
        HIGH_ID,
      ),
    );

    expect(gatewayMocks.state).toHaveBeenCalled();
    expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(2);
    // No frame ever rendered the unknown module by identity.
    for (const frame of seen) {
      if (frame.phase === "module" || frame.phase === "review") {
        expect([M1_ID, HIGH_ID]).toContain(frame.moduleId);
      }
    }
    hook.unmount();
  });
});
