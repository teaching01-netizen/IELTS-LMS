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

const T0_MS = Date.parse(SERVER_NOW);

/** The proctor has pressed Start: one shared section clock is live. The
 * deadline is anchored to the proctor's start instant — never to a student's
 * /modules/start — while serverNow is stamped per response, the way the real
 * backend does. A response whose serverNow were frozen at T0 would hand a
 * late-fetching student a stale offset and a countdown ahead of the cohort. */
function live(attemptId: string, revision: number, runtime: CohortRuntimeState): AssessmentDeliveryBootstrap {
  // Mirrors the backend projection: a live section publishes its deadline; a
  // paused one publishes deadlineAt=null with the frozen remaining window.
  const deadlineAt =
    runtime.status === "live" && runtime.deadlineMs !== null
      ? new Date(runtime.deadlineMs).toISOString()
      : null;
  const remainingSeconds =
    runtime.status === "live"
      ? Math.max(0, Math.ceil(((runtime.deadlineMs ?? T0_MS + 120_000) - Date.now()) / 1_000))
      : runtime.status === "paused"
        ? Math.max(0, Math.ceil((runtime.pausedRemainingMs ?? 0) / 1_000))
        : 0;
  return {
    ...preStart(attemptId),
    scheduleRuntimeStatus: runtime.status,
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: "reading-writing",
      stageStatus: runtime.status === "live" ? "live" : runtime.status === "paused" ? "paused" : "not_started",
      serverNow: new Date().toISOString(),
      deadlineAt,
      remainingSeconds,
      runtimeRevision: revision,
    },
    attempt: { id: attemptId, moduleAttempts: [moduleAttempt(attemptId, false)], responses: [] },
  };
}

/** The student's own start response: their personal module clock now runs
 * from THEIR entry instant (the audit/analytics leg), while the shared section
 * deadline stays put. Under the cohort clock contract the display must ignore
 * the personal leg entirely — that is exactly what Part B asserts. */
function opened(attemptId: string, revision: number, startedAtMs: number): AssessmentDeliveryBootstrap {
  const payload = withStartedAttempt(attemptId, startedAtMs, live(attemptId, revision, cohortState));
  return payload;
}

let cohortState: CohortRuntimeState;

function withStartedAttempt(
  attemptId: string,
  startedAtMs: number,
  payload: AssessmentDeliveryBootstrap,
): AssessmentDeliveryBootstrap {
  return {
    ...payload,
    attempt: {
      id: attemptId,
      moduleAttempts: [
        {
          ...moduleAttempt(attemptId, true),
          startedAt: new Date(startedAtMs).toISOString(),
          deadlineAt: new Date(startedAtMs + 60_000).toISOString(),
          remainingSeconds: 60,
        },
      ],
      responses: [],
    },
  };
}

interface CohortRuntimeState {
  status: "not_started" | "live" | "paused";
  revision: number;
  deadlineMs: number | null;
  pausedRemainingMs: number | null;
  /** Per-student entry instants: once started, a bootstrap shows the student
   * an ACTIVE module attempt from THEIR started_at — a re-bootstrap after
   * entry must not look like a fresh waiting student (duplicate starts). */
  startedAtMs: Record<string, number>;
  starts: string[];
  conflicts: string[];
}

/**
 * One fake cohort server shared by both students: one runtime, one revision
 * counter, and a conflict log. A start before the proctor opens the exam is a
 * RUNTIME_NOT_LIVE conflict — the exact 409 the waiting room used to eat.
 * Pause freezes the shared remaining window (mirroring the backend's
 * pausedAt-anchored projection); resume re-anchors the deadline from it;
 * extend shifts the shared deadline, never a personal one.
 */
