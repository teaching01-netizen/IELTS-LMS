import { describe, expect, it } from "vitest";
import type { AssessmentModuleAttemptSnapshot } from "../../contracts/assessmentDelivery";
import {
  satBreakCountdownSeconds,
  satClockOffsetMs,
  satCountdown,
  satExpectedStageKey,
  satModuleWindow,
  satPersonalClockRunning,
  satSectionWaitSeconds,
  satSharedClockRunning,
  satStageReady,
} from "../satTimingPolicy";

const LEGACY = "legacy_section_v1" as const;
const STAGE = "cohort_stage_v2" as const;
const SECTION = "cohort_section_v3" as const;
const PERSONAL = "sat_personal_v1" as const;

function pendingAttempt(
  overrides: Partial<AssessmentModuleAttemptSnapshot> = {},
): AssessmentModuleAttemptSnapshot {
  return {
    id: "ma-rw-m1",
    moduleId: "rw-m1",
    state: "not_started",
    allocatedSeconds: 1920,
    availableAt: null,
    startedAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionSeconds: 0,
    deadlineAt: null,
    remainingSeconds: null,
    entryWindowSeconds: 720,
    completionReason: null,
    rawCorrect: null,
    operationalQuestionCount: null,
    toolState: {},
    revision: 1,
    ...overrides,
  };
}

