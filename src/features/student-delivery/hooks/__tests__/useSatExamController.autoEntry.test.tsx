import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * Auto-entry coverage for the SAT controller.
 *
 * The entry policy itself is unit-tested in domain/satDomain.test.ts
 * (deriveSatEntryDecision); what this file covers is the wiring: that the
 * controller actually calls startModule with no student action when the
 * proctor makes the runtime live, and when the authoritative break ends.
 *
 * The last two cases pin the dedupe-key contract: an entry attempt is only
 * terminal once the module actually opened. Before this was fixed, the
 * initial-entry key was consumed BEFORE the start was known to have happened,
 * so one failed or inert attempt disabled auto-entry for that module
 * permanently and the student had to press the manual button. Both cases are
 * now plain tests and will fail again if the key is ever consumed optimistically.
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
const MODULE_MATH = "module-math";
const ATTEMPT_ID = "attempt-a";

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

function mathSection(): DeliveredSection {
  return {
    id: "section-math",
    sectionKey: "math",
    title: "Math",
    displayOrder: 1,
    durationSeconds: 120,
    breakAfterSeconds: 0,
    instructions: { version: 1, nodes: [] },
    modules: [
      {
        id: MODULE_MATH,
        moduleKey: MODULE_MATH,
        title: "Math Module 1",
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

function notStarted(moduleId: string): ModuleAttempt {
  return {
    id: `ma-${moduleId}`,
    moduleId,
    state: "not_started",
    allocatedSeconds: 60,
    availableAt: SERVER_NOW,
    startedAt: null,
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
  };
}

function active(moduleId: string): ModuleAttempt {
  return {
    ...notStarted(moduleId),
    state: "active",
    startedAt: SERVER_NOW,
    deadlineAt: new Date(Date.parse(SERVER_NOW) + 60_000).toISOString(),
    revision: 2,
  };
}

function submitted(moduleId: string): ModuleAttempt {
  return {
    ...notStarted(moduleId),
    state: "submitted",
    startedAt: SERVER_NOW,
    remainingSeconds: 0,
    completionReason: "student_submit",
    revision: 2,
  };
}

/**
 * Module-advance fixtures (module-advance fix).
 *
 * Module 2 is the adaptive branch module the server creates in the same
 * transaction that scores Module 1 and writes its routing decision. Whether the
 * automatic path opens it depends on the module before it ending on its own
 * clock, which the payload carries as a deadline already behind serverNow —
 * `completionReason` cannot express it, because the client's own expiry submit
 * is recorded as `student_submit`.
 */
const MODULE_RW_M2 = "module-rw-m2";

function rwBranchModule(role: "lower_branch" | "higher_branch"): DeliveredSection["modules"][number] {
  return {
    id: MODULE_RW_M2,
    moduleKey: MODULE_RW_M2,
    title:
      role === "higher_branch"
        ? "Reading and Writing Module 2 - Higher"
        : "Reading and Writing Module 2 - Lower",
    displayOrder: 1,
    durationSeconds: 60,
    targetQuestionCount: 1,
    adaptiveRole: role,
    instructions: { version: 1, nodes: [] },
    toolPolicy: [],
    questions: [],
  };
}

function rwSectionWithBranch(role: "lower_branch" | "higher_branch"): DeliveredSection {
  const section = rwSection();
  return { ...section, modules: [...section.modules, rwBranchModule(role)] };
}

/** Module 1 closed by its own clock: its deadline is already behind serverNow. */
function endedByOwnClock(moduleId: string): ModuleAttempt {
  return {
    ...submitted(moduleId),
    deadlineAt: new Date(Date.parse(SERVER_NOW) - 5_000).toISOString(),
  };
}

/** Module 1 submitted with time left: its own deadline is still ahead. */
function submittedEarly(moduleId: string): ModuleAttempt {
  return {
    ...submitted(moduleId),
    deadlineAt: new Date(Date.parse(SERVER_NOW) + 600_000).toISOString(),
  };
}

/** Module 2 open and already past its own deadline: the timeout runs out. */
function activeExpired(moduleId: string): ModuleAttempt {
  return {
    ...active(moduleId),
    deadlineAt: new Date(Date.parse(SERVER_NOW) - 5_000).toISOString(),
  };
}

/** Module 1 timed out; the routed Module 2 waits to be opened. */
function timedOutBranchBootstrap(
  role: "lower_branch" | "higher_branch",
  revision = 3,
): AssessmentDeliveryBootstrap {
  const base = liveFirstModuleBootstrap(revision);
  return {
    ...base,
    sections: [rwSectionWithBranch(role)],
    attempt: {
      ...base.attempt,
      moduleAttempts: [endedByOwnClock(MODULE_RW), notStarted(MODULE_RW_M2)],
    },
  };
}

/** Module 1 submitted early; the routed Module 2 waits for the student. */
function earlySubmitBranchBootstrap(revision = 3): AssessmentDeliveryBootstrap {
  const base = liveFirstModuleBootstrap(revision);
  return {
    ...base,
    sections: [rwSectionWithBranch("lower_branch")],
    attempt: {
      ...base.attempt,
      moduleAttempts: [submittedEarly(MODULE_RW), notStarted(MODULE_RW_M2)],
    },
  };
}

/** Module 2 is open and its own clock has run out. */
function branchExpiredBootstrap(revision = 4): AssessmentDeliveryBootstrap {
  const base = liveFirstModuleBootstrap(revision);
  return {
    ...base,
    sections: [rwSectionWithBranch("higher_branch")],
    attempt: {
      ...base.attempt,
      moduleAttempts: [endedByOwnClock(MODULE_RW), activeExpired(MODULE_RW_M2)],
    },
  };
}

/** Module 2 finished; the next section has not gone live yet. */
function betweenSectionsPendingBootstrap(revision = 5): AssessmentDeliveryBootstrap {
  const base = liveFirstModuleBootstrap(revision);
  return {
    ...base,
    sections: [rwSectionWithBranch("lower_branch"), mathSection()],
    attempt: {
      ...base.attempt,
      moduleAttempts: [
        endedByOwnClock(MODULE_RW),
        submitted(MODULE_RW_M2),
        notStarted(MODULE_MATH),
      ],
    },
  };
}

/**
 * The proctor has not pressed Start.
 *
 * This is the REAL pre-start payload: the server persists no
 * exam_session_runtimes row, so the bootstrap projects
 * proctor.NotStartedRuntimeForProvider — status not_started, timing authority
 * cohort_runtime, model cohort_section_v3, no stage, no deadline, zero
 * remaining. It used to project the legacy attempt clock here (status
 * "live", authority legacy_attempt), which is the defect that let a waiting
 * student auto-enter and 409 against /modules/start.
 */
function notStartedCohortBootstrap(): AssessmentDeliveryBootstrap {
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow: SERVER_NOW,
    candidateName: "Candidate",
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
    attempt: { id: ATTEMPT_ID, moduleAttempts: [notStarted(MODULE_RW)], responses: [] },
    result: null,
  };
}

/** The proctor pressed Start: section 1 is live and its base module is open to start. */
function liveFirstModuleBootstrap(runtimeRevision: number): AssessmentDeliveryBootstrap {
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
      runtimeRevision,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [rwSection()],
    attempt: { id: ATTEMPT_ID, moduleAttempts: [notStarted(MODULE_RW)], responses: [] },
    result: null,
  };
}

/**
 * The authoritative break has ended: section 1 is complete, the server has
 * advanced, and math is live with its base module still not_started.
 */
function postBreakBootstrap(runtimeRevision: number): AssessmentDeliveryBootstrap {
  return {
    ...liveFirstModuleBootstrap(runtimeRevision),
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: "math",
      stageStatus: "live",
      serverNow: SERVER_NOW,
      deadlineAt: new Date(Date.parse(SERVER_NOW) + 120_000).toISOString(),
      remainingSeconds: 120,
      waitingForNextSection: false,
      runtimeRevision,
    },
    sections: [rwSection(), mathSection()],
    attempt: {
      id: ATTEMPT_ID,
      moduleAttempts: [submitted(MODULE_RW), notStarted(MODULE_MATH)],
      responses: [],
    },
  };
}

/** A startModule response in which `moduleId` was opened. */
function openedModule(
  base: AssessmentDeliveryBootstrap,
  moduleId: string,
  runtimeRevision: number,
): AssessmentDeliveryBootstrap {
  return {
    ...base,
    timing: { ...base.timing, runtimeRevision },
    attempt: {
      ...base.attempt,
      moduleAttempts: base.attempt.moduleAttempts.map((attempt) =>
        attempt.moduleId === moduleId ? active(moduleId) : attempt
      ),
    },
  };
}

/**
 * The room is on the shared break: section 1 is complete, the server names the
 * instant math goes live, and math is not started yet. A `nextSectionStartAt`
 * before the clock means the break has already run out.
 */
function waitingBreakBootstrap(
  runtimeRevision: number,
  nextSectionStartAt: string,
): AssessmentDeliveryBootstrap {
  return {
    ...postBreakBootstrap(runtimeRevision),
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: "reading-writing",
      stageStatus: "completed",
      serverNow: SERVER_NOW,
      deadlineAt: null,
      remainingSeconds: 0,
      waitingForNextSection: true,
      nextSectionStartAt,
      runtimeRevision,
    },
  };
}

