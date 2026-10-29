import { describe, expect, it } from "vitest";
import type { AssessmentPersonalBreakSnapshot } from "../../contracts/assessmentDelivery";
import { satBreakWindow } from "../satTimingPolicy";

const NOW = Date.parse("2026-10-29T09:00:00.000Z");

function row(patch: Partial<AssessmentPersonalBreakSnapshot>): AssessmentPersonalBreakSnapshot {
  return {
    id: "break-1",
    afterSectionId: "sec-rw",
    durationSeconds: 600,
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
    ...patch,
  };
}

function window(patch: Partial<Parameters<typeof satBreakWindow>[0]>) {
  return satBreakWindow({
    timingModel: "sat_personal_v1",
    personalBreak: null,
    serverNowMs: NOW,
    sharedSeconds: 0,
    ...patch,
  });
}

describe("satBreakWindow at a section boundary", () => {
  it("prepares when a break is authored but the payload has no row yet", () => {
    // The close ack normally supplies the row; this is the moment before it
    // lands. Reporting `none` here is what rendered "Preparing Math…" for 10–20 s.
    expect(window({ authoredBreakSeconds: 600 })).toEqual({
      phase: "preparing",
      seconds: null,
      blocksEntry: true,
      leadSeconds: null,
    });
  });

  it("stays terminal when nothing is authored", () => {
    expect(window({})).toEqual({
      phase: "none",
      seconds: null,
      blocksEntry: false,
      leadSeconds: null,
    });
  });

  it("does not resurrect a completed break from authored metadata", () => {
    expect(window({ personalBreak: row({ state: "completed" }), authoredBreakSeconds: 600 }).phase).toBe("none");
  });

  it("keeps a pending or armed row in preparing", () => {
    expect(window({ personalBreak: row({ state: "pending" }) }).phase).toBe("preparing");
    expect(window({ personalBreak: row({ state: "armed" }) }).phase).toBe("preparing");
  });

  it("counts into a confirmed future start instead of showing a blank slot", () => {
    const startsAt = NOW + 3_000;
    expect(
      window({
        personalBreak: row({
          state: "active",
          startsAt: new Date(startsAt).toISOString(),
          deadlineAt: new Date(startsAt + 600_000).toISOString(),
          remainingSeconds: 603,
        }),
      }),
    ).toEqual({
      phase: "preparing",
      seconds: null,
      blocksEntry: true,
      leadSeconds: 3,
    });
  });

  it("counts down once the confirmed start has arrived", () => {
    const startsAt = NOW - 60_000;
    expect(
      window({
        personalBreak: row({
          state: "active",
          startsAt: new Date(startsAt).toISOString(),
          deadlineAt: new Date(startsAt + 600_000).toISOString(),
          remainingSeconds: 540,
        }),
      }),
    ).toEqual({
      phase: "active",
      seconds: 540,
      blocksEntry: true,
      leadSeconds: null,
    });
  });

  it("ends at the deadline", () => {
    const startsAt = NOW - 600_000;
    expect(
      window({
        personalBreak: row({
          state: "active",
          startsAt: new Date(startsAt).toISOString(),
          deadlineAt: new Date(startsAt + 600_000).toISOString(),
          remainingSeconds: 0,
        }),
      }).phase,
    ).toBe("ending");
  });

  it("freezes a paused countdown with no lead", () => {
    const startsAt = NOW + 60_000;
    expect(
      window({
        personalBreak: row({
          state: "active",
          startsAt: new Date(startsAt).toISOString(),
          deadlineAt: new Date(startsAt + 600_000).toISOString(),
          pausedAt: new Date(NOW).toISOString(),
          remainingSeconds: 540,
        }),
      }),
    ).toEqual({
      phase: "preparing",
      seconds: null,
      blocksEntry: true,
      leadSeconds: null,
    });
  });
});

describe("satBreakWindow for cohort/legacy models", () => {
  it("keeps the shared countdown and ignores the authored boundary value", () => {
    expect(
      window({ timingModel: "cohort_section_v3", sharedSeconds: 300, authoredBreakSeconds: 600 }),
    ).toEqual({
      phase: "active",
      seconds: 300,
      blocksEntry: true,
      leadSeconds: null,
    });
    expect(
      window({ timingModel: "cohort_section_v3", sharedSeconds: 0, authoredBreakSeconds: 600 }),
    ).toEqual({
      phase: "none",
      seconds: null,
      blocksEntry: false,
      leadSeconds: null,
    });
  });
});
