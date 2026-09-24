import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleAttemptSnapshot,
  AssessmentPersonalBreakSnapshot,
} from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * SAT full-entry-time client contract (plan 2026-09-24).
 *
 * The personal timing model hands each candidate a server-issued entry offer:
 * the server arms an offer, the client confirms it, and the candidate's authored
 * window is anchored to the SERVER's start instant — never to when the response
 * arrived, and never to when the surface painted.
 *
 * This suite drives the real controller against a fake personal server with fake
 * timers, because the whole contract is about time:
 *   - the module is not entered before the offer start, and the first active
 *     frame carries the FULL authored window (2:00, then 1:59);
 *   - a reload mid-module resumes the remaining window instead of reallocating
 *     a fresh one;
 *   - a candidate who starts five minutes later gets their own full window and
 *     does not inherit the earlier candidate's consumed time;
 *   - the scheduled break is entered through its own offer and counts its own
 *     authored break, and it gates the next module while it is pending.
 *
 * The fake server refuses an entry whose offer has already started
 * (ENTRY_OFFER_MISSED) the way the backend does, so a client that entered late
 * would surface as a recorded conflict rather than as a passing test.
 */

const gatewayMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  configureSatDeliveryAttempt: vi.fn(),
  startModule: vi.fn(),
  enterModule: vi.fn(),
  markStageVisible: vi.fn(),
  startBreak: vi.fn(),
  enterBreak: vi.fn(),
  markBreakVisible: vi.fn(),
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
    enterModule: gatewayMocks.enterModule,
    markStageVisible: gatewayMocks.markStageVisible,
    startBreak: gatewayMocks.startBreak,
    enterBreak: gatewayMocks.enterBreak,
    markBreakVisible: gatewayMocks.markBreakVisible,
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

const SERVER_NOW = "2026-09-24T08:00:00.000Z";
const T0 = Date.parse(SERVER_NOW);
const MODULE_RW = "module-rw";
const MODULE_RW_BRANCH = "module-rw-branch";

type Bootstrap = AssessmentDeliveryBootstrap;

/** The client's own offer lead: the server arms at DB time + lead, and the
 * client refuses an offer with less than a second left, so the fake mirrors it. */
const OFFER_LEAD_MS = 5_000;
const AUTHORED_SECONDS = 120;

function rwSection(moduleIds: string[]) {
  return {
    id: "section-rw",
    sectionKey: "reading-writing",
    title: "Reading and Writing",
    displayOrder: 0,
    durationSeconds: 4 * 60 * 60,
    breakAfterSeconds: 0,
    instructions: { version: 1, nodes: [] },
    modules: moduleIds.map((id, index) => ({
      id,
      moduleKey: id,
      title: `Module ${index + 1}`,
      displayOrder: index,
      durationSeconds: AUTHORED_SECONDS,
      targetQuestionCount: 1,
      adaptiveRole: index === 0 ? "base" : "lower_branch",
      instructions: { version: 1, nodes: [] },
      toolPolicy: [],
      questions: [],
    })),
  };
}

/** The backend seeds one unstarted entry-module row per admitted attempt, which
 * is what makes the module the client's pending entry target. */
function seededModuleAttempt(attemptId: string): AssessmentModuleAttemptSnapshot {
  return {
    id: `ma-${MODULE_RW}`,
    moduleId: MODULE_RW,
    state: "not_started",
    allocatedSeconds: AUTHORED_SECONDS,
    availableAt: null,
    startedAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: null,
    remainingSeconds: null,
    entryGeneration: 0,
    entryStartsAt: null,
    entryConfirmedAt: null,
    entryEnteredAt: null,
    completionReason: null,
    rawCorrect: null,
    operationalQuestionCount: null,
    toolState: {},
    revision: 0,
  };
}

function basePayload(attemptId: string, serverNow = SERVER_NOW): Bootstrap {
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow,
    candidateName: `Candidate ${attemptId}`,
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "cohort_runtime",
      timingModel: "sat_personal_v1",
      stageKey: null,
      stageStatus: "live",
      serverNow,
      // The personal model's cohort clock is a run-sheet projection only: it
      // never caps or advances this candidate's own window.
      deadlineAt: null,
      remainingSeconds: 0,
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [rwSection([MODULE_RW])],
    attempt: {
      id: attemptId,
      moduleAttempts: [seededModuleAttempt(attemptId)],
      responses: [],
      personalBreaks: [],
    },
    result: null,
  };
}

