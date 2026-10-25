import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentPersonalBreakSnapshot,
} from "../../contracts/assessmentDelivery";
import { satBreakWindow } from "../../application/satTimingPolicy";
import { deriveSatStudentStage, type DeriveSatStudentStageInput } from "../../application/satStudentSurface";
import {
  decideSatBreakEntryStep,
  satBreakReplacementLeadSeconds,
  useSatBreakEntry,
} from "../useSatBreakEntry";

const NOW = Date.parse("2026-10-24T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function brk(patch: Partial<AssessmentPersonalBreakSnapshot> = {}): AssessmentPersonalBreakSnapshot {
  return {
    id: "break-1", afterSectionId: "rw", durationSeconds: 600, state: "pending",
    startsAt: null, deadlineAt: null, enteredAt: null, pausedAt: null, accumulatedPausedSeconds: 0,
    entryGeneration: 0, entryStartsAt: null, entryConfirmedAt: null, entryEnteredAt: null,
    remainingSeconds: 0, revision: 1, ...patch,
  };
}
const armed = (offerAt: number, generation = 1) =>
  brk({ state: "armed", entryGeneration: generation, entryStartsAt: iso(offerAt), revision: generation + 1 });
const active = (startsAt: number, patch: Partial<AssessmentPersonalBreakSnapshot> = {}) =>
  brk({
    state: "active", entryGeneration: 1, entryStartsAt: iso(startsAt), entryConfirmedAt: iso(startsAt - 1_000),
    startsAt: iso(startsAt), deadlineAt: iso(startsAt + 600_000), remainingSeconds: 600, revision: 3, ...patch,
  });

describe("satBreakWindow", () => {
  const personal = (b: AssessmentPersonalBreakSnapshot | null, now = NOW) =>
    satBreakWindow({ timingModel: "sat_personal_v1", personalBreak: b, serverNowMs: now, sharedSeconds: 0 });

  it("prepares, counts down from the full duration, then ends — blocking entry throughout", () => {
    expect(personal(brk())).toEqual({ phase: "preparing", seconds: null, blocksEntry: true });
    expect(personal(armed(NOW + 3_000))).toEqual({ phase: "preparing", seconds: null, blocksEntry: true });
    expect(personal(active(NOW + 1))).toEqual({ phase: "preparing", seconds: null, blocksEntry: true });
    expect(personal(active(NOW))).toEqual({ phase: "active", seconds: 600, blocksEntry: true });
    expect(personal(active(NOW - 599_500))).toEqual({ phase: "active", seconds: 1, blocksEntry: true });
    expect(personal(active(NOW - 600_000))).toEqual({ phase: "ending", seconds: null, blocksEntry: true });
    expect(personal(active(NOW - 900_000, { state: "completed" }))).toEqual({ phase: "none", seconds: null, blocksEntry: false });
    expect(personal(null).blocksEntry).toBe(false);
  });

  it("keeps a pause before the start in preparation and freezes a running countdown", () => {
    expect(personal(active(NOW + 2_000, { pausedAt: iso(NOW) }), NOW + 60_000).phase).toBe("preparing");
    expect(personal(active(NOW - 60_000, { pausedAt: iso(NOW), remainingSeconds: 540 }), NOW + 60_000))
      .toEqual({ phase: "active", seconds: 540, blocksEntry: true });
  });

  it("derives a shared cohort break from its countdown alone", () => {
    const shared = (seconds: number) =>
      satBreakWindow({ timingModel: "cohort_section_v3", personalBreak: null, serverNowMs: NOW, sharedSeconds: seconds });
    expect(shared(120)).toEqual({ phase: "active", seconds: 120, blocksEntry: true });
    expect(shared(0)).toEqual({ phase: "none", seconds: null, blocksEntry: false });
  });
});

describe("break stage and entry gating", () => {
  const base: DeriveSatStudentStageInput = {
    runnerPhase: "break", hasData: true, loadFailed: false, hasResult: false, terminated: false,
    terminatedByProctor: false, finalizationFailed: false, allModulesFinal: false, isInitialEntry: false,
    pendingModule: { id: "math-1", title: "Module 1", sectionKey: "math", startsNewSection: true, started: false },
    explicitModuleEntryRequired: true, hasExamFrame: false, frameFresh: false, moduleResolved: false,
    moduleQuestionResolved: false, pendingBreakSeconds: 0, pendingSectionWaitSeconds: 0, attemptKey: "a",
  };
  it.each(["preparing", "ending"] as const)("holds the break surface (no Begin module) while %s", (phase) => {
    const stage = deriveSatStudentStage({ ...base, breakWindow: { phase, seconds: null, blocksEntry: true } });
    expect(stage).toMatchObject({ kind: "scheduled-break", phase, remainingSeconds: null });
  });
  it("offers explicit entry only once the break no longer blocks", () => {
    const stage = deriveSatStudentStage({ ...base, breakWindow: { phase: "none", seconds: null, blocksEntry: false } });
    expect(stage).toMatchObject({ kind: "pre-start", reason: "module-entry" });
  });
});