// The pre-entry half of the late-join fix: the screen may only promise what the
// server's own clamp will grant. Before this, a candidate who joined late read
// the authored module length and then met a much shorter clock on the next
// screen — the same complaint, one screen earlier.
//
// satModuleWindow is the ONE place that decides which of the two claims applies,
// and the same drain convention the module clock uses
// (domain/satTiming.drainSinceSnapshot) ticks it, so the promise cannot diverge
// from the clock the student lands in.
describe("SAT entry-window policy (late arrival)", () => {
  const SNAPSHOT_AT = 1_000_000;
  const AUTHORED = 1920;

  it("carries the server's published window, ticked since the payload landed", () => {
    expect(
      satModuleWindow({
        attempt: pendingAttempt(),
        authoredSeconds: AUTHORED,
        snapshotReceivedAt: SNAPSHOT_AT,
        now: SNAPSHOT_AT,
        running: true,
      }),
    ).toEqual({ seconds: 720, source: "granted" });
    // Twenty seconds later the room's window is twenty seconds shorter: the
    // promise is the same instants the write path clamps to, not a screenshot.
    expect(
      satModuleWindow({
        attempt: pendingAttempt(),
        authoredSeconds: AUTHORED,
        snapshotReceivedAt: SNAPSHOT_AT,
        now: SNAPSHOT_AT + 20_000,
        running: true,
      }),
    ).toEqual({ seconds: 700, source: "granted" });
  });

  it("reports an already-elapsed room window as no time at all", () => {
    expect(
      satModuleWindow({
        attempt: pendingAttempt({ entryWindowSeconds: 0 }),
        authoredSeconds: AUTHORED,
        snapshotReceivedAt: SNAPSHOT_AT,
        now: SNAPSHOT_AT,
        running: true,
      }),
    ).toEqual({ seconds: 0, source: "granted" });
  });

  it("freezes the promise while the room's clock is stopped", () => {
    expect(
      satModuleWindow({
        attempt: pendingAttempt(),
        authoredSeconds: AUTHORED,
        snapshotReceivedAt: SNAPSHOT_AT,
        now: SNAPSHOT_AT + 120_000,
        running: false,
      }),
    ).toEqual({ seconds: 720, source: "granted" });
  });

  it("falls back to the authored length on every frame the server said nothing", () => {
    // Started: the module's own deadlineAt/remainingSeconds are the truth, so
    // the pre-entry window must not outlive entry.
    expect(
      satModuleWindow({
        attempt: pendingAttempt({ state: "active", startedAt: "2026-09-20T02:00:00.000Z" }),
        authoredSeconds: AUTHORED,
        snapshotReceivedAt: SNAPSHOT_AT,
        now: SNAPSHOT_AT,
        running: true,
      }),
    ).toEqual({ seconds: AUTHORED, source: "authored" });
    // Older payloads, legacy providers, a section that has not opened.
    expect(
      satModuleWindow({
        attempt: pendingAttempt({ entryWindowSeconds: null }),
        authoredSeconds: AUTHORED,
        snapshotReceivedAt: SNAPSHOT_AT,
        now: SNAPSHOT_AT,
        running: true,
      }),
    ).toEqual({ seconds: AUTHORED, source: "authored" });
    expect(
      satModuleWindow({
        attempt: undefined,
        authoredSeconds: AUTHORED,
        snapshotReceivedAt: SNAPSHOT_AT,
        now: SNAPSHOT_AT,
        running: true,
      }),
    ).toEqual({ seconds: AUTHORED, source: "authored" });
  });

  // The wire pin, client side. The backend ships this field as JSON
  // (delivery.ModuleAttempt.tag: json:"entryWindowSeconds"); if either side
  // renames it, this read yields undefined, the claim silently reverts to the
  // authored length, and every other test still passes. So the key below is
  // parsed from a RAW payload — deliberately untyped, because a typed literal
  // would let tsc catch a rename the wire would not — and is asserted by name
  // against the same string the Go test pins
  // (TestModuleAttemptEntryWindowJSONKey).
  it("reads the field the server actually ships, by name", () => {
    const wire = JSON.parse(
      '{"id":"ma-rw-m1","moduleId":"rw-m1","state":"not_started",' +
        '"allocatedSeconds":1920,"startedAt":null,"deadlineAt":null,' +
        '"remainingSeconds":null,"entryWindowSeconds":720}',
    ) as AssessmentModuleAttemptSnapshot;
    expect(satModuleWindow({
      attempt: wire,
      authoredSeconds: AUTHORED,
      snapshotReceivedAt: SNAPSHOT_AT,
      now: SNAPSHOT_AT,
      running: true,
    })).toEqual({ seconds: 720, source: "granted" });
    // and the server's "nothing to say" still crosses as null, not as 0: a
    // missing key would be indistinguishable from a closed module.
    const silent = JSON.parse('{"state":"not_started","entryWindowSeconds":null}') as
      AssessmentModuleAttemptSnapshot;
    expect(satModuleWindow({
      attempt: silent,
      authoredSeconds: AUTHORED,
      snapshotReceivedAt: SNAPSHOT_AT,
      now: SNAPSHOT_AT,
      running: true,
    })).toEqual({ seconds: AUTHORED, source: "authored" });
  });
});

