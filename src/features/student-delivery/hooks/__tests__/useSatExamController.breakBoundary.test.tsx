import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleCloseAck,
  AssessmentPersonalBreakSnapshot,
} from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * Section-boundary break projection (docs/plans/2026-10-29-sat-break-boundary-
 * low-level.md, tests 10 and 11).
 *
 * The close ack is the routing decision at the boundary: it carries the break
 * the close transaction just created, so the browser must arm that break from
 * the same response instead of waiting for a lifecycle read. The bounded pull
 * below is only the fallback for a lost ack or an older server.
 */

const gatewayMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  configureSatDeliveryAttempt: vi.fn(),
  startModule: vi.fn(),
  sectionEntry: vi.fn(),
  submitModule: vi.fn(),
  submitAssessment: vi.fn(),
  closeModule: vi.fn(),
  startBreak: vi.fn(),
  enterBreak: vi.fn(),
  markBreakVisible: vi.fn(),
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
    sectionEntry: gatewayMocks.sectionEntry,
    submitModule: gatewayMocks.submitModule,
    submitAssessment: gatewayMocks.submitAssessment,
    closeModule: gatewayMocks.closeModule,
    startBreak: gatewayMocks.startBreak,
    enterBreak: gatewayMocks.enterBreak,
    markBreakVisible: gatewayMocks.markBreakVisible,
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

const SERVER_NOW = "2026-10-29T09:00:00.000Z";
const T0 = Date.parse(SERVER_NOW);
const ATTEMPT_ID = "attempt-boundary";
const RW_ID = "rw-m1";
const MATH_ID = "math-m1";
const BREAK_ID = "break-rw";
const BREAK_SECONDS = 600;

type DeliveredModule = AssessmentDeliveryBootstrap["sections"][number]["modules"][number];
type ModuleAttempt = AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"][number];

function moduleShape(
  id: string,
  title: string,
  displayOrder: number,
  patch: Partial<DeliveredModule> = {},
): DeliveredModule {
  return {
    id,
    moduleKey: id,
    title,
    displayOrder,
    durationSeconds: 1_800,
    targetQuestionCount: 1,
    adaptiveRole: "base",
    instructions: { version: 1, nodes: [] },
    toolPolicy: [],
    questions: [{ examQuestionId: `${id}-q1` }],
    ...patch,
  } as unknown as DeliveredModule;
}

function sectionShape(
  id: string,
  sectionKey: "reading-writing" | "math",
  displayOrder: number,
  modules: DeliveredModule[],
  breakAfterSeconds = 0,
) {
  return {
    id,
    sectionKey,
    title: sectionKey === "math" ? "Math" : "Reading and Writing",
    displayOrder,
    durationSeconds: 1_800,
    breakAfterSeconds,
    instructions: { version: 1, nodes: [] },
    modules,
  };
}

function activeAttempt(moduleId: string): ModuleAttempt {
  return {
    id: `ma-${moduleId}`,
    moduleId,
    state: "active",
    allocatedSeconds: 1_800,
    availableAt: SERVER_NOW,
    startedAt: SERVER_NOW,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: new Date(T0 + 1_800_000).toISOString(),
    remainingSeconds: 1_800,
    completionReason: null,
    rawCorrect: null,
    operationalQuestionCount: null,
    toolState: {},
    revision: 2,
  };
}

function lockedAttempt(moduleId: string): ModuleAttempt {
  return {
    ...activeAttempt(moduleId),
    state: "locked",
    deadlineAt: new Date(T0 - 1_000).toISOString(),
    remainingSeconds: 0,
    completionReason: "time_expired",
    revision: 3,
  };
}

function pendingAttempt(moduleId: string): ModuleAttempt {
  return {
    id: `ma-${moduleId}`,
    moduleId,
    state: "not_started",
    allocatedSeconds: 1_800,
    availableAt: SERVER_NOW,
    startedAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: null,
    remainingSeconds: 1_800,
    completionReason: null,
    rawCorrect: null,
    operationalQuestionCount: null,
    toolState: {},
    revision: 0,
  };
}

function pendingBreak(): AssessmentPersonalBreakSnapshot {
  return {
    id: BREAK_ID,
    afterSectionId: "section-rw",
    durationSeconds: BREAK_SECONDS,
    state: "pending",
    startsAt: null,
    deadlineAt: null,
    enteredAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    entryGeneration: 0,
    entryStartsAt: null,
    entryConfirmedAt: null,
    entryEnteredAt: null,
    remainingSeconds: 0,
    revision: 0,
  };
}

