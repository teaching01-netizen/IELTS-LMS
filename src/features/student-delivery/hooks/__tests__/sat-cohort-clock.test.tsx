import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";
import { deriveSatTemporalSnapshot } from "../../timing/satTemporalModel";
import { SatTemporalRuntime } from "../../timing/SatTemporalRuntime";

function renderWithTemporalRuntime<T>(useHook: (props: any) => T, options?: { initialProps?: any }) {
  let current: any;
  function Harness({ hookProps }: { hookProps: any }) {
    current = useHook(hookProps);
    return (
      <SatTemporalRuntime model={current.temporalModel ?? null} onBoundary={current.onTemporalBoundary}>
        <div />
      </SatTemporalRuntime>
    );
  }
  const initialProps = options?.initialProps;
  const view = render(<Harness hookProps={initialProps} />);
  return {
    result: { get current() { return current; } },
    rerender: (props = initialProps) => view.rerender(<Harness hookProps={props} />),
    unmount: view.unmount,
  };
}

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

function cohortBootstrap(): AssessmentDeliveryBootstrap {
  return cohortBootstrapAt(new Date("2026-09-10T08:00:00.000Z").toISOString());
}

/** The same live cohort frame with an explicit server-now stamp, so a fake
 * server can hold an independent clock through a device jump. */
function cohortBootstrapAt(serverNow: string): AssessmentDeliveryBootstrap {
  return { ...cohortBootstrapBody(serverNow) };
}

function cohortBootstrapBody(serverNow: string): AssessmentDeliveryBootstrap {
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow,
    candidateName: "Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: "reading-writing",
      stageStatus: "live",
      serverNow,
      deadlineAt: new Date("2026-09-10T08:02:00.000Z").toISOString(),
      remainingSeconds: 120,
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [
      {
        id: "section", sectionKey: "reading-writing", title: "RW", displayOrder: 0,
        durationSeconds: 120, breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: [
          {
            id: "module", moduleKey: "module", title: "Module", displayOrder: 0,
            durationSeconds: 60, targetQuestionCount: 1, adaptiveRole: "base",
            instructions: { version: 1, nodes: [] }, toolPolicy: [], questions: [],
          },
        ],
      },
    ],
    attempt: {
      id: "attempt-a",
      moduleAttempts: [
        {
          id: "ma", moduleId: "module", state: "active", allocatedSeconds: 60,
          availableAt: serverNow, startedAt: serverNow, pausedAt: null,
          accumulatedPausedSeconds: 0, extensionSeconds: 0,
          deadlineAt: new Date("2026-09-10T08:01:00.000Z").toISOString(),
          remainingSeconds: 60, completionReason: null, rawCorrect: null,
          operationalQuestionCount: null, toolState: {}, revision: 1,
        },
      ],
      responses: [],
    },
    result: null,
  };
}

/**
 * Between-sections projection: the reading-writing section is complete, its
 * clock reads 0:00, and the server names the instant math goes live (the
 * authored gap). The student is on the shared break, not in a module.
 */
