import { describe, expect, it, vi } from "vitest";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleEntryStateAck,
} from "../../contracts/assessmentDelivery";
import {
  adoptEntryControlEpochFromAck,
  type EntryControlEpochSkipReason,
} from "../satEntryControlEpoch";

/**
 * The seam is deliberately path-agnostic: the SAT client's only entry mutation
 * today is single-operation `startModule`, but the personal-timing
 * offer/confirm path (`enterModule`) and the `entry-state` recovery read return
 * the SAME ack shape with the same post-commit epoch. These pin the contract
 * both paths inherit, so wiring either one later cannot silently drop it again.
 */

const SCHEDULE_ID = "schedule";
const ATTEMPT_ID = "attempt-1";

function entryAck(
  overrides: Partial<AssessmentModuleEntryStateAck> = {}
): AssessmentModuleEntryStateAck {
  return {
    scheduleId: SCHEDULE_ID,
    attemptId: ATTEMPT_ID,
    moduleId: "module-rw",
    moduleAttemptId: "ma-module-rw",
    moduleRevision: 2,
    state: "active",
    timingModel: "sat_personal_v1",
    entryState: "entered",
    entryGeneration: 1,
    serverNow: "2026-09-24T08:00:00.000Z",
    controlEpoch: 3,
    runtimeRevision: 1,
    ...overrides,
  };
}

function bootstrap(): AssessmentDeliveryBootstrap {
  return {
    scheduleId: SCHEDULE_ID,
    attempt: { id: ATTEMPT_ID },
  } as unknown as AssessmentDeliveryBootstrap;
}

function context(overrides: Partial<Parameters<typeof adoptEntryControlEpochFromAck>[1]> = {}) {
  return {
    scheduleId: SCHEDULE_ID,
    attemptId: ATTEMPT_ID,
    currentControlEpoch: 2,
    adopt: vi.fn(),
    onSkipped: vi.fn(),
    ...overrides,
  };
}

describe("satEntryControlEpoch adoption seam", () => {
  it("offers the post-commit epoch from a start ack", () => {
    const deps = context();
    expect(
      adoptEntryControlEpochFromAck(entryAck({ controlEpoch: 3 }), deps, "module_start")
    ).toEqual({
      offered: true,
      controlEpoch: 3,
    });
    expect(deps.adopt).toHaveBeenCalledWith(3, "module_start");
    expect(deps.onSkipped).not.toHaveBeenCalled();
  });

  it("offers the epoch from an enter ack under its own source label", () => {
    // Personal-timing offer/confirm: the server bumps control_epoch in
    // markProviderAttemptExamPhaseInTx and reads the ack back post-commit, so
    // the enter ack is adoptable exactly like the start ack.
    const deps = context();
    expect(
      adoptEntryControlEpochFromAck(entryAck({ controlEpoch: 4 }), deps, "module_enter")
    ).toEqual({
      offered: true,
      controlEpoch: 4,
    });
    expect(deps.adopt).toHaveBeenCalledWith(4, "module_enter");
  });

  it("offers the epoch from the entry-state recovery read", () => {
    // "Retry now" / lost-response recovery returns the same ack type; adopting
    // it is what lets a replayed entry land without a fresh 409.
    const deps = context();
    expect(
      adoptEntryControlEpochFromAck(entryAck({ controlEpoch: 5 }), deps, "entry_state_recovery")
    ).toEqual({ offered: true, controlEpoch: 5 });
    expect(deps.adopt).toHaveBeenCalledWith(5, "entry_state_recovery");
  });

  it("ignores a full bootstrap response (no epoch on the wire, no noise)", () => {
    const deps = context();
    expect(adoptEntryControlEpochFromAck(bootstrap(), deps, "module_start")).toEqual({
      offered: false,
      reason: "not_entry_ack",
    });
    expect(deps.adopt).not.toHaveBeenCalled();
    expect(deps.onSkipped).not.toHaveBeenCalled();
  });

  it("refuses an ack for another attempt or schedule and reports the reason", () => {
    const foreign = context();
    expect(
      adoptEntryControlEpochFromAck(
        entryAck({ attemptId: "attempt-other" }),
        foreign,
        "module_start"
      )
    ).toEqual({ offered: false, reason: "ack_identity_mismatch" });
    expect(foreign.adopt).not.toHaveBeenCalled();
    expect(foreign.onSkipped).toHaveBeenCalledWith("ack_identity_mismatch", "module_start");

    const otherSchedule = context();
    expect(
      adoptEntryControlEpochFromAck(
        entryAck({ scheduleId: "schedule-other" }),
        otherSchedule,
        "module_enter"
      )
    ).toEqual({ offered: false, reason: "ack_identity_mismatch" });
    expect(otherSchedule.adopt).not.toHaveBeenCalled();
  });

  it("refuses an unusable epoch value", () => {
    for (const controlEpoch of [0, -1, 1.5, Number.NaN]) {
      const deps = context();
      expect(
        adoptEntryControlEpochFromAck(entryAck({ controlEpoch }), deps, "module_start")
      ).toEqual({ offered: false, reason: "invalid_epoch" });
      expect(deps.adopt).not.toHaveBeenCalled();
      expect(deps.onSkipped).toHaveBeenCalledWith("invalid_epoch", "module_start");
    }
  });

  it("never rolls the believed epoch backwards, and still offers it to the engine", () => {
    // The local belief tracks what this client has SEEN, which can run ahead of
    // the engine when an earlier offer was refused as not-idle. The raised value
    // is offered anyway; the engine's monotonic clamp owns the decision.
    const deps = context({ currentControlEpoch: 7 });
    expect(
      adoptEntryControlEpochFromAck(entryAck({ controlEpoch: 4 }), deps, "module_start")
    ).toEqual({
      offered: true,
      controlEpoch: 7,
    });
    expect(deps.adopt).toHaveBeenCalledWith(7, "module_start");
  });

  it("treats an unknown current belief as zero", () => {
    const deps = context({ currentControlEpoch: null });
    expect(
      adoptEntryControlEpochFromAck(entryAck({ controlEpoch: 3 }), deps, "module_enter")
    ).toEqual({
      offered: true,
      controlEpoch: 3,
    });
    expect(deps.adopt).toHaveBeenCalledWith(3, "module_enter");
  });

  it("keeps one closed skip vocabulary for telemetry", () => {
    const reasons: EntryControlEpochSkipReason[] = [
      "not_entry_ack",
      "ack_identity_mismatch",
      "invalid_epoch",
    ];
    // Compile-time + runtime guard: the hook's reason-coded counter reuses these
    // exact strings, so the tests and the metric agree on the vocabulary.
    expect(reasons).toHaveLength(3);
  });
});
