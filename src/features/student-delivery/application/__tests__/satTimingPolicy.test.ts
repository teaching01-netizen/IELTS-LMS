import { describe, expect, it } from "vitest";
import {
  satBreakCountdownSeconds,
  satClockOffsetMs,
  satCountdown,
  satExpectedStageKey,
  satPersonalClockRunning,
  satSectionWaitSeconds,
  satSharedClockRunning,
  satStageReady,
} from "../satTimingPolicy";

const LEGACY = "legacy_section_v1" as const;
const STAGE = "cohort_stage_v2" as const;
const SECTION = "cohort_section_v3" as const;

describe("SAT countdown policy (SAT-003)", () => {
  // The bug this policy exists to prevent: a cohort-section module whose
  // personal allotment ran out must not auto-submit, because the backend only
  // enforces a personal deadline for the legacy model.
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

  // The cohort clock contract: in a synchronized cohort the shared section
  // clock is BOTH the display and the expiry, regardless of the student's
  // personal allotment. A personal term in the display would give two students
  // who entered at different moments two different countdowns for the same
  // shared exam, so started_at never creates the visible cohort clock.
  it("shows the section clock as both display and expiry for a section-keyed cohort", () => {
    expect(
      satCountdown({
        timingModel: SECTION,
        stageKey: "RW1",
        sectionKey: "RW1",
        personalSeconds: 90,
        authoritativeSeconds: 4000,
      }),
    ).toEqual({ displaySeconds: 4000, expirySeconds: 4000 });
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
  // 12s later with a full personal allotment. Their personal clocks disagree;
  // the displayed countdown must not.
  it("shows every student in the cohort the same countdown regardless of entry time", () => {
    const shared = (personalSeconds: number) =>
      satCountdown({
        timingModel: SECTION,
        stageKey: "RW1",
        sectionKey: "RW1",
        personalSeconds,
        authoritativeSeconds: 4000,
      });
    const studentA = shared(4000);
    const studentB = shared(3988);
    expect(studentA.displaySeconds).toBe(studentB.displaySeconds);
    expect(studentA.expirySeconds).toBe(studentB.expirySeconds);
    expect(studentA.displaySeconds).toBe(4000);
  });

  // No section identity (absent or empty key) is not "this module's section":
  // the display stays at zero and no expiry can fire, so an unidentifiable
  // frame can never auto-submit.
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

  // The inert case: the shared clock is counting another section, so there is
  // no authority for this module at all — a submit would be rejected anyway.
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