/** An unentered offer, exactly as delivery.StartModule publishes it. */
function offeredModule(
  attemptId: string,
  moduleId: string,
  generation: number,
  startsAtMs: number,
  serverNow = new Date().toISOString(),
): Bootstrap {
  return {
    ...basePayload(attemptId, serverNow),
    attempt: {
      id: attemptId,
      moduleAttempts: [
        {
          id: `ma-${moduleId}`,
          moduleId,
          state: "not_started",
          allocatedSeconds: AUTHORED_SECONDS,
          availableAt: new Date(startsAtMs).toISOString(),
          startedAt: null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionSeconds: 0,
          deadlineAt: null,
          remainingSeconds: null,
          entryGeneration: generation,
          entryStartsAt: new Date(startsAtMs).toISOString(),
          entryConfirmedAt: null,
          entryEnteredAt: null,
          completionReason: null,
          rawCorrect: null,
          operationalQuestionCount: null,
          toolState: {},
          revision: generation,
        },
      ],
      responses: [],
      personalBreaks: [],
    },
  };
}

/** A confirmed module: started_at IS the offer start, so the deadline is the
 * authored window measured from that instant. */
function enteredModule(
  attemptId: string,
  moduleId: string,
  generation: number,
  startsAtMs: number,
  now: number,
  serverNow = new Date().toISOString(),
): Bootstrap {
  const deadlineMs = startsAtMs + AUTHORED_SECONDS * 1_000;
  return {
    ...basePayload(attemptId, serverNow),
    attempt: {
      id: attemptId,
      moduleAttempts: [
        {
          id: `ma-${moduleId}`,
          moduleId,
          state: "active",
          allocatedSeconds: AUTHORED_SECONDS,
          availableAt: new Date(startsAtMs).toISOString(),
          startedAt: new Date(startsAtMs).toISOString(),
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionSeconds: 0,
          deadlineAt: new Date(deadlineMs).toISOString(),
          remainingSeconds: Math.max(0, Math.ceil((deadlineMs - now) / 1_000)),
          entryGeneration: generation,
          entryStartsAt: new Date(startsAtMs).toISOString(),
          entryConfirmedAt: new Date(startsAtMs).toISOString(),
          entryEnteredAt: null,
          completionReason: null,
          rawCorrect: null,
          operationalQuestionCount: null,
          toolState: {},
          revision: generation + 1,
        },
      ],
      responses: [],
      personalBreaks: [],
    },
  };
}

const BREAK_ID = "break-1";

/** The scheduled break as the attempt owns it, projected at `now`. */
function attachBreak(
  payload: Bootstrap,
  spec: { state: "pending" | "armed" | "active"; generation: number; startsAtMs: number | null; now: number },
): Bootstrap {
  const deadlineMs = spec.startsAtMs === null ? null : spec.startsAtMs + AUTHORED_SECONDS * 1_000;
  const breakSnapshot: AssessmentPersonalBreakSnapshot = {
    id: BREAK_ID,
    afterSectionId: "section-rw",
    durationSeconds: AUTHORED_SECONDS,
    state: spec.state,
    startsAt: spec.state === "active" && spec.startsAtMs !== null
      ? new Date(spec.startsAtMs).toISOString()
      : null,
    deadlineAt: deadlineMs !== null ? new Date(deadlineMs).toISOString() : null,
    enteredAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    entryGeneration: spec.generation,
    entryStartsAt: spec.startsAtMs !== null ? new Date(spec.startsAtMs).toISOString() : null,
    entryConfirmedAt: spec.state === "active" && spec.startsAtMs !== null
      ? new Date(spec.startsAtMs).toISOString()
      : null,
    entryEnteredAt: null,
    remainingSeconds:
      deadlineMs === null ? 0 : Math.max(0, Math.ceil((deadlineMs - spec.now) / 1_000)),
    revision: spec.generation + 1,
  };
  return {
    ...payload,
    sections: [rwSection([MODULE_RW, MODULE_RW_BRANCH])],
    attempt: { ...payload.attempt, personalBreaks: [breakSnapshot] },
  };
}