describe("SAT countdown policy (SAT-003)", () => {
  // The browser uses the published deadline to freeze input and flush saves;
  // finalization remains server-owned for every timing model.
  it("gives the legacy model the personal clock as both display and expiry", () => {
    expect(
      satCountdown({
        timingModel: LEGACY,
        stageKey: null,
        sectionKey: "RW1",
        personalSeconds: 90,
        authoritativeSeconds: 4000,
      }),
    ).toEqual({ displaySeconds: 90, expirySeconds: 90 });
  });

  it("lets the published stage clock own both roles in a stage-keyed cohort", () => {
    expect(
      satCountdown({
        timingModel: STAGE,
        stageKey: "RW1:m1",
        sectionKey: "RW1",
        personalSeconds: 90,
        authoritativeSeconds: 4000,
      }),
    ).toEqual({ displaySeconds: 4000, expirySeconds: 4000 });
  });

  it("uses only the attempt-owned clock for sat_personal_v1, independent of room stage", () => {
    expect(satCountdown({
      timingModel: PERSONAL,
      stageKey: "math",
      sectionKey: "reading-writing",
      personalSeconds: 120,
      authoritativeSeconds: 0,
    })).toEqual({ displaySeconds: 120, expirySeconds: 120 });
  });

  // The module clock contract: a candidate sits Module 1 plus exactly one
  // Module 2, so the section's authored length is M1 + one branch and the
  // module's own allotment is the countdown the student reads. The shared
  // section clock is the cap, not the countdown: it is what stops a late
  // arrival or a stalled device from outliving the section.
  it("shows the module allotment as both display and expiry for a section-keyed cohort", () => {
    expect(
      satCountdown({
        timingModel: SECTION,
        stageKey: "RW1",
        sectionKey: "RW1",
        personalSeconds: 90,
        authoritativeSeconds: 4000,
      }),
    ).toEqual({ displaySeconds: 90, expirySeconds: 90 });
    expect(
      satCountdown({
        timingModel: SECTION,
        stageKey: "RW1",
        sectionKey: "RW1",
        personalSeconds: 5000,
        authoritativeSeconds: 4000,
      }),
    ).toEqual({ displaySeconds: 4000, expirySeconds: 4000 });
  });

  // Two students in one cohort section: A entered at section start, B entered
  // 12s later with a full personal allotment. Their module clocks disagree by
  // that 12s — that is the point of a per-module clock — but neither may exceed
  // the shared section clock, which every student counts down identically.
  it("caps every student's module clock at the shared section clock", () => {
    const shared = (personalSeconds: number | null) =>
      satCountdown({
        timingModel: SECTION,
        stageKey: "RW1",
        sectionKey: "RW1",
        personalSeconds,
        authoritativeSeconds: 4000,
      });
    expect(shared(4000).displaySeconds).toBe(4000);
    expect(shared(3988).displaySeconds).toBe(3988);
    expect(shared(9000)).toEqual({ displaySeconds: 4000, expirySeconds: 4000 });
  });

  // A frame that has not hydrated the module attempt yet carries NO personal
  // clock. Reading it as zero would display 0:00 and arm the expiry on a payload
  // that is merely early; the section clock alone is the safe fallback.
  it("falls back to the section clock when the module attempt is not loaded", () => {
    expect(
      satCountdown({
        timingModel: SECTION,
        stageKey: "RW1",
        sectionKey: "RW1",
        personalSeconds: null,
        authoritativeSeconds: 900,
      }),
    ).toEqual({ displaySeconds: 900, expirySeconds: 900 });
    expect(
      satCountdown({
        timingModel: LEGACY,
        stageKey: null,
        sectionKey: "RW1",
        personalSeconds: null,
        authoritativeSeconds: 900,
      }),
    ).toEqual({ displaySeconds: 0, expirySeconds: 0 });
  });

  // No section identity (absent or empty key) is not "this module's section":
  // the display stays at zero and no expiry can fire, so an unidentifiable
  // frame can never trigger a local timeout transition.
  it("treats an absent or empty section key as no identity in a section-keyed cohort", () => {
    for (const sectionKey of [null, undefined, ""] as const) {
      expect(
        satCountdown({
          timingModel: SECTION,
          stageKey: "",
          sectionKey,
          personalSeconds: 12,
          authoritativeSeconds: 900,
        }),
      ).toEqual({ displaySeconds: 0, expirySeconds: null });
    }
  });

  // A module whose section identity is unknown must not be finalised even when
  // its own allotment is spent: display 0 with an inert expiry.
  it("stays inert with a spent module clock but no section identity", () => {
    expect(
      satCountdown({
        timingModel: SECTION,
        stageKey: "RW2",
        sectionKey: "RW1",
        personalSeconds: 0,
        authoritativeSeconds: 900,
      }),
    ).toEqual({ displaySeconds: 0, expirySeconds: null });
  });

  // The inert case: the shared clock is counting another section, so there is
  // no authority for this module; the local timeout must stay inert.
  it("has no expiry authority while the stage names another section", () => {
    expect(
      satCountdown({
        timingModel: SECTION,
        stageKey: "RW2",
        sectionKey: "RW1",
        personalSeconds: 12,
        authoritativeSeconds: 900,
      }),
    ).toEqual({ displaySeconds: 0, expirySeconds: null });
  });

  it("treats a missing timing model as legacy, never as cohort", () => {
    expect(
      satCountdown({
        timingModel: null,
        stageKey: null,
        sectionKey: null,
        personalSeconds: 7,
        authoritativeSeconds: 99,
      }),
    ).toEqual({ displaySeconds: 7, expirySeconds: 7 });
  });
});