function createCohort() {
  const state: CohortRuntimeState = {
    status: "not_started",
    revision: 0,
    deadlineMs: null,
    pausedRemainingMs: null,
    startedAtMs: {},
    starts: [],
    conflicts: [],
  };
  cohortState = state;
  return {
    state,
    startProctor() {
      state.status = "live";
      state.deadlineMs = T0_MS + 120_000;
      state.revision = 1;
    },
    pause() {
      if (state.status !== "live" || state.deadlineMs === null) return;
      state.pausedRemainingMs = Math.max(0, state.deadlineMs - Date.now());
      state.status = "paused";
      state.revision += 1;
    },
    resume() {
      if (state.status !== "paused") return;
      state.deadlineMs = Date.now() + (state.pausedRemainingMs ?? 0);
      state.status = "live";
      state.revision += 1;
    },
    extend(seconds: number) {
      if (state.status === "live" && state.deadlineMs !== null) {
        state.deadlineMs += seconds * 1_000;
      } else if (state.status === "paused" && state.pausedRemainingMs !== null) {
        state.pausedRemainingMs += seconds * 1_000;
      }
      state.revision += 1;
    },
    bootstrap(_scheduleId: string, attemptId: string) {
      if (state.status === "not_started") {
        return Promise.resolve(preStart(attemptId));
      }
      const payload = live(attemptId, state.revision, state);
      const startedAt = state.startedAtMs[attemptId];
      return Promise.resolve(
        startedAt === undefined ? payload : withStartedAttempt(attemptId, startedAt, payload),
      );
    },
    startModule(_scheduleId: string, attemptId: string) {
      state.starts.push(attemptId);
      if (state.status === "not_started") {
        state.conflicts.push(attemptId);
        return Promise.reject(new Error("409 RUNTIME_NOT_LIVE"));
      }
      const startedAt = state.startedAtMs[attemptId] ?? Date.now();
      state.startedAtMs[attemptId] = startedAt;
      return Promise.resolve(opened(attemptId, state.revision, startedAt));
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

  // Part B — the cohort clock. A enters at T+0, B at T+12; each records their
  // own personal started_at (audit leg), but under the cohort clock contract
  // the DISPLAY comes from the shared section deadline for everyone. This is
  // the cross-student property: two countdowns that agree within a second no
  // matter when each student walked in, and survive refresh, continued local
  // ticking, pause, resume, and a proctor extension.
  it("shows both students the same shared clock across entry skew, refresh, pause, resume, and extension", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      const cohort = createCohort();
      cohort.startProctor();
      gatewayMocks.bootstrap.mockImplementation((scheduleId, attemptId) => cohort.bootstrap(scheduleId, attemptId));
      gatewayMocks.startModule.mockImplementation((scheduleId, attemptId) => cohort.startModule(scheduleId, attemptId));

      let token = 0;
      const wake = async () => {
        token += 1;
        studentA.rerender({ token });
        studentB.rerender({ token });
        await settle();
      };

      // A enters at ~T+0, B checks in 12 seconds later.
      const studentA = renderStudent("schedule", "attempt-a");
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_000);
      });
      const studentB = renderStudent("schedule", "attempt-b");
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      expect(studentA.result.current.state.phase).toBe("module");
      expect(studentB.result.current.state.phase).toBe("module");

      // Observed at T+20: the shared clock reads 100 for BOTH. B's personal
      // clock (started T+12 with a 60s allotment) reads ~52 — if the display
      // still mixed in the personal leg, B would show 52 and this would fail.
      expect(Math.abs(studentA.result.current.remainingSeconds - studentB.result.current.remainingSeconds)).toBeLessThanOrEqual(1);
      expect(studentA.result.current.remainingSeconds).toBe(100);

      // Refresh B against the server: convergence survives it.
      await wake();
      expect(Math.abs(studentA.result.current.remainingSeconds - studentB.result.current.remainingSeconds)).toBeLessThanOrEqual(1);
      expect(studentB.result.current.remainingSeconds).toBe(100);

      // A loses its socket and keeps ticking locally for 15s: the cohort clock
      // advances from the deadline it already has — no reset, no drift.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(Math.abs(studentA.result.current.remainingSeconds - studentB.result.current.remainingSeconds)).toBeLessThanOrEqual(1);
      expect(studentA.result.current.remainingSeconds).toBe(85);

      // Proctor pauses: the shared window freezes for both and stays frozen
      // across 10s of wall time; nobody's module expires while paused.
      cohort.pause();
      await wake();
      const frozenA = studentA.result.current.remainingSeconds;
      const frozenB = studentB.result.current.remainingSeconds;
      expect(Math.abs(frozenA - frozenB)).toBeLessThanOrEqual(1);
      expect(frozenA).toBe(85);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(studentA.result.current.remainingSeconds).toBe(frozenA);
      expect(studentB.result.current.remainingSeconds).toBe(frozenB);
      expect(gatewayMocks.submitModule).not.toHaveBeenCalled();

      // Proctor resumes: a fresh authoritative deadline reaches both and the
      // clocks continue from where the freeze left them.
      cohort.resume();
      await wake();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(Math.abs(studentA.result.current.remainingSeconds - studentB.result.current.remainingSeconds)).toBeLessThanOrEqual(1);
      expect(studentA.result.current.remainingSeconds).toBe(80);

      // Proctor extends +5 minutes: both gain exactly 300s at the same
      // observation instant.
      const beforeA = studentA.result.current.remainingSeconds;
      const beforeB = studentB.result.current.remainingSeconds;
      cohort.extend(300);
      await wake();
      const afterA = studentA.result.current.remainingSeconds;
      const afterB = studentB.result.current.remainingSeconds;
      expect(Math.abs(afterA - afterB)).toBeLessThanOrEqual(1);
      expect(afterA - beforeA).toBe(300);
      expect(afterB - beforeB).toBe(300);      studentA.unmount();
        studentB.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  // Race table, last row: a /modules/start response racing a bootstrap that
  // carries a HIGHER runtime revision. The start response is held in flight
  // while the server has already recorded the start; a proctor extension then
  // commits revision 2, which the student's refresh applies. When the stale
  // revision-1 start response finally lands, the newer revision must own the
  // state — and the student must still land in the module, because revision 2
  // reflects exactly the start the server recorded.
  it("a start response that loses a revision race still lands the student in the module at the newer revision", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      const cohort = createCohort();
      cohort.startProctor(); // revision 1

      // Hold the start response in flight while the server records the start.
      let releaseStart: (payload: AssessmentDeliveryBootstrap) => void = () => undefined;
      const heldStartResponse = new Promise<AssessmentDeliveryBootstrap>((resolve) => {
        releaseStart = resolve;
      });
      let startResponse: AssessmentDeliveryBootstrap | null = null;
      gatewayMocks.startModule.mockImplementation((scheduleId: string, attemptId: string) =>
        cohort.startModule(scheduleId, attemptId),
      );
      gatewayMocks.startModule.mockImplementationOnce(async (scheduleId: string, attemptId: string) => {
        startResponse = await cohort.startModule(scheduleId, attemptId);
        return heldStartResponse;
      });
      gatewayMocks.bootstrap.mockImplementation((scheduleId: string, attemptId: string) =>
        cohort.bootstrap(scheduleId, attemptId),
      );

      const student = renderStudent("schedule", "attempt-a");
      await settle();
      // Auto-entry fired and its response is held; the server has recorded
      // the start, but the client has not heard back yet.
      expect(cohort.state.starts).toEqual(["attempt-a"]);
      expect(student.result.current.state.phase).toBe("directions");

      // While the response is in flight, the proctor extends: revision 2.
      cohort.extend(300);

      // The student's next authoritative refresh commits revision 2 — which
      // already carries the started attempt the server recorded.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      expect(student.result.current.data?.timing.runtimeRevision).toBe(2);

      // The held start response (revision 1) finally lands, AFTER revision 2
      // is applied. The stale payload must not regress the state, and the
      // entry intent must still complete against the newer revision.
      await act(async () => {
        releaseStart(startResponse as AssessmentDeliveryBootstrap);
        await heldStartResponse;
      });
      await settle();

      expect(student.result.current.data?.timing.runtimeRevision).toBe(2);
      expect(student.result.current.state.phase).toBe("module");
      expect(cohort.state.conflicts).toEqual([]);

      student.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