function delivery(patch: {
  sections: ReturnType<typeof sectionShape>[];
  moduleAttempts: ModuleAttempt[];
  personalBreaks?: AssessmentPersonalBreakSnapshot[];
  runtimeRevision?: number;
  scheduleRuntimeStatus?: "live" | "paused";
}): AssessmentDeliveryBootstrap {
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow: SERVER_NOW,
    candidateName: "Candidate",
    scheduleRuntimeStatus: patch.scheduleRuntimeStatus ?? "live",
    timing: {
      authority: "cohort_runtime",
      timingModel: "sat_personal_v1",
      stageKey: null,
      stageStatus: "live",
      serverNow: SERVER_NOW,
      deadlineAt: null,
      remainingSeconds: 0,
      runtimeRevision: patch.runtimeRevision ?? 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: patch.sections,
    attempt: {
      id: ATTEMPT_ID,
      moduleAttempts: patch.moduleAttempts,
      responses: [],
      ...(patch.personalBreaks ? { personalBreaks: patch.personalBreaks } : {}),
    },
    result: null,
  } as unknown as AssessmentDeliveryBootstrap;
}

/** The live exam just before the Reading & Writing clock runs out. */
function beforeClose(): AssessmentDeliveryBootstrap {
  return delivery({
    sections: [sectionShape("section-rw", "reading-writing", 0, [moduleShape(RW_ID, "Module 1", 0)], BREAK_SECONDS)],
    moduleAttempts: [activeAttempt(RW_ID)],
  });
}

/**
 * At the boundary with no break row yet: what an older server (no ack field)
 * or a lost close response leaves behind. Module 1 is already final, Math is
 * routed but not started, and only the authored `breakAfterSeconds` says a
 * break belongs here.
 */
function awaitingBreakRow(patch: {
  personalBreaks?: AssessmentPersonalBreakSnapshot[];
  breakAfterSeconds?: number;
  runtimeRevision?: number;
  scheduleRuntimeStatus?: "live" | "paused";
} = {}): AssessmentDeliveryBootstrap {
  const rwSection = sectionShape(
    "section-rw",
    "reading-writing",
    0,
    [moduleShape(RW_ID, "Module 1", 0)],
    patch.breakAfterSeconds ?? BREAK_SECONDS,
  );
  return delivery({
    sections: [
      rwSection,
      sectionShape("section-math", "math", 1, [moduleShape(MATH_ID, "Module 1", 1)]),
    ],
    moduleAttempts: [lockedAttempt(RW_ID), pendingAttempt(MATH_ID)],
    personalBreaks: patch.personalBreaks,
    runtimeRevision: patch.runtimeRevision,
    scheduleRuntimeStatus: patch.scheduleRuntimeStatus,
  });
}

function closeAck(): AssessmentModuleCloseAck {
  return {
    scheduleId: "schedule",
    attemptId: ATTEMPT_ID,
    moduleId: RW_ID,
    moduleAttemptId: `ma-${RW_ID}`,
    alreadyClosed: false,
    moduleAttempts: [lockedAttempt(RW_ID), pendingAttempt(MATH_ID)],
    nextModuleId: MATH_ID,
    selectedSection: sectionShape("section-math", "math", 1, [
      moduleShape(MATH_ID, "Module 1", 1, { questions: [], contentWithheld: true } as Partial<DeliveredModule>),
    ]) as unknown as AssessmentDeliveryBootstrap["sections"][number],
    serverNow: SERVER_NOW,
    personalBreaks: [pendingBreak()],
  };
}

