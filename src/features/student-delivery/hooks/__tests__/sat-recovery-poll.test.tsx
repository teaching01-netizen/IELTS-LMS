import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * Integration coverage for the recovery-poll cadence and the shared clock, both
 * owned by pure policy modules:
 *   application/satPollCadence.ts    — how long until the next poll
 *   application/satTimingPolicy.ts   — whether the shared clock is running
 *
 * These assert the *scheduled* behaviour through the real hook (call times, not
 * just the arithmetic), because a cadence policy wired to the wrong timer or
 * fed a failure signal that never arrives is invisible to a unit test.
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

const SERVER_NOW = "2026-09-10T08:00:00.000Z";
const T0 = Date.parse(SERVER_NOW);
/** Far enough out that no section expiry fires during a cadence assertion. */
const SECTION_DEADLINE = new Date(T0 + 1_800_000).toISOString();

function deliveryPayload(
  options: {
    stageStatus?: "live" | "paused";
    /** Terminal projection: the attempt is scored and the runner completes. */
    result?: boolean;
  } = {},
): AssessmentDeliveryBootstrap {
  const { stageStatus = "live", result = false } = options;
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
      stageStatus,
      serverNow: SERVER_NOW,
      deadlineAt: SECTION_DEADLINE,
      remainingSeconds: 1_800,
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [
      {
        id: "section",
        sectionKey: "reading-writing",
        title: "RW",
        displayOrder: 0,
        durationSeconds: 1_800,
        breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: [
          {
            id: "module",
            moduleKey: "module",
            title: "Module",
            displayOrder: 0,
            durationSeconds: 1_800,
            targetQuestionCount: 1,
            adaptiveRole: "base",
            instructions: { version: 1, nodes: [] },
            toolPolicy: [],
            questions: [],
          },
        ],
      },
    ],
    attempt: {
      id: "attempt-a",
      moduleAttempts: [
        {
          id: "ma",
          moduleId: "module",
          state: "active",
          allocatedSeconds: 1_800,
          availableAt: SERVER_NOW,
          startedAt: SERVER_NOW,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionSeconds: 0,
          deadlineAt: SECTION_DEADLINE,
          remainingSeconds: 1_800,
          completionReason: null,
          rawCorrect: null,
          operationalQuestionCount: null,
          toolState: {},
          revision: 1,
        },
      ],
      responses: [],
    },
    result: result
      ? {
          id: "result-1",
          submissionId: "attempt-a",
          providerKey: "sat",
          totalScore: 1200,
          scorePayload: {},
          scoreKind: "practice",
          sections: [],
        }
      : null,
  };
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

function mount(liveSocketConnected: boolean) {
  return renderHook(() =>
    useSatExamController({
      scheduleId: "schedule",
      attemptId: "attempt-a",
      candidateId: "candidate",
      liveSocketConnected,
    }),
  );
}

function setBrowserOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

/** Records the offset of every bootstrap call relative to the fake epoch. */
function recordPollTimes() {
  const times: number[] = [];
  return {
    times,
    offsets: () => times.map((t) => t - T0),
    mock: (respond: (call: number) => AssessmentDeliveryBootstrap) => {
      gatewayMocks.bootstrap.mockImplementation(async () => {
        times.push(Date.now());
        return respond(times.length);
      });
    },
  };
}