function breakBootstrap(): AssessmentDeliveryBootstrap {
  const serverNow = new Date("2026-09-10T08:00:00.000Z").toISOString();
  const nextSectionStartAt = new Date("2026-09-10T08:05:00.000Z").toISOString();
  return {
    ...cohortBootstrap(),
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: "reading-writing",
      stageStatus: "completed",
      serverNow,
      deadlineAt: null,
      remainingSeconds: 0,
      nextSectionStartAt,
      waitingForNextSection: true,
      runtimeRevision: 9,
    },
    sections: [
      {
        id: "section", sectionKey: "reading-writing", title: "RW", displayOrder: 0,
        durationSeconds: 120, breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: [
          {
            id: "module", moduleKey: "module", title: "Module", displayOrder: 0,
            durationSeconds: 60, targetQuestionCount: 1, adaptiveRole: "base",
            instructions: { version: 1, nodes: [] }, toolPolicy: [], questions: [],
          },
        ],
      },
      {
        id: "section-math", sectionKey: "math", title: "Math", displayOrder: 1,
        durationSeconds: 120, breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: [
          {
            id: "module-math", moduleKey: "module-math", title: "Math Module 1",
            displayOrder: 0, durationSeconds: 60, targetQuestionCount: 1,
            adaptiveRole: "base", instructions: { version: 1, nodes: [] },
            toolPolicy: [], questions: [],
          },
        ],
      },
    ],
    attempt: {
      id: "attempt-a",
      moduleAttempts: [
        {
          id: "ma", moduleId: "module", state: "submitted", allocatedSeconds: 60,
          availableAt: serverNow, startedAt: serverNow, pausedAt: null,
          accumulatedPausedSeconds: 0, extensionSeconds: 0,
          deadlineAt: new Date("2026-09-10T08:01:00.000Z").toISOString(),
          remainingSeconds: 0, completionReason: "time_expired", rawCorrect: null,
          operationalQuestionCount: null, toolState: {}, revision: 2,
        },
        {
          id: "ma-math", moduleId: "module-math", state: "not_started",
          allocatedSeconds: 60, availableAt: serverNow, startedAt: null,
          pausedAt: null, accumulatedPausedSeconds: 0, extensionSeconds: 0,
          deadlineAt: null, remainingSeconds: 60, completionReason: null,
          rawCorrect: null, operationalQuestionCount: null, toolState: {}, revision: 1,
        },
      ],
      responses: [],
    },
  };
}

