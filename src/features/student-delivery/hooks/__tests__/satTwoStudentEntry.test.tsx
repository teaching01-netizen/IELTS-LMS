import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * Two-student waiting-room convergence (Part A).
 *
 * The release-blocking property of this work is not "one API returned 200" but
 * "two students who checked in at different times both sit still until the
 * proctor starts once, and then both enter without touching anything". A single
 * student cannot prove that, because the failure mode is cohort-wide: the
 * pre-start projection used to say `live`, so every waiting student opened the
 * entry gate and hammered /modules/start with 409 RUNTIME_NOT_LIVE.
 *
 * This drives TWO controllers against one shared fake cohort so the assertion
 * is about the cohort, not one client. Timers are not compared here — shared
 * countdown semantics are a separate change (Part B).
 *
 * The fake server REFUSES a start while the runtime is not live (mirroring the
 * backend's RUNTIME_NOT_LIVE conflict), so a regressed entry gate cannot pass
 * this test silently: it would surface as a recorded conflict instead of an
 * absence of calls.
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
  useSatIntegrityControl: () => undefined,
}));

const SERVER_NOW = new Date("2026-09-10T08:00:00.000Z").toISOString();
const MODULE_RW = "module-rw";

type DeliveredSection = AssessmentDeliveryBootstrap["sections"][number];
type ModuleAttempt = AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"][number];

function rwSection(): DeliveredSection {
  return {
    id: "section-rw",
    sectionKey: "reading-writing",
    title: "Reading and Writing",
    displayOrder: 0,
    durationSeconds: 120,
    breakAfterSeconds: 0,
    instructions: { version: 1, nodes: [] },
    modules: [
      {
        id: MODULE_RW,
        moduleKey: MODULE_RW,
        title: "Reading and Writing Module 1",
        displayOrder: 0,
        durationSeconds: 60,
        targetQuestionCount: 1,
        adaptiveRole: "base",
        instructions: { version: 1, nodes: [] },
        toolPolicy: [],
        questions: [],
      },
    ],
  };
}

function moduleAttempt(attemptId: string, live: boolean): ModuleAttempt {
  return {
    id: `ma-${attemptId}`,
    moduleId: MODULE_RW,
    state: live ? "active" : "not_started",
    allocatedSeconds: 60,
    availableAt: SERVER_NOW,
    startedAt: live ? SERVER_NOW : null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: live ? new Date(Date.parse(SERVER_NOW) + 60_000).toISOString() : null,
    remainingSeconds: 60,
    completionReason: null,
    rawCorrect: null,
    operationalQuestionCount: null,
    toolState: {},
    revision: live ? 2 : 1,
  };
}

/** The real pre-start payload: no runtime row yet on the server. */
function preStart(attemptId: string): AssessmentDeliveryBootstrap {
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow: SERVER_NOW,
    candidateName: `Candidate ${attemptId}`,
    scheduleRuntimeStatus: "not_started",
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: null,
      stageStatus: "not_started",
      serverNow: SERVER_NOW,
      deadlineAt: null,
      remainingSeconds: 0,
      runtimeRevision: 0,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [rwSection()],
    attempt: { id: attemptId, moduleAttempts: [moduleAttempt(attemptId, false)], responses: [] },
    result: null,
  };
}

/** The proctor has pressed Start: one shared section clock is live. */
function live(attemptId: string, revision: number): AssessmentDeliveryBootstrap {
  return {
    ...preStart(attemptId),
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: "reading-writing",
      stageStatus: "live",
      serverNow: SERVER_NOW,
      deadlineAt: new Date(Date.parse(SERVER_NOW) + 120_000).toISOString(),
      remainingSeconds: 120,
      runtimeRevision: revision,
    },
    attempt: { id: attemptId, moduleAttempts: [moduleAttempt(attemptId, false)], responses: [] },
  };
}

function opened(attemptId: string, revision: number): AssessmentDeliveryBootstrap {
  return {
    ...live(attemptId, revision),
    attempt: { id: attemptId, moduleAttempts: [moduleAttempt(attemptId, true)], responses: [] },
  };
}

/**
 * One fake cohort server shared by both students: one runtime, one revision
 * counter, and a conflict log. A start before the proctor opens the exam is a
 * RUNTIME_NOT_LIVE conflict — the exact 409 the waiting room used to eat.
 */