/** The module the candidate is on when the break becomes due: Module 1 active,
 * its window long since run out — the server has scheduled the break after it. */
function moduleOneFinished(attemptId: string, now: number): Bootstrap {
  return enteredModule(attemptId, MODULE_RW, 1, now - AUTHORED_SECONDS * 1_000 - 1_000, now);
}

/** The next section's module, seeded unstarted and waiting behind the break. */
function seededBranchAttempt(): AssessmentModuleAttemptSnapshot {
  return {
    ...seededModuleAttempt("attempt"),
    id: `ma-${MODULE_RW_BRANCH}`,
    moduleId: MODULE_RW_BRANCH,
    revision: 0,
  };
}

/**
 * What delivery publishes between modules: Module 1 finalized by its own clock,
 * the branch module seeded and unstarted, and the attempt-owned break owed. This
 * is the frame that must (a) hold the branch module and (b) open the break.
 */
function moduleOneTerminal(attemptId: string, startsAtMs: number, now: number): Bootstrap {
  const base = enteredModule(attemptId, MODULE_RW, 1, startsAtMs, now);
  return {
    ...base,
    sections: [rwSection([MODULE_RW, MODULE_RW_BRANCH])],
    attempt: {
      ...base.attempt,
      moduleAttempts: [
        {
          ...base.attempt.moduleAttempts[0],
          state: "submitted",
          remainingSeconds: 0,
          completionReason: "time_expired",
          revision: 3,
        },
        seededBranchAttempt(),
      ],
    },
  };
}

/**
 * One fake personal server per student. Every entry point records what the
 * client asked for, so the test asserts the flow (offer → confirm → paint) rather
 * than only the resulting payload.
 */