describe("SAT cohort module clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T08:00:00.000Z"));
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.submit.mockResolvedValue({} as never);
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
  });

  // Module clock contract: the student reads the module's own allotment (60s),
  // capped by the shared section clock (120s) — min of the two, so the section
  // clock still bounds a late arrival or a stalled device. It advances locally
  // from the deadlines between bootstraps.
  it("ticks the module countdown between bootstraps (60 -> 50 after 10s)", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(cohortBootstrap());
    const hook = renderWithTemporalRuntime(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        liveSocketConnected: true,
      }),
    );
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    expect(hook.result.current.remainingSeconds).toBe(60);
    const bootstrapCalls = gatewayMocks.bootstrap.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    // No new bootstrap: the countdown must still advance from the deadline.
    expect(gatewayMocks.bootstrap.mock.calls.length).toBe(bootstrapCalls);
    expect(deriveSatTemporalSnapshot(hook.result.current.temporalModel, Date.now()).displaySeconds).toBe(50);
    vi.useRealTimers();
  });

  // The student clock freezes at its own allotment, flushes queued answers,
  // then asks the server for an authoritative reconciliation.
  it("freezes at its own allotment and reconciles without submitting", async () => {
    gatewayMocks.bootstrap.mockImplementation(() =>
      Promise.resolve(cohortBootstrapAt(new Date().toISOString())),
    );
    const hook = renderWithTemporalRuntime(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        liveSocketConnected: true,
      }),
    );
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    expect(hook.result.current.state.phase).toBe("module");
    // The module's 60s allotment, not the section's 120s.
    expect(hook.result.current.remainingSeconds).toBe(60);

    // +59s: still inside the module allotment, so nothing closes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(gatewayMocks.submitModule).not.toHaveBeenCalled();
    expect(deriveSatTemporalSnapshot(hook.result.current.temporalModel, Date.now()).displaySeconds).toBe(1);

    // +1s: the local module timer reaches zero while the section clock still
    // reads 60s. The client freezes and flushes; only server reconciliation
    // may close the module.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(hook.result.current.answerInteractionBlocked).toBe(true);
    expect(persistenceMock.flush).toHaveBeenCalled();
    expect(gatewayMocks.bootstrap.mock.calls.length).toBeGreaterThan(1);
    expect(gatewayMocks.submitModule).not.toHaveBeenCalled();
    hook.unmount();
    vi.useRealTimers();
  });

  // Device-sleep recovery: the browser clock is only a display oscillator, so
  // after the device resumes the countdown must be recomputed from the server
  // deadline plus a freshly paired (serverNow, receivedAt) observation — never
  // from ticks accumulated while asleep, and never by re-pairing the new
  // serverNow with the OLD receipt instant (that manufactures skew equal to
  // the sleep gap and double-counts it).
  it("recomputes the countdown from the deadline after a 30s device sleep", async () => {
    const T0 = Date.parse("2026-09-10T08:00:00.000Z");
    let serverNowMs = T0;
    gatewayMocks.bootstrap.mockImplementation(() =>
      Promise.resolve(cohortBootstrapAt(new Date(serverNowMs).toISOString())),
    );
    const hook = renderWithTemporalRuntime(
      ({ token }: { token: number }) =>
        useSatExamController({
          scheduleId: "schedule",
          attemptId: "attempt-a",
          candidateId: "candidate",
          liveSocketConnected: true,
          attemptUpdateToken: token,
        }),
      { initialProps: { token: 0 } },
    );
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    expect(hook.result.current.remainingSeconds).toBe(60);

    // The device sleeps 30s: no ticks fire and the device clock does not move;
    // server time advances the same 30s (device clock was in sync).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    serverNowMs += 30_000;

    // Wake token: one authoritative refresh with a fresh serverNow stamp.
    await act(async () => {
      hook.rerender({ token: 1 });
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    // Module deadline (T0+60) minus server truth (T0+30): 30. NOT 60 (stale
    // frame) and NOT 0 (the sleep gap counted twice by a stale receipt
    // pairing). The section clock still has 90s, so the module clock governs.
    expect(hook.result.current.remainingSeconds).toBe(30);
    expect(gatewayMocks.submitModule).not.toHaveBeenCalled();
    hook.unmount();
    vi.useRealTimers();
  });

  // Manual device-clock change: a student's clock jumping 4 minutes ahead must
  // not expire their exam. The next server sync re-pairs (serverNow, receivedAt)
  // into a NEGATIVE offset that cancels the jump, and the countdown continues
  // from server truth as if nothing happened.
  it("cancels a manual +4min device clock change at the next server sync", async () => {
    const T0 = Date.parse("2026-09-10T08:00:00.000Z");
    let serverNowMs = T0;
    gatewayMocks.bootstrap.mockImplementation(() =>
      Promise.resolve(cohortBootstrapAt(new Date(serverNowMs).toISOString())),
    );
    const hook = renderWithTemporalRuntime(
      ({ token }: { token: number }) =>
        useSatExamController({
          scheduleId: "schedule",
          attemptId: "attempt-a",
          candidateId: "candidate",
          liveSocketConnected: true,
          attemptUpdateToken: token,
        }),
      { initialProps: { token: 0 } },
    );
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    serverNowMs += 10_000;
    expect(deriveSatTemporalSnapshot(hook.result.current.temporalModel, Date.now()).displaySeconds).toBe(50);

    // The student's device clock jumps +4 minutes; the SERVER clock does not.
    vi.setSystemTime(new Date(Date.now() + 240_000));
    // Sync immediately (no local tick in between, so no premature expiry path
    // is exercised): the refresh carries serverNow = T0+10 while the receipt is
    // the jumped device instant.
    await act(async () => {
      hook.rerender({ token: 1 });
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    // Corrected offset = (T0+10) - (T0+250) = -240s; after the next display
    // tick (the shared 1s oscillator, whose fake timer clock still sits at
    // T+10s so a full second must elapse to cross a tick boundary) the
    // adjusted device now lands back on server truth — 11s genuinely consumed
    // of the module's 60s, so 49s remain and nothing expired. The +4min jump
    // was cancelled, not inherited: without the re-pairing the display would
    // read the module allotment as ~0 and close the module.
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(deriveSatTemporalSnapshot(hook.result.current.temporalModel, Date.now()).displaySeconds).toBe(49);
    expect(gatewayMocks.submitModule).not.toHaveBeenCalled();
    hook.unmount();
    vi.useRealTimers();
  });

  it("counts the authored break down to the next section's start", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(breakBootstrap());
    const hook = renderWithTemporalRuntime(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        liveSocketConnected: true,
      }),
    );
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    // Section reading-writing is complete and the server names the break end;
    // the finished section clock must not be reused as the countdown.
    expect(hook.result.current.pendingSectionWaitSeconds).toBe(0);
    const breakSeconds = hook.result.current.pendingBreakSeconds;
    expect(breakSeconds).toBeGreaterThan(290);
    expect(breakSeconds).toBeLessThanOrEqual(300);
    const bootstrapCalls = gatewayMocks.bootstrap.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(gatewayMocks.bootstrap.mock.calls.length).toBe(bootstrapCalls);
    expect(deriveSatTemporalSnapshot(hook.result.current.temporalModel, Date.now()).pendingBreakSeconds).toBe(breakSeconds - 10);
    vi.useRealTimers();
  });

  it("requests one recovery snapshot when the scheduled break reaches zero", async () => {
    const payload = breakBootstrap();
    payload.timing.nextSectionStartAt = new Date('2026-09-10T08:00:01.000Z').toISOString();
    gatewayMocks.bootstrap.mockResolvedValue(payload);
    const hook = renderWithTemporalRuntime(() => useSatExamController({
      scheduleId: 'schedule', attemptId: 'attempt-a', candidateId: 'candidate', liveSocketConnected: true,
    }));
    await act(async () => {
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
    const before = gatewayMocks.bootstrap.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(gatewayMocks.bootstrap.mock.calls.length).toBe(before + 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(gatewayMocks.bootstrap.mock.calls.length).toBe(before + 1);
    hook.unmount();
  });

  // Exactly-once timeout boundary: crossing the module deadline must block
  // interaction, flush once, and fire one recovery refresh — and staying past
  // the deadline must not refire any of them. Math.random is pinned so the
  // live-socket poll lands exactly on +20/+40/+60/+80, making the recovery
  // nudge countable apart from the scheduled polls.
  it("fires the timeout transition exactly once: one flush, one recovery refresh", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(1);
    try {
      gatewayMocks.bootstrap.mockResolvedValue(cohortBootstrap());
      const hook = renderWithTemporalRuntime(() =>
        useSatExamController({
          scheduleId: "schedule",
          attemptId: "attempt-a",
          candidateId: "candidate",
          liveSocketConnected: true,
        }),
      );
      await act(async () => {
        for (let i = 0; i < 12; i++) await Promise.resolve();
      });
      expect(hook.result.current.state.phase).toBe("module");

      // +59s: inside the allotment — polls fired at +20/+40, nothing closed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_000);
      });
      expect(hook.result.current.answerInteractionBlocked).toBe(false);
      gatewayMocks.bootstrap.mockClear();
      persistenceMock.flush.mockClear();

      // Cross T0+60: the +60 poll and the boundary wakeup fire together, so
      // the recovery nudge is exactly one bootstrap on top of the poll.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(hook.result.current.answerInteractionBlocked).toBe(true);
      expect(hook.result.current.timeoutTransitionStarted).toBe(true);
      expect(persistenceMock.flush).toHaveBeenCalledTimes(1);
      expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(2);
      expect(gatewayMocks.submitModule).not.toHaveBeenCalled();

      // Stay past the deadline (next poll due at +80): no refire.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(persistenceMock.flush).toHaveBeenCalledTimes(1);
      expect(gatewayMocks.bootstrap).toHaveBeenCalledTimes(2);
      expect(hook.result.current.answerInteractionBlocked).toBe(true);
      expect(gatewayMocks.submitModule).not.toHaveBeenCalled();
      hook.unmount();
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  // The memoized temporal model keeps a stable identity while authoritative
  // facts are unchanged: a parent re-render alone must not publish a new
  // context value and re-render every per-second temporal consumer.
  it("keeps the temporal model identical across re-renders with unchanged facts", async () => {
    gatewayMocks.bootstrap.mockResolvedValue(cohortBootstrap());
    const hook = renderWithTemporalRuntime(() =>
      useSatExamController({
        scheduleId: "schedule",
        attemptId: "attempt-a",
        candidateId: "candidate",
        liveSocketConnected: true,
      }),
    );
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    const before = hook.result.current.temporalModel;
    hook.rerender();
    expect(hook.result.current.temporalModel).toBe(before);
    hook.unmount();
    vi.useRealTimers();
  });
});