function renderController(initialToken = 0, options: { liveSocketConnected?: boolean } = {}) {
  const liveSocketConnected = options.liveSocketConnected ?? false;
  return renderHook(
    ({ token }: { token: number }) =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: ATTEMPT_ID,
        candidateId: "candidate",
        attemptUpdateToken: token,
        liveSocketConnected,
      }),
    { initialProps: { token: initialToken } },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("useSatExamController auto-entry", () => {
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

  it("enters the first module with no student action once the proctor starts the session", async () => {
    gatewayMocks.bootstrap.mockResolvedValueOnce(notStartedCohortBootstrap());
    gatewayMocks.bootstrap.mockResolvedValue(liveFirstModuleBootstrap(2));
    gatewayMocks.startModule.mockResolvedValue(
      openedModule(liveFirstModuleBootstrap(2), MODULE_RW, 3),
    );

    const hook = renderController();

    await waitFor(() =>
      expect(hook.result.current.data?.scheduleRuntimeStatus).toBe("not_started"),
    );
    // Nothing may start while the proctor has not made the runtime live.
    expect(gatewayMocks.startModule).not.toHaveBeenCalled();
    expect(hook.result.current.state.phase).toBe("directions");

    // The proctor presses Start; the client's next authoritative payload is live.
    hook.rerender({ token: 1 });

    await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1));
    expect(gatewayMocks.startModule).toHaveBeenCalledWith("schedule", ATTEMPT_ID, {
      moduleId: MODULE_RW,
    });
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
  });

  // The waiting-room 409 storm: a real pre-start bootstrap used to say
  // "live", so auto-entry fired, POST /modules/start answered 409
  // RUNTIME_NOT_LIVE, and the 2s retry window re-fired it forever. With the
  // corrected pre-start projection the entry gate never opens, so the student
  // sits on the directions screen through every recovery poll.
  it("stays in the waiting room through recovery polls while the runtime is not_started", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      gatewayMocks.bootstrap.mockResolvedValue(notStartedCohortBootstrap());

      const hook = renderController();
      await act(async () => {
        for (let i = 0; i < 12; i++) await Promise.resolve();
      });

      expect(hook.result.current.data?.scheduleRuntimeStatus).toBe("not_started");
      expect(hook.result.current.state.phase).toBe("directions");

      // 30s without a live socket = many 1-2s recovery polls (plus the 500ms
      // clock tick that drives the entry retry window).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      // Verified against the pre-fix payload (status "live", authority
      // legacy_attempt): this same test fires 16 startModule calls in 30s.
      expect(gatewayMocks.bootstrap.mock.calls.length).toBeGreaterThan(1);
      expect(gatewayMocks.startModule).not.toHaveBeenCalled();
      expect(hook.result.current.state.phase).toBe("directions");
      // No recoverable entry surface: nothing was ever attempted, so the
      // manual start button is not offered as error recovery.
      expect(hook.result.current.autoEntryRecoverable).toBe(false);
      expect(hook.result.current.error).toBeNull();

      // The proctor starts; one live payload is enough for automatic entry.
      gatewayMocks.bootstrap.mockResolvedValue(liveFirstModuleBootstrap(2));
      gatewayMocks.startModule.mockResolvedValue(
        openedModule(liveFirstModuleBootstrap(2), MODULE_RW, 3),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1);
      expect(gatewayMocks.startModule).toHaveBeenCalledWith("schedule", ATTEMPT_ID, {
        moduleId: MODULE_RW,
      });
      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  // A duplicate wake-up (a re-delivered bus row, a reconnect replay, or a
  // second effect run) must not open the same module twice: entry is
  // single-flight per target, and only a confirmed open is terminal.
  it("starts the first module once when duplicate live payloads arrive mid-start", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(liveFirstModuleBootstrap(2));
    // The start stays in flight for the whole assertion window, so the only
    // thing that can produce a second call is a missing in-flight guard.
    gatewayMocks.startModule.mockImplementation(() => new Promise(() => {}));

    const hook = renderController();

    await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1));
    hook.rerender({ token: 1 });
    hook.rerender({ token: 2 });
    await act(async () => {
      await sleep(600);
    });

    expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("enters the next section with no student action once the authoritative break has ended", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(postBreakBootstrap(9));
    gatewayMocks.startModule.mockResolvedValue(
      openedModule(postBreakBootstrap(9), MODULE_MATH, 10),
    );

    const hook = renderController();

    await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1));
    expect(gatewayMocks.startModule).toHaveBeenCalledWith("schedule", ATTEMPT_ID, {
      moduleId: MODULE_MATH,
    });
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
  });

  // Phase 3: the section advance is system-driven, so it must not depend on the
  // parent poll's control-command fast lane. These three cases park that poll on
  // the socket cadence (liveSocketConnected) so a bootstrap call can only come
  // from the controller's own forced pull.
  it("pulls the advanced section itself once the break has run out", async () => {
    const expired = new Date(Date.parse(SERVER_NOW) - 5_000).toISOString();
    gatewayMocks.bootstrap.mockResolvedValueOnce(waitingBreakBootstrap(9, expired));
    gatewayMocks.bootstrap.mockResolvedValue(postBreakBootstrap(10));
    gatewayMocks.startModule.mockResolvedValue(
      openedModule(postBreakBootstrap(10), MODULE_MATH, 11),
    );

    const hook = renderController(0, { liveSocketConnected: true });

    await waitFor(
      () => expect(gatewayMocks.bootstrap.mock.calls.length).toBeGreaterThanOrEqual(2),
      { timeout: 3_000 },
    );
    await waitFor(
      () =>
        expect(gatewayMocks.startModule).toHaveBeenCalledWith("schedule", ATTEMPT_ID, {
          moduleId: MODULE_MATH,
        }),
      { timeout: 3_000 },
    );
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
  });

  it("treats a transition conflict on entry as still-advancing, not a student error", async () => {
    const expired = new Date(Date.parse(SERVER_NOW) - 5_000).toISOString();
    gatewayMocks.bootstrap.mockResolvedValueOnce(waitingBreakBootstrap(9, expired));
    gatewayMocks.bootstrap.mockResolvedValue(postBreakBootstrap(10));
    // SAT-007: the transition race is classified from the structured backend
    // code/reason the delivery layer emits (ASSESSMENT_CONFLICT with
    // details.reason), never from the bare 409 status.
    gatewayMocks.startModule.mockRejectedValueOnce(
      new ApiError({
        code: "ASSESSMENT_CONFLICT",
        message: "Section is not active.",
        status: 409,
        details: { reason: "SECTION_NOT_ACTIVE" },
      }),
    );
    gatewayMocks.startModule.mockResolvedValue(
      openedModule(postBreakBootstrap(10), MODULE_MATH, 11),
    );

    const hook = renderController(0, { liveSocketConnected: true });

    await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1), {
      timeout: 3_000,
    });

    // Still inside the retry window: the conflict must leave the attempt
    // retryable and say nothing to the student.
    await act(async () => {
      await sleep(600);
    });
    expect(hook.result.current.error).toBeNull();
    expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"), {
      timeout: 4_000,
    });
    expect(hook.result.current.error).toBeNull();
  });

  it("leaves the break alone while its countdown is still running", async () => {
    const running = new Date(Date.parse(SERVER_NOW) + 300_000).toISOString();
    gatewayMocks.bootstrap.mockResolvedValue(waitingBreakBootstrap(9, running));

    const hook = renderController(0, { liveSocketConnected: true });

    await waitFor(() => expect(hook.result.current.pendingBreakSeconds).toBeGreaterThan(0));
    await act(async () => {
      await sleep(1_200);
    });

    // The pull waits for 0:00: no extra bootstrap, and nothing starts.
    expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1);
    expect(gatewayMocks.startModule).not.toHaveBeenCalled();
  });

  it(
    "retries the first-module start after a failed attempt instead of stranding the student",
    async () => {
      gatewayMocks.bootstrap.mockResolvedValueOnce(liveFirstModuleBootstrap(2));
      gatewayMocks.bootstrap.mockResolvedValue(liveFirstModuleBootstrap(3));
      gatewayMocks.startModule.mockRejectedValueOnce(new Error("network down"));
      gatewayMocks.startModule.mockResolvedValue(
        openedModule(liveFirstModuleBootstrap(3), MODULE_RW, 4),
      );

      const hook = renderController();

      await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1));
      // The first attempt failed: the student is still waiting on directions.
      expect(hook.result.current.state.phase).toBe("directions");

      // A later authoritative payload (or the entry retry window) must be able
      // to start the module again without the student pressing anything.
      hook.rerender({ token: 1 });

      // Guard against a vacuous pass: the refresh must actually commit, so the
      // ONLY remaining blocker is the consumed entry key.
      await waitFor(() =>
        expect(hook.result.current.data?.timing.runtimeRevision).toBe(3),
      );

      await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(2), {
        timeout: 4_000,
      });
      await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    },
  );

  it(
    "retries when the start call resolves but does not open the module",
    async () => {
      gatewayMocks.bootstrap.mockResolvedValueOnce(liveFirstModuleBootstrap(2));
      gatewayMocks.bootstrap.mockResolvedValue(liveFirstModuleBootstrap(3));
      // The call resolved, but the module is still not_started: nothing opened,
      // so the entry attempt must not be recorded as complete.
      gatewayMocks.startModule.mockResolvedValue(liveFirstModuleBootstrap(3));

      const hook = renderController();

      await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1));
      expect(hook.result.current.state.phase).toBe("directions");

      hook.rerender({ token: 1 });

      // Guard against a vacuous pass: the refresh must actually commit, so the
      // ONLY remaining blocker is the consumed entry key.
      await waitFor(() =>
        expect(hook.result.current.data?.timing.runtimeRevision).toBe(3),
      );

      await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(2), {
        timeout: 4_000,
      });
    },
  );

  // Module-advance fix (AT-01/AT-02/AT-10): Module 1's clock ran out, so the
  // routed Module 2 opens with no student action. Which branch the student gets
  // is the server's routing decision; the client only enters what the payload
  // hands it. The same payload is what a reload or an offline reconnect sees,
  // which is why the verdict is read from the payload and not from the local
  // submit that produced it.
  it.each([
    ["lower_branch", "Lower"],
    ["higher_branch", "Higher"],
  ] as const)(
    "opens the routed Module 2 (%s) with no student action after Module 1 times out",
    async (role) => {
      gatewayMocks.bootstrap.mockResolvedValue(timedOutBranchBootstrap(role));
      gatewayMocks.startModule.mockResolvedValue(
        openedModule(timedOutBranchBootstrap(role), MODULE_RW_M2, 4),
      );

      const hook = renderController();

      await waitFor(() => expect(gatewayMocks.startModule).toHaveBeenCalledTimes(1));
      expect(gatewayMocks.startModule).toHaveBeenCalledWith("schedule", ATTEMPT_ID, {
        moduleId: MODULE_RW_M2,
      });
      await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
      expect(hook.result.current.state.phase === "module" && hook.result.current.state.moduleKey).toBe(
        MODULE_RW_M2,
      );
    },
  );

  // AT-03: a deliberate early submit is not a timeout. The module is still the
  // student's to open, and the screen must say so with a working button rather
  // than waiting for an automatic entry that will never come.
  it("leaves Module 2 to the student when Module 1 was submitted early", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(earlySubmitBranchBootstrap());

    const hook = renderController();

    await waitFor(() =>
      expect(hook.result.current.data?.attempt.moduleAttempts.length).toBe(2),
    );
    await act(async () => {
      await sleep(600);
    });

    expect(gatewayMocks.startModule).not.toHaveBeenCalled();
    expect(hook.result.current.state.phase).toBe("directions");
    expect(hook.result.current.entryAutoStartPending).toBe(false);
    expect(hook.result.current.autoEntryRecoverable).toBe(false);
  });

  // AT-06/AT-09: Module 2's own clock runs out, the route moves to the next
  // section, and nothing finalizes the attempt while that section's Module 1 is
  // still waiting its turn.
  it("moves a timed-out Module 2 to the next section's wait without finalizing", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(branchExpiredBootstrap());
    gatewayMocks.submitModule.mockResolvedValue(betweenSectionsPendingBootstrap());

    const hook = renderController();

    await waitFor(() => expect(gatewayMocks.submitModule).toHaveBeenCalledTimes(1));
    expect(gatewayMocks.submitModule).toHaveBeenCalledWith("schedule", ATTEMPT_ID, {
      moduleId: MODULE_RW_M2,
    });
    await waitFor(() => expect(hook.result.current.state.phase).toBe("break"));
    expect(gatewayMocks.submitAssessment).not.toHaveBeenCalled();
    // The next section is not live yet, so its Module 1 waits: the wait is what
    // holds the student, not a premature result screen.
    expect(gatewayMocks.startModule).not.toHaveBeenCalled();
    expect(hook.result.current.pendingSectionWaitSeconds).toBeGreaterThan(0);
  });

  it("never finalizes an attempt whose next section module is still waiting", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(betweenSectionsPendingBootstrap());

    const hook = renderController();

    await waitFor(() =>
      expect(hook.result.current.data?.attempt.moduleAttempts.length).toBe(3),
    );
    await act(async () => {
      await sleep(600);
    });

    expect(gatewayMocks.submitAssessment).not.toHaveBeenCalled();
    expect(hook.result.current.state.phase).toBe("directions");
  });
});