describe("SAT recovery poll cadence (application/satPollCadence wired to the loop)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    // Full jitter: pin the random half of the window to its top so the
    // scheduled delay is exact instead of a range.
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  it("polls on the steady cadence while the live socket is connected", async () => {
    const polls = recordPollTimes();
    polls.mock(() => deliveryPayload());
    const hook = mount(true);
    await flush();
    expect(polls.offsets()).toEqual([0]);

    // Nothing may poll early, and the loop must keep polling: 20s apart.
    await advance(19_000);
    expect(polls.offsets()).toEqual([0]);
    await advance(61_000);
    expect(polls.offsets()).toEqual([0, 20_000, 40_000, 60_000, 80_000]);
    hook.unmount();
  });

  it("polls faster without the live socket", async () => {
    const polls = recordPollTimes();
    polls.mock(() => deliveryPayload());
    const hook = mount(false);
    await flush();
    // The failure window is 1–2s; at the top of it, 1.999s must not poll.
    await advance(1_999);
    expect(polls.offsets()).toEqual([0]);
    await advance(2_001);
    expect(polls.offsets()).toEqual([0, 2_000, 4_000]);
    hook.unmount();
  });

  // A failed poll must widen the window. refresh() resolves for a failed fetch,
  // so this only holds while the loop receives an explicit failure signal —
  // otherwise the counter never grows and every poll stays at the fast cadence.
  it("backs the offline cadence off exponentially and then holds the window", async () => {
    const polls = recordPollTimes();
    polls.mock((call) => {
      if (call === 1) return deliveryPayload();
      throw new Error("network down");
    });
    const hook = mount(false);
    await flush();
    // 2s -> 4s -> 8s -> 16s -> 16s (window held after three failures).
    await advance(115_000);
    expect(polls.offsets()).toEqual([
      0, 2_000, 6_000, 14_000, 30_000, 46_000, 62_000, 78_000, 94_000, 110_000,
    ]);
    hook.unmount();
  });

  // The offline path parks the loop on the `online` event. That handler is
  // per-outage, and an exam can have several outages: if a fired handler stays
  // registered, every later reconnect fires one poll per outage so far — a
  // request storm at exactly the moment the network is fragile, and a doubling
  // of the loop (each handler schedules its own timer).
  it("fires one reconnect poll per outage, not one per past outage", async () => {
    const polls = recordPollTimes();
    polls.mock(() => deliveryPayload());
    const hook = mount(false);
    await flush();
    expect(polls.offsets()).toEqual([0]);

    const reconnect = async () => {
      setBrowserOnline(true);
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await flush();
    };

    // Outage 1: the tick parks on the event instead of polling.
    setBrowserOnline(false);
    await advance(2_000);
    expect(polls.offsets()).toEqual([0]);
    await reconnect();
    const afterFirst = polls.offsets().length;
    expect(afterFirst).toBe(2);

    // Outage 2.
    setBrowserOnline(false);
    await advance(2_000);
    await reconnect();
    const afterSecond = polls.offsets().length;
    expect(afterSecond).toBe(afterFirst + 1);
    // ...and the loop is not doubled: the next window polls once.
    await advance(2_000);
    expect(polls.offsets().length).toBe(afterSecond + 1);

    // Outage 3.
    setBrowserOnline(false);
    await advance(2_000);
    await reconnect();
    expect(polls.offsets().length).toBe(afterSecond + 2);
    hook.unmount();
  });

  // Cleanup boundary: a runner unmounted mid-outage must not keep the parked
  // reconnect listener alive — a later `online` event would poll for a dead
  // attempt.
  it("drops the parked reconnect listener on unmount", async () => {
    const polls = recordPollTimes();
    polls.mock(() => deliveryPayload());
    const hook = mount(false);
    await flush();
    setBrowserOnline(false);
    await advance(2_000);
    const parked = polls.offsets().length;

    hook.unmount();
    setBrowserOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();
    expect(polls.offsets().length).toBe(parked);
  });

  it("stops polling once the runner completes", async () => {
    const polls = recordPollTimes();
    polls.mock((call) => deliveryPayload({ result: call > 1 }));
    const hook = mount(false);
    await flush();
    await advance(2_000);
    expect(hook.result.current.state.phase).toBe("complete");
    const atComplete = polls.offsets().length;
    await advance(30_000);
    expect(polls.offsets().length).toBe(atComplete);
    hook.unmount();
  });
});

describe("SAT shared clock under a cohort pause", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_NOW));
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.submit.mockResolvedValue({} as never);
    gatewayMocks.submitModule.mockImplementation(() => new Promise(() => {}));
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  // The deadline hook's `running` flag and the personal countdown now read the
  // same rule (satSharedClockRunning). A paused stage must freeze BOTH clocks so
  // a planned pause drill cannot drain a section to zero and trigger timeout finalization.
  it("freezes the shared clock on a paused stage and never submits", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(deliveryPayload({ stageStatus: "paused" }));
    const hook = mount(true);
    await flush();
    const startSeconds = hook.result.current.remainingSeconds;
    expect(startSeconds).toBeGreaterThan(0);

    await advance(90_000);
    expect(hook.result.current.remainingSeconds).toBe(startSeconds);
    expect(gatewayMocks.submitModule).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("runs the shared clock on a live stage (control)", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(deliveryPayload({ stageStatus: "live" }));
    const hook = mount(true);
    await flush();
    const startSeconds = hook.result.current.remainingSeconds;
    await advance(10_000);
    expect(hook.result.current.remainingSeconds).toBe(startSeconds - 10);
    hook.unmount();
  });
});