describe("decideSatBreakEntryStep", () => {
  it("arms a pending break with the default lead and confirms a viable offer", () => {
    expect(decideSatBreakEntryStep(brk(), NOW, null)).toEqual({ kind: "arm" });
    expect(decideSatBreakEntryStep(armed(NOW + 3_000), NOW, 200)).toEqual({ kind: "confirm" });
  });
  it("waits out an offer with too little lead left, then replaces it with a measured lead", () => {
    expect(decideSatBreakEntryStep(armed(NOW + 1_000), NOW, 2_500)).toEqual({ kind: "wait", delayMs: 1_001 });
    expect(decideSatBreakEntryStep(armed(NOW - 1), NOW, 2_500)).toEqual({ kind: "arm", leadSeconds: 7 });
  });
  it("never re-arms a confirmed break; it acknowledges the first frame once started", () => {
    expect(decideSatBreakEntryStep(active(NOW + 2_000), NOW, 100)).toEqual({ kind: "wait", delayMs: 2_001 });
    expect(decideSatBreakEntryStep(active(NOW - 10), NOW, 100)).toEqual({ kind: "visible" });
    expect(decideSatBreakEntryStep(active(NOW - 10, { entryEnteredAt: iso(NOW) }), NOW, 100)).toEqual({ kind: "none" });
  });
  it("keeps the replacement lead inside 3–12 seconds", () => {
    expect(satBreakReplacementLeadSeconds(0)).toBe(3);
    expect(satBreakReplacementLeadSeconds(3_000)).toBe(8);
    expect(satBreakReplacementLeadSeconds(30_000)).toBe(12);
  });
});

function payload(b: AssessmentPersonalBreakSnapshot): AssessmentDeliveryBootstrap {
  return { attempt: { personalBreaks: [b] } } as unknown as AssessmentDeliveryBootstrap;
}

function harness(initial: AssessmentPersonalBreakSnapshot, gateway: {
  startBreak: ReturnType<typeof vi.fn>;
  enterBreak: ReturnType<typeof vi.fn>;
  markBreakVisible: ReturnType<typeof vi.fn>;
}, authoritative: () => AssessmentPersonalBreakSnapshot) {
  const commits: AssessmentPersonalBreakSnapshot[] = [];
  return renderHook(() => {
    const [current, setCurrent] = useState(initial);
    const state = useSatBreakEntry({
      identity: "s:a:c", enabled: true, personalBreak: current, serverClockOffsetMs: 0,
      scheduleId: "s", attemptId: "a", gateway,
      withControlEpoch: (request) => request(4),
      commit: (next) => {
        const b = next.attempt.personalBreaks![0]!;
        commits.push(b);
        setCurrent(b);
      },
      refresh: async () => setCurrent(authoritative()),
    });
    return { state, current, commits };
  });
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe("useSatBreakEntry", () => {
  afterEach(() => vi.useRealTimers());

  it("arms then confirms once, then acknowledges the first frame at the server start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const confirmedBreak = active(NOW + 3_000);
    const gateway = {
      startBreak: vi.fn(async () => payload(armed(NOW + 3_000))),
      enterBreak: vi.fn(async () => payload(confirmedBreak)),
      markBreakVisible: vi.fn(async () => payload({ ...confirmedBreak, entryEnteredAt: iso(NOW + 3_000) })),
    };
    const hook = harness(brk(), gateway, () => brk());
    await flush();
    await flush();
    expect(gateway.startBreak).toHaveBeenCalledTimes(1);
    expect(gateway.startBreak).toHaveBeenCalledWith("s", "a", "break-1", { controlEpoch: 4 });
    expect(gateway.enterBreak).toHaveBeenCalledWith("s", "a", { breakId: "break-1", generation: 1, controlEpoch: 4 });
    expect(gateway.markBreakVisible).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    expect(gateway.markBreakVisible).toHaveBeenCalledTimes(1);
    expect(hook.result.current.current.entryEnteredAt).not.toBeNull();
    expect(gateway.startBreak).toHaveBeenCalledTimes(1);
    expect(gateway.enterBreak).toHaveBeenCalledTimes(1);
  });

  it("resumes a confirmation whose response was lost instead of granting another break", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const committed = active(NOW + 2_000);
    const gateway = {
      startBreak: vi.fn(),
      enterBreak: vi.fn(async () => { throw new TypeError("Failed to fetch"); }),
      markBreakVisible: vi.fn(async () => payload({ ...committed, entryEnteredAt: iso(NOW + 2_000) })),
    };
    const hook = harness(armed(NOW + 3_000), gateway, () => committed);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(hook.result.current.current).toEqual(committed);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(gateway.enterBreak).toHaveBeenCalledTimes(1);
    expect(gateway.startBreak).not.toHaveBeenCalled();
    expect(hook.result.current.current.deadlineAt).toBe(committed.deadlineAt);
  });

  it("re-arms a missed, unconfirmed offer with a conservative lead before any measurement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const missed = armed(NOW - 1);
    const gateway = {
      startBreak: vi.fn(async (_s: string, _a: string, _b: string, request?: { leadSeconds?: number }) =>
        payload(armed(Date.now() + (request?.leadSeconds ?? 3) * 1_000, 2))),
      enterBreak: vi.fn(async () => payload(active(Date.now() + 5_000))),
      markBreakVisible: vi.fn(async () => payload(active(NOW))),
    };
    harness(missed, gateway, () => missed);
    await flush();
    await flush();
    expect(gateway.startBreak).toHaveBeenCalledTimes(1);
    // Unmeasured round trip (e.g. after a reload) is assumed to be 3s.
    expect(gateway.startBreak.mock.calls[0]?.[3]).toEqual({ controlEpoch: 4, leadSeconds: 8 });
    expect(gateway.enterBreak).toHaveBeenCalledWith("s", "a", { breakId: "break-1", generation: 2, controlEpoch: 4 });
  });

  it("surfaces an exhausted offer budget instead of retrying", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const exhausted = Object.assign(new Error("exhausted"), { status: 409, details: { reason: "BREAK_RETRY_EXHAUSTED" } });
    const gateway = {
      startBreak: vi.fn(async () => { throw exhausted; }),
      enterBreak: vi.fn(),
      markBreakVisible: vi.fn(),
    };
    const hook = harness(armed(NOW - 1, 4), gateway, () => armed(NOW - 1, 4));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(gateway.startBreak).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.blocked).toMatch(/ask your proctor/i);
  });
});