describe("SAT clock offset", () => {
  it("shifts both clocks by the server/device skew", () => {
    const receivedAt = 1_000_000;
    expect(satClockOffsetMs("1970-01-01T00:16:45.000Z", receivedAt)).toBe(5_000);
  });

  it("is zero without a server timestamp", () => {
    expect(satClockOffsetMs(null, 1_000_000)).toBe(0);
    expect(satClockOffsetMs(undefined, 1_000_000)).toBe(0);
  });
});

describe("SAT clock running", () => {
  // One rule for the shared clock: the deadline hook and the personal countdown
  // must not disagree about whether the section clock ticks.
  it("runs the shared clock only while the runtime and the stage are live", () => {
    const live = { runtimeStatus: "live", stageStatus: "live" };
    expect(satSharedClockRunning(live)).toBe(true);
    expect(satSharedClockRunning({ ...live, stageStatus: "paused" })).toBe(false);
    expect(satSharedClockRunning({ ...live, runtimeStatus: "paused" })).toBe(false);
    expect(satSharedClockRunning({ runtimeStatus: undefined, stageStatus: null })).toBe(false);
  });

  it("always runs the personal clock outside cohort models", () => {
    expect(
      satPersonalClockRunning({ timingModel: LEGACY, runtimeStatus: "paused", stageStatus: "paused" }),
    ).toBe(true);
  });

  it("freezes the personal clock on a paused cohort stage and outside a live runtime", () => {
    const live = { timingModel: STAGE, runtimeStatus: "live", stageStatus: "live" };
    expect(satPersonalClockRunning(live)).toBe(true);
    expect(satPersonalClockRunning({ ...live, stageStatus: "paused" })).toBe(false);
    expect(satPersonalClockRunning({ ...live, runtimeStatus: "paused" })).toBe(false);
  });

  it("agrees with the shared clock in every cohort model", () => {
    for (const timingModel of [STAGE, SECTION] as const) {
      for (const runtimeStatus of ["live", "paused", "completed"]) {
        for (const stageStatus of ["live", "paused", null]) {
          expect(
            satPersonalClockRunning({ timingModel, runtimeStatus, stageStatus }),
          ).toBe(satSharedClockRunning({ runtimeStatus, stageStatus }));
        }
      }
    }
  });
});

describe("SAT expected stage key", () => {
  it("keys stage-keyed cohorts by section + adaptive role", () => {
    expect(satExpectedStageKey({ timingModel: STAGE, sectionKey: "RW1", adaptiveRole: "base" })).toBe(
      "RW1:m1",
    );
    expect(
      satExpectedStageKey({ timingModel: STAGE, sectionKey: "RW1", adaptiveRole: "adaptive" }),
    ).toBe("RW1:m2");
  });

  it("keys section-keyed cohorts by section alone", () => {
    expect(
      satExpectedStageKey({ timingModel: SECTION, sectionKey: "RW1", adaptiveRole: "base" }),
    ).toBe("RW1");
  });

  it("is null when the module identity is unknown", () => {
    expect(satExpectedStageKey({ timingModel: STAGE, sectionKey: null, adaptiveRole: "base" })).toBe(
      null,
    );
    expect(satExpectedStageKey({ timingModel: STAGE, sectionKey: "RW1", adaptiveRole: null })).toBe(
      null,
    );
  });

  // A payload that omits the key, or carries an empty one, has no stage
  // identity: building ":m1" from it would produce a key nothing can match.
  it("is null for an absent or empty key rather than building `:m1`", () => {
    for (const sectionKey of [undefined, ""] as const) {
      expect(satExpectedStageKey({ timingModel: STAGE, sectionKey, adaptiveRole: "base" })).toBe(
        null,
      );
    }
    for (const adaptiveRole of [undefined, ""] as const) {
      expect(satExpectedStageKey({ timingModel: STAGE, sectionKey: "RW1", adaptiveRole })).toBe(
        null,
      );
    }
  });
});