function mount() {
  return renderHook(() =>
    useSatExamController({
      scheduleId: "schedule",
      attemptId: ATTEMPT_ID,
      candidateId: "candidate",
      attemptUpdateToken: 0,
      liveSocketConnected: false,
    }),
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("SAT section-boundary break projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.startModule.mockReset();
    gatewayMocks.sectionEntry.mockReset().mockResolvedValue({
      state: "not_applicable",
      versionId: "version",
      sectionKey: "math",
      formKey: "math_entry",
      canSubmit: false,
      canStart: false,
    });
    gatewayMocks.closeModule.mockReset();
    gatewayMocks.startBreak.mockReset();
    gatewayMocks.enterBreak.mockReset();
    gatewayMocks.markBreakVisible.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
  });

  it("arms the break from the close ack without a lifecycle read", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(beforeClose());
    gatewayMocks.closeModule.mockResolvedValue(closeAck());
    // The arm offer is left in flight: this case asserts the request, not the
    // confirmation that follows it.
    gatewayMocks.startBreak.mockReturnValue(new Promise(() => undefined));

    const hook = mount();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
    expect(hook.result.current.stateModule?.id).toBe(RW_ID);

    await act(async () => {
      hook.result.current.onTemporalBoundary("expiry", `module-end:${RW_ID}`);
    });

    // The ack alone moves the surface to `preparing`: no `none` phase (which
    // rendered "Preparing Math…"), no wait for the steady poll.
    await waitFor(() => expect(hook.result.current.pendingModule?.id).toBe(MATH_ID));
    expect(hook.result.current.breakWindow.phase).toBe("preparing");
    expect(hook.result.current.breakWindow.blocksEntry).toBe(true);
    expect(hook.result.current.data?.attempt.personalBreaks?.map((row) => row.id)).toEqual([BREAK_ID]);

    await act(async () => {
      hook.result.current.setBreakSurfaceMounted(true);
    });
    await waitFor(() => expect(gatewayMocks.startBreak).toHaveBeenCalled());
    expect(gatewayMocks.startBreak).toHaveBeenCalledWith("schedule", ATTEMPT_ID, BREAK_ID, {});

    // The whole boundary — route + break row + arm — came from the close ack.
    expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  describe("bounded boundary pull (old server / lost ack)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(SERVER_NOW));
      vi.spyOn(Math, "random").mockReturnValue(0.5);
    });

    it("reads until the break row lands, then stops", async () => {
      const noRow = awaitingBreakRow();
      const withRow = awaitingBreakRow({ personalBreaks: [pendingBreak()], runtimeRevision: 2 });
      gatewayMocks.bootstrap
        .mockResolvedValueOnce(noRow) // mount
        .mockResolvedValueOnce(noRow) // pull read 1
        .mockResolvedValue(withRow);  // pull read 2
      gatewayMocks.startBreak.mockReturnValue(new Promise(() => undefined));

      const hook = mount();
      await flush();
      expect(hook.result.current.pendingModule?.id).toBe(MATH_ID);
      expect(hook.result.current.breakWindow.phase).toBe("preparing");

      await act(async () => {
        hook.result.current.setBreakSurfaceMounted(true);
      });
      await flush();
      // First read happens immediately.
      expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(2);

      await advance(2_000);
      await flush();
      expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(3);
      expect(hook.result.current.data?.attempt.personalBreaks?.map((row) => row.id)).toEqual([BREAK_ID]);

      // The row is authoritative: the loop must not keep reading.
      await advance(10_000);
      await flush();
      expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(3);
      hook.unmount();
    });

    it("does not start when nothing is authored at the boundary", async () => {
      gatewayMocks.bootstrap.mockResolvedValue(awaitingBreakRow({ breakAfterSeconds: 0 }));
      const hook = mount();
      await flush();
      await act(async () => {
        hook.result.current.setBreakSurfaceMounted(true);
      });
      await advance(10_000);
      await flush();
      expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1);
      hook.unmount();
    });

    it("does not start when the break row already exists", async () => {
      gatewayMocks.bootstrap.mockResolvedValue(awaitingBreakRow({ personalBreaks: [pendingBreak()] }));
      gatewayMocks.startBreak.mockReturnValue(new Promise(() => undefined));
      const hook = mount();
      await flush();
      await act(async () => {
        hook.result.current.setBreakSurfaceMounted(true);
      });
      await advance(10_000);
      await flush();
      expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1);
      hook.unmount();
    });

    it("does not start while the runtime is not live", async () => {
      gatewayMocks.bootstrap.mockResolvedValue(
        awaitingBreakRow({ scheduleRuntimeStatus: "paused" }),
      );
      const hook = mount();
      await flush();
      await act(async () => {
        hook.result.current.setBreakSurfaceMounted(true);
      });
      await advance(10_000);
      await flush();
      expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(1);
      hook.unmount();
    });
  });
});
