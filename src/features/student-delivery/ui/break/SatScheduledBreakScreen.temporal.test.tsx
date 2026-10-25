import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentPersonalBreakSnapshot,
} from "../../contracts/assessmentDelivery";
import { SatTemporalRuntime } from "../../timing/SatTemporalRuntime";
import type { SatTemporalModel } from "../../timing/satTemporalModel";
import { SatScheduledBreakScreen } from "./SatScheduledBreakScreen";

// Real temporal provider: the screen reads SatTemporalRuntime's per-second
// snapshot, which is the path that used to render a live-provider 0:00.

const BREAK_SECONDS = 600;
const VERBAL_CLOSED_AT = Date.parse("2026-10-24T09:00:00.000Z");

function personalBreak(patch: Partial<AssessmentPersonalBreakSnapshot>): AssessmentPersonalBreakSnapshot {
  return {
    id: "break-1", afterSectionId: "rw", durationSeconds: BREAK_SECONDS, state: "pending",
    startsAt: null, deadlineAt: null, enteredAt: null, pausedAt: null, accumulatedPausedSeconds: 0,
    entryGeneration: 0, entryStartsAt: null, entryConfirmedAt: null, entryEnteredAt: null,
    remainingSeconds: 0, revision: 1,
    ...patch,
  };
}

function model(brk: AssessmentPersonalBreakSnapshot | null, receivedAt = Date.now()): SatTemporalModel {
  const serverNow = new Date(receivedAt).toISOString();
  const data = {
    scheduleId: "schedule-1", scheduleRuntimeStatus: "live", serverNow,
    timing: { authority: "legacy_attempt", timingModel: "sat_personal_v1", stageKey: null, stageStatus: null, serverNow, deadlineAt: null, remainingSeconds: 0, runtimeRevision: 1 },
    attempt: { id: "attempt-1", moduleAttempts: [], responses: [], personalBreaks: brk ? [brk] : [] },
    sections: [],
  } as unknown as AssessmentDeliveryBootstrap;
  return {
    data, effectiveTiming: data.timing, snapshotReceivedAt: receivedAt, effectiveTimingReceivedAt: receivedAt,
    stateModuleAttempt: undefined, stateSectionKey: null, pendingAttempt: undefined, pendingSectionKey: "math",
  };
}

function confirmed(startsAtMs: number): AssessmentPersonalBreakSnapshot {
  return personalBreak({
    state: "active", entryGeneration: 1,
    entryStartsAt: new Date(startsAtMs).toISOString(), entryConfirmedAt: new Date(startsAtMs - 2_000).toISOString(),
    startsAt: new Date(startsAtMs).toISOString(),
    deadlineAt: new Date(startsAtMs + BREAK_SECONDS * 1_000).toISOString(),
    remainingSeconds: BREAK_SECONDS + Math.ceil((startsAtMs - Date.now()) / 1_000), revision: 3,
  });
}

function view(current: SatTemporalModel, onBoundary = vi.fn()) {
  const ui = (next: SatTemporalModel) => (
    <SatTemporalRuntime model={next} onBoundary={onBoundary}>
      <SatScheduledBreakScreen phase="preparing" nextSectionKey="math" remainingSeconds={null} />
    </SatTemporalRuntime>
  );
  const rendered = render(ui(current));
  return { onBoundary, rerender: (next: SatTemporalModel) => rendered.rerender(ui(next)) };
}

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function expectNoZeroClock() {
  expect(screen.queryByText("0:00")).toBeNull();
  expect(screen.queryByRole("timer", { name: /0:00/ })).toBeNull();
  expect(screen.getByRole("status").textContent).not.toMatch(/0:00/);
}

afterEach(() => vi.useRealTimers());

describe("SatScheduledBreakScreen with the live temporal provider", () => {
  it.each([2_000, 5_000])(
    "after a %ims Verbal transition the break starts at its full configured duration",
    async (transitionDelayMs) => {
      vi.useFakeTimers();
      vi.setSystemTime(VERBAL_CLOSED_AT + transitionDelayMs);
      // The pending break reaches the browser after the delay.
      const surface = view(model(personalBreak({})));
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Preparing your break…");
      expect(screen.getByRole("status")).toHaveTextContent("Preparing your break.");
      expect(screen.queryByRole("timer")).toBeNull();
      expectNoZeroClock();

      // Arm + confirm land a server-issued start three seconds out.
      const startsAt = Date.now() + 3_000;
      surface.rerender(model(confirmed(startsAt)));
      for (let elapsed = 0; elapsed < 3_000; elapsed += 500) {
        expect(screen.queryByRole("timer")).toBeNull();
        expectNoZeroClock();
        await tick(500);
      }
      expect(screen.getByRole("timer")).toHaveTextContent("10:00");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Take a short break.");
      expect(screen.getByRole("status")).toHaveTextContent("Break started.");
      await tick(1_000);
      expect(screen.getByRole("timer")).toHaveTextContent("9:59");
      // A future start is not an ended break.
      expect(surface.onBoundary).not.toHaveBeenCalledWith("break-end", expect.anything());
    },
  );

  it("ends without a visible or announced 0:00 while Math state is delayed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(VERBAL_CLOSED_AT);
    const startsAt = VERBAL_CLOSED_AT - (BREAK_SECONDS - 3) * 1_000;
    const surface = view(model(confirmed(startsAt)));
    expect(screen.getByRole("timer")).toHaveTextContent("0:03");
    for (let step = 0; step < 16; step += 1) {
      await tick(500);
      expectNoZeroClock();
    }
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Preparing Math…");
    expect(screen.getByRole("status")).toHaveTextContent("Break over. Preparing Math.");
    const ends = surface.onBoundary.mock.calls.filter(([boundary]) => boundary === "break-end");
    expect(ends).toHaveLength(1);
    expect(ends[0]?.[1]).toContain("break-1");
    // The countdown slot keeps its space while hidden.
    const slot = screen.getByTestId("sat-scheduled-break").querySelector("[data-sat-break-timer]");
    expect(slot).toHaveAttribute("data-sat-break-timer", "reserved");
    expect(slot).toHaveAttribute("aria-hidden", "true");
  });

  it("holds preparation through a pause before the confirmed start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(VERBAL_CLOSED_AT);
    const startsAt = Date.now() + 3_000;
    const paused = { ...confirmed(startsAt), pausedAt: new Date(Date.now()).toISOString() };
    const surface = view(model(paused));
    await tick(10_000);
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Preparing your break…");
    expect(surface.onBoundary).not.toHaveBeenCalledWith("break-end", expect.anything());
  });

  it("freezes a paused countdown at its remaining time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(VERBAL_CLOSED_AT);
    const startsAt = Date.now() - 60_000;
    const paused = { ...confirmed(startsAt), pausedAt: new Date(Date.now()).toISOString(), remainingSeconds: BREAK_SECONDS - 60 };
    view(model(paused));
    await tick(5_000);
    expect(screen.getByRole("timer")).toHaveTextContent("9:00");
  });
});