describe("SAT stage readiness", () => {
  it("is always ready outside cohort models", () => {
    expect(
      satStageReady({
        timingModel: LEGACY,
        stageKey: null,
        stageStatus: null,
        runtimeStatus: undefined,
        expectedStageKey: null,
      }),
    ).toBe(true);
  });

  it("requires the expected stage, a live stage and a live runtime", () => {
    const ready = {
      timingModel: SECTION,
      stageKey: "RW1",
      stageStatus: "live",
      runtimeStatus: "live",
      expectedStageKey: "RW1",
    };
    expect(satStageReady(ready)).toBe(true);
    expect(satStageReady({ ...ready, stageKey: "RW2" })).toBe(false);
    expect(satStageReady({ ...ready, stageStatus: "paused" })).toBe(false);
    expect(satStageReady({ ...ready, runtimeStatus: "paused" })).toBe(false);
  });

  // No identity to enter on means hold — and never "ready" against a null
  // expectation just because the server published no stage either.
  it("holds in cohort models when there is no expected stage", () => {
    expect(
      satStageReady({
        timingModel: SECTION,
        stageKey: null,
        stageStatus: "live",
        runtimeStatus: "live",
        expectedStageKey: null,
      }),
    ).toBe(false);
  });
});

describe("SAT section wait", () => {
  const waiting = {
    timingModel: SECTION,
    stageKey: "RW2",
    sectionKey: "RW1",
    runtimeStatus: "live",
    waitingForNextSection: false,
    authoritativeSeconds: 900,
  };

  it("counts the shared clock down while another section runs", () => {
    expect(satSectionWaitSeconds(waiting)).toBe(900);
  });

  it("is zero when this section is live, unpaused, or already waiting", () => {
    expect(satSectionWaitSeconds({ ...waiting, stageKey: "RW1" })).toBe(0);
    expect(satSectionWaitSeconds({ ...waiting, stageKey: null })).toBe(0);
    expect(satSectionWaitSeconds({ ...waiting, runtimeStatus: "paused" })).toBe(0);
    expect(satSectionWaitSeconds({ ...waiting, waitingForNextSection: true })).toBe(0);
  });

  it("is zero for stage-keyed and legacy models", () => {
    expect(satSectionWaitSeconds({ ...waiting, timingModel: STAGE })).toBe(0);
    expect(satSectionWaitSeconds({ ...waiting, timingModel: LEGACY })).toBe(0);
  });

  it("is zero without a section identity", () => {
    expect(satSectionWaitSeconds({ ...waiting, sectionKey: null })).toBe(0);
  });
});

describe("SAT break countdown", () => {
  it("counts the authored break for the legacy model", () => {
    expect(
      satBreakCountdownSeconds({
        timingModel: LEGACY,
        nextSectionStartAt: "2026-09-18T10:00:00Z",
        nextSectionStartSeconds: 300,
        legacyBreakSeconds: 42,
      }),
    ).toBe(42);
  });

  it("counts to the server's published next section start for cohort models", () => {
    expect(
      satBreakCountdownSeconds({
        timingModel: STAGE,
        nextSectionStartAt: "2026-09-18T10:00:00Z",
        nextSectionStartSeconds: 300,
        legacyBreakSeconds: 42,
      }),
    ).toBe(300);
  });

  it("is zero in a cohort model with no published start", () => {
    expect(
      satBreakCountdownSeconds({
        timingModel: SECTION,
        nextSectionStartAt: null,
        nextSectionStartSeconds: 300,
        legacyBreakSeconds: 42,
      }),
    ).toBe(0);
  });
});