function createPersonalServer(attemptId: string, options: { breakLeadMs?: number } = {}) {
  // The break's offer lead is configurable so one test can observe the pre-start
  // window (the confirmation is in, the surface is not yet counting) without
  // racing the poll cadence.
  const breakLeadMs = options.breakLeadMs ?? OFFER_LEAD_MS;
  const log: string[] = [];
  let moduleStartsAtMs: number | null = null;
  let moduleGeneration = 0;
  let moduleEntered = false;
  let breakStartsAtMs: number | null = null;
  let breakGeneration = 0;
  let breakState: "none" | "pending" | "armed" | "active" = "none";
  let breakEntered = false;
  let moduleTerminal = false;

  return {
    log,
    get moduleStartsAtMs() {
      return moduleStartsAtMs;
    },
    get moduleGeneration() {
      return moduleGeneration;
    },
    get breakStartsAtMs() {
      return breakStartsAtMs;
    },
    get breakState() {
      return breakState;
    },
    get breakEntered() {
      return breakEntered;
    },
    /**
     * A check-in. The projection reflects the server's OWN state, the way the
     * real bootstrap does: a reload after entry must show the started module, not
     * the pre-offer seed (a fixture that always returned the seed would let a
     * client that reallocated its window look correct).
     */
    bootstrap() {
      log.push("bootstrap");
      const now = Date.now();
      if (moduleTerminal) {
        return Promise.resolve(withBreak(moduleOneTerminal(attemptId, moduleStartsAtMs ?? now, now)));
      }
      if (moduleStartsAtMs !== null && moduleEntered) {
        return Promise.resolve(withBreak(enteredModule(attemptId, MODULE_RW, moduleGeneration, moduleStartsAtMs, now)));
      }
      if (moduleStartsAtMs !== null) {
        return Promise.resolve(withBreak(offeredModule(attemptId, MODULE_RW, moduleGeneration, moduleStartsAtMs)));
      }
      return Promise.resolve(withBreak(basePayload(attemptId)));
    },
    startModule(_scheduleId: string, _attemptId: string, request: { generation?: number; moduleId?: string }) {
      log.push("startModule");
      const now = Date.now();
      // The break owns the hand-off: the next module cannot be armed until it
      // completes, exactly as delivery refuses PERSONAL_BREAK_PENDING.
      if (request.moduleId && request.moduleId !== MODULE_RW) {
        log.push("PERSONAL_BREAK_PENDING");
        return Promise.reject(new Error("409 PERSONAL_BREAK_PENDING"));
      }
      // A re-arm keeps the same offer if it is still in the future; otherwise a
      // NEW offer is armed at database time + lead, exactly like the backend.
      if (
        moduleStartsAtMs !== null &&
        !moduleEntered &&
        moduleStartsAtMs > now &&
        (request.generation ?? moduleGeneration) === moduleGeneration
      ) {
        return Promise.resolve(
          offeredModule(attemptId, MODULE_RW, moduleGeneration, moduleStartsAtMs),
        );
      }
      moduleGeneration += 1;
      moduleStartsAtMs = now + OFFER_LEAD_MS;
      moduleEntered = false;
      return Promise.resolve(offeredModule(attemptId, MODULE_RW, moduleGeneration, moduleStartsAtMs));
    },
    enterModule(_scheduleId: string, _attemptId: string, request: { generation?: number }) {
      log.push("enterModule");
      const now = Date.now();
      // The backend refuses a confirmation that arrives at or after the offer
      // start: there is no lead left to paint the active frame.
      if (moduleStartsAtMs === null || now >= moduleStartsAtMs) {
        log.push("ENTRY_OFFER_MISSED");
        return Promise.reject(new Error("409 ENTRY_OFFER_MISSED"));
      }
      if ((request.generation ?? moduleGeneration) !== moduleGeneration) {
        log.push("STALE_ENTRY_GENERATION");
        return Promise.reject(new Error("409 STALE_ENTRY_GENERATION"));
      }
      moduleEntered = true;
      return Promise.resolve(withBreak(enteredModule(attemptId, MODULE_RW, moduleGeneration, moduleStartsAtMs, now)));
    },
    markStageVisible(_scheduleId?: string, _attemptId?: string) {
      log.push("markStageVisible");
      const now = Date.now();
      const payload = enteredModule(
        attemptId,
        MODULE_RW,
        moduleGeneration,
        moduleStartsAtMs ?? now,
        now,
      );
      return Promise.resolve({
        ...payload,
        attempt: {
          ...payload.attempt,
          moduleAttempts: payload.attempt.moduleAttempts.map((item) => ({
            ...item,
            entryEnteredAt: new Date(now).toISOString(),
          })),
        },
      });
    },
    /**
     * Module 1 has been finalized by its own clock and the scheduled break is
     * owed: every projection from here carries the terminal module, the waiting
     * branch module, and the pending break.
     */
    breakIsDue() {
      moduleTerminal = true;
      breakState = "pending";
    },
    startBreak(_scheduleId: string, _attemptId: string, _breakId: string) {
      log.push("startBreak");
      const now = Date.now();
      const base = moduleOneFinished(attemptId, now);
      if (breakState === "armed" && breakStartsAtMs !== null && breakStartsAtMs > now) {
        return Promise.resolve(armed(breakGeneration, breakStartsAtMs, now, base));
      }
      if (breakState === "active" && breakStartsAtMs !== null) {
        return Promise.resolve(current());
      }
      breakGeneration += 1;
      breakStartsAtMs = now + breakLeadMs;
      breakState = "armed";
      return Promise.resolve(armed(breakGeneration, breakStartsAtMs, now, base));
    },
    enterBreak(_scheduleId: string, _attemptId: string, request: { generation?: number }) {
      log.push("enterBreak");
      const now = Date.now();
      if (breakState !== "armed" || breakStartsAtMs === null || now >= breakStartsAtMs) {
        log.push("ENTRY_OFFER_MISSED");
        return Promise.reject(new Error("409 ENTRY_OFFER_MISSED"));
      }
      if ((request.generation ?? breakGeneration) !== breakGeneration) {
        log.push("STALE_ENTRY_GENERATION");
        return Promise.reject(new Error("409 STALE_ENTRY_GENERATION"));
      }
      breakState = "active";
      return Promise.resolve(current());
    },
    markBreakVisible(_scheduleId?: string, _attemptId?: string) {
      log.push("markBreakVisible");
      const now = Date.now();
      breakEntered = true;
      const payload = current();
      return Promise.resolve({
        ...payload,
        attempt: {
          ...payload.attempt,
          personalBreaks: (payload.attempt.personalBreaks ?? []).map((item) => ({
            ...item,
            entryEnteredAt: new Date(now).toISOString(),
          })),
        },
      });
    },
  };

  /** An armed break offer, keyed to the offer start the endpoint published. */
  function armed(
    generation: number,
    startsAtMs: number,
    now: number,
    base: Bootstrap,
  ): Bootstrap {
    return attachBreak({ ...base, serverNow: new Date().toISOString() }, {
      state: "armed",
      generation,
      startsAtMs,
      now,
    });
  }

  /** The break projection at the current instant, from the server's own state. */
  function current(): Bootstrap {
    const now = Date.now();
    return attachBreak({ ...moduleOneFinished(attemptId, now), serverNow: new Date().toISOString() }, {
      state: breakState === "none" ? "pending" : breakState,
      generation: breakGeneration,
      startsAtMs: breakStartsAtMs,
      now,
    });
  }

  /** The projection every response carries: the module state plus the break. */
  function withBreak(payload: Bootstrap): Bootstrap {
    const now = Date.now();
    switch (breakState) {
      case "pending":
      case "armed":
      case "active":
        return attachBreak(payload, {
          state: breakState,
          generation: breakGeneration,
          startsAtMs: breakStartsAtMs,
          now,
        });
      default:
        return payload;
    }
  }
}