function createCohort() {
  const state = {
    live: false,
    revision: 0,
    starts: [] as string[],
    conflicts: [] as string[],
  };
  return {
    state,
    startProctor() {
      state.live = true;
      state.revision = 1;
    },
    bootstrap(_scheduleId: string, attemptId: string) {
      return Promise.resolve(state.live ? live(attemptId, state.revision) : preStart(attemptId));
    },
    startModule(_scheduleId: string, attemptId: string) {
      state.starts.push(attemptId);
      if (!state.live) {
        state.conflicts.push(attemptId);
        return Promise.reject(new Error("409 RUNTIME_NOT_LIVE"));
      }
      return Promise.resolve(opened(attemptId, state.revision));
    },
  };
}

function renderStudent(scheduleId: string, attemptId: string) {
  return renderHook(
    ({ token }: { token: number }) =>
      useSatExamController({
        scheduleId,
        attemptId,
        candidateId: `candidate-${attemptId}`,
        attemptUpdateToken: token,
        liveSocketConnected: false,
      }),
    { initialProps: { token: 0 } },
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

describe("SAT two-student waiting-room convergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.startModule.mockReset();
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
    gatewayMocks.configureSatDeliveryAttempt.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.submit.mockResolvedValue({} as never);
  });

  it("keeps both students waiting, then opens both on one proctor start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      const cohort = createCohort();
      gatewayMocks.bootstrap.mockImplementation((scheduleId, attemptId) => cohort.bootstrap(scheduleId, attemptId));
      gatewayMocks.startModule.mockImplementation((scheduleId, attemptId) => cohort.startModule(scheduleId, attemptId));

      // Student A checks in first, B several seconds later.
      const studentA = renderStudent("schedule", "attempt-a");
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      const studentB = renderStudent("schedule", "attempt-b");
      await settle();

      // Neither may ask to start while the exam is closed — this is the window
      // that used to produce a 409 per retry window per student. Asserted
      // BEFORE the payload echoes below, so a regressed projection fails this
      // test on the behaviour it broke rather than on a fixture mismatch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(gatewayMocks.startModule).not.toHaveBeenCalled();
      expect(cohort.state.conflicts).toEqual([]);
      expect(studentA.result.current.state.phase).toBe("directions");
      expect(studentB.result.current.state.phase).toBe("directions");

      expect(studentA.result.current.data?.scheduleRuntimeStatus).toBe("not_started");
      expect(studentB.result.current.data?.scheduleRuntimeStatus).toBe("not_started");

      // The proctor presses Start once.
      cohort.startProctor();
      studentA.rerender({ token: 1 });
      studentB.rerender({ token: 1 });
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      // Both open the same module automatically, exactly once each, with no
      // manual step and no conflict.
      expect(cohort.state.conflicts).toEqual([]);
      expect(cohort.state.starts).toEqual(["attempt-a", "attempt-b"]);
      expect(gatewayMocks.startModule).toHaveBeenCalledTimes(2);
      expect(studentA.result.current.state.phase).toBe("module");
      expect(studentB.result.current.state.phase).toBe("module");
      expect(studentA.result.current.error).toBeNull();
      expect(studentB.result.current.error).toBeNull();

      studentA.unmount();
      studentB.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets the later student in without a second start for the earlier one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      const cohort = createCohort();
      cohort.startProctor();
      gatewayMocks.bootstrap.mockImplementation((scheduleId, attemptId) => cohort.bootstrap(scheduleId, attemptId));
      gatewayMocks.startModule.mockImplementation((scheduleId, attemptId) => cohort.startModule(scheduleId, attemptId));

      const studentA = renderStudent("schedule", "attempt-a");
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(studentA.result.current.state.phase).toBe("module");

      // B checks in late, after the exam is already live.
      const studentB = renderStudent("schedule", "attempt-b");
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });

      expect(studentB.result.current.state.phase).toBe("module");
      expect(cohort.state.conflicts).toEqual([]);
      // A entered once and was not re-entered by B's arrival.
      expect(cohort.state.starts).toEqual(["attempt-a", "attempt-b"]);

      studentA.unmount();
      studentB.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