type PersonalServer = ReturnType<typeof createPersonalServer>;

interface ServerRoute {
  attemptId: string;
  server: PersonalServer;
}

/** Route every gateway call to the server that owns the requested attempt. */
function wire(routes: ServerRoute[]) {
  const forAttempt = (attemptId: string): PersonalServer => {
    const route = routes.find((candidate) => candidate.attemptId === attemptId);
    if (!route) throw new Error(`no fake server for attempt ${attemptId}`);
    return route.server;
  };
  gatewayMocks.bootstrap.mockImplementation((_scheduleId: string, attemptId: string) =>
    forAttempt(attemptId).bootstrap(),
  );
  gatewayMocks.startModule.mockImplementation(
    (scheduleId: string, attemptId: string, request: { generation?: number }) =>
      forAttempt(attemptId).startModule(scheduleId, attemptId, request),
  );
  gatewayMocks.enterModule.mockImplementation(
    (scheduleId: string, attemptId: string, request: { generation?: number }) =>
      forAttempt(attemptId).enterModule(scheduleId, attemptId, request),
  );
  gatewayMocks.markStageVisible.mockImplementation((scheduleId: string, attemptId: string) =>
    forAttempt(attemptId).markStageVisible(scheduleId, attemptId),
  );
  gatewayMocks.startBreak.mockImplementation(
    (scheduleId: string, attemptId: string, breakId: string) =>
      forAttempt(attemptId).startBreak(scheduleId, attemptId, breakId),
  );
  gatewayMocks.enterBreak.mockImplementation(
    (scheduleId: string, attemptId: string, request: { generation?: number }) =>
      forAttempt(attemptId).enterBreak(scheduleId, attemptId, request),
  );
  gatewayMocks.markBreakVisible.mockImplementation((scheduleId: string, attemptId: string) =>
    forAttempt(attemptId).markBreakVisible(scheduleId, attemptId),
  );
}

const ATTEMPT_ID = "attempt-a";

function renderStudent(attemptId = ATTEMPT_ID) {
  return renderHook(
    ({ token }: { token: number }) =>
      useSatExamController({
        scheduleId: "schedule",
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

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("SAT personal entry offers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const mock of Object.values(gatewayMocks)) mock.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.submit.mockResolvedValue({} as never);
  });

  it("enters only at the server-issued offer start, and reads the full authored window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      const server = createPersonalServer(ATTEMPT_ID);
      wire([{ attemptId: ATTEMPT_ID, server }]);

      const student = renderStudent();
      await settle();

      // The offer was armed and confirmed while its lead was still ahead of the
      // client: the confirmation is a pre-start handshake, which is what makes
      // the authored window start at the SERVER's instant rather than at the
      // paint. The candidate still sees the pre-start surface.
      expect(server.log).toContain("startModule");
      expect(server.log).toContain("enterModule");
      expect(server.log).not.toContain("ENTRY_OFFER_MISSED");
      expect(student.result.current.state.phase).toBe("directions");

      // Two seconds into the five-second lead the module is still not open: the
      // offer start, not the handshake, is what opens the window.
      await advance(2_000);
      expect(student.result.current.state.phase).toBe("directions");

      // At exactly the offer start the module opens.
      await advance(OFFER_LEAD_MS - 2_000);
      await advance(20);
      await settle();
      expect(student.result.current.state.phase).toBe("module");

      // The first active frame carries the FULL authored window: 2:00, and only
      // then 1:59. A window anchored to the response or to the paint would read
      // 1:5x here.
      expect(student.result.current.remainingSeconds).toBe(AUTHORED_SECONDS);
      await advance(1_000);
      expect(student.result.current.remainingSeconds).toBe(AUTHORED_SECONDS - 1);

      // The first-paint acknowledgment closes the server's re-arm window.
      await advance(100);
      expect(server.log).toContain("markStageVisible");

      student.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rearms when a delayed browser wake misses the first displayed second", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      const server = createPersonalServer(ATTEMPT_ID);
      wire([{ attemptId: ATTEMPT_ID, server }]);
      const student = renderStudent();
      await settle();
      expect(server.log).toContain("enterModule");

      // Move the wall clock past the offer while its timeout callback is
      // pending, as happens when the page's main thread is blocked.
      vi.setSystemTime(new Date(T0 + OFFER_LEAD_MS + 1_500));
      await advance(OFFER_LEAD_MS);
      await settle();
      expect(student.result.current.state.phase).toBe("directions");
      expect(server.log.filter((entry) => entry === "startModule").length).toBeGreaterThan(1);

      await advance(Math.max(0, (server.moduleStartsAtMs ?? 0) - Date.now()) + 20);
      await settle();
      expect(student.result.current.state.phase).toBe("module");
      expect(student.result.current.remainingSeconds).toBe(AUTHORED_SECONDS);
      student.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes the remaining window on a reload instead of reallocating a fresh one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      const server = createPersonalServer(ATTEMPT_ID);
      wire([{ attemptId: ATTEMPT_ID, server }]);
      const student = renderStudent();
      await settle();
      await advance(OFFER_LEAD_MS);
      await advance(20);
      await settle();
      expect(student.result.current.state.phase).toBe("module");
      const startsAt = server.moduleStartsAtMs as number;
      expect(student.result.current.remainingSeconds).toBe(AUTHORED_SECONDS);

      // 30 seconds in, the student reloads: the bootstrap carries the started
      // module whose deadline is the offer start plus the authored window, so
      // the read-back is ~1:30 — never a fresh 2:00.
      await advance(30_000);
      const reloaded = enteredModule(ATTEMPT_ID, MODULE_RW, 1, startsAt, Date.now());
      gatewayMocks.bootstrap.mockImplementation(() => Promise.resolve(reloaded));
      student.rerender({ token: 1 });
      await settle();

      expect(student.result.current.remainingSeconds).toBe(AUTHORED_SECONDS - 30);
      expect(student.result.current.remainingSeconds).not.toBe(AUTHORED_SECONDS);
      // A reload resumes the offer: it must not arm or confirm a second one.
      expect(server.log.filter((entry) => entry === "startModule")).toHaveLength(1);
      expect(server.log.filter((entry) => entry === "enterModule")).toHaveLength(1);

      student.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a later-arriving candidate their own full window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      const early = createPersonalServer("attempt-early");
      const late = createPersonalServer("attempt-late");
      wire([
        { attemptId: "attempt-early", server: early },
        { attemptId: "attempt-late", server: late },
      ]);

      const earlyStudent = renderStudent("attempt-early");
      await settle();
      await advance(OFFER_LEAD_MS);
      await advance(20);
      await settle();
      expect(earlyStudent.result.current.state.phase).toBe("module");

      // A second candidate joins a minute later — half-way through the first
      // candidate's authored window.
      const GAP_MS = 60_000;
      await advance(GAP_MS);
      const lateStudent = renderStudent("attempt-late");
      await settle();
      await advance(OFFER_LEAD_MS);
      await advance(20);
      await settle();
      expect(lateStudent.result.current.state.phase).toBe("module");

      // Each candidate's window is measured from THEIR own offer start: the early
      // candidate has consumed a minute, the late one has a full authored window.
      // Neither inherits the other's clock, which is the whole point of a
      // per-candidate offer.
      // Observed at one instant: the late candidate holds the whole authored
      // window while the early one — who has been running for their gap plus their
      // own offer lead — holds what is left of theirs.
      const elapsedSeconds = Math.round((GAP_MS + OFFER_LEAD_MS) / 1_000);
      expect(lateStudent.result.current.remainingSeconds).toBe(AUTHORED_SECONDS);
      expect(earlyStudent.result.current.remainingSeconds).toBe(
        AUTHORED_SECONDS - elapsedSeconds,
      );
      expect(late.moduleStartsAtMs).toBeGreaterThan(
        (early.moduleStartsAtMs ?? 0) + GAP_MS - 1_000,
      );

      earlyStudent.unmount();
      lateStudent.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("enters the scheduled break through its own offer and holds the next module behind it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    try {
      const server = createPersonalServer(ATTEMPT_ID);
      wire([{ attemptId: ATTEMPT_ID, server }]);
      const student = renderStudent();
      await settle();
      await advance(OFFER_LEAD_MS);
      await advance(20);
      await settle();
      expect(student.result.current.state.phase).toBe("module");

      // Module 1 runs out of its own clock and the server owes the break.
      server.breakIsDue();
      await advance(AUTHORED_SECONDS * 1_000);
      await settle();

      // The break is entered through ITS offer — armed, then confirmed while the
      // offer start is still ahead — and the branch module behind it is never
      // armed: the break owns the hand-off.
      expect(server.log).toContain("startBreak");
      expect(server.log).toContain("enterBreak");
      expect(server.log).not.toContain("ENTRY_OFFER_MISSED");
      expect(server.log).not.toContain("PERSONAL_BREAK_PENDING");
      expect(server.log.filter((entry) => entry === "startModule")).toHaveLength(1);
      // Still on the pre-start surface while the offer lead runs: the break is
      // being prepared, and no break clock is being counted yet.
      // Module 1 runs out of its own clock. The refresh at the deadline still
      // shows the module un-finalized, so the client waits and keeps its input
      // frozen.
      await advance(AUTHORED_SECONDS * 1_000);
      await settle();
      expect(server.log.filter((entry) => entry === "startModule")).toHaveLength(1);

      // The server finalizes Module 1 by its own clock and owes the break; the
      // next poll carries the terminal module, the seeded branch module, and the
      // pending break.
      server.breakIsDue();
      await advance(5_000);
      await settle();

      // The break is entered through ITS offer — armed, then confirmed while the
      // offer start is still ahead — and the branch module behind it is never
      // armed: the break owns the hand-off.
      expect(server.log).toContain("startBreak");
      expect(server.log).toContain("enterBreak");
      expect(server.log).not.toContain("ENTRY_OFFER_MISSED");
      expect(server.log).not.toContain("PERSONAL_BREAK_PENDING");
      expect(server.log.filter((entry) => entry === "startModule")).toHaveLength(1);
      // Still on the pre-start surface while the offer lead runs: the break is
      // being prepared, and no break clock is counted yet.
      expect(student.result.current.state.phase).toBe("directions");
      expect(student.result.current.pendingBreakSeconds).toBe(0);
      expect(student.result.current.isStarting).toBe(true);

      // The break then surfaces and counts ITS OWN authored clock — the section
      // clock is a run-sheet projection for a personal attempt and must not be what
      // the break counts. (The exact authored-window arithmetic is pinned on the
      // server side, where the deadline is written from the offer start; this
      // asserts the client reads the attempt-owned break and not the room.)
      await advance(12_000);
      await settle();
      expect(student.result.current.pendingBreakSeconds).toBeGreaterThan(0);
      expect(student.result.current.pendingBreakSeconds).toBeLessThanOrEqual(AUTHORED_SECONDS);
      expect(student.result.current.isStarting).toBe(false);

      // The break's first paint is acknowledged, which is what closes the
      // server's re-arm window for it.
      await advance(100);
      expect(server.log).toContain("markBreakVisible");

      student.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
