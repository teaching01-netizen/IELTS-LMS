import { describe, expect, it } from "vitest";
import {
  deriveSatStudentTransitionSurface,
  type DeriveSatStudentTransitionSurfaceInput,
} from "../satStudentSurface";

function input(
  overrides: Partial<DeriveSatStudentTransitionSurfaceInput> = {},
): DeriveSatStudentTransitionSurfaceInput {
  return {
    runnerPhase: "directions",
    isInitialEntry: false,
    isBetweenSections: false,
    hasPreviousExamFrame: false,
    nextSectionKey: "math",
    pendingBreakSeconds: 0,
    pendingSectionWaitSeconds: 0,
    entryRecoverable: false,
    entryBlocked: false,
    entryHoldExpired: false,
    ...overrides,
  };
}

describe("deriveSatStudentTransitionSurface", () => {
  it("keeps initial entry on pre-start until a failed automatic attempt can be retried", () => {
    expect(deriveSatStudentTransitionSurface(input({ isInitialEntry: true }))).toEqual({
      kind: "pre-start",
      reason: "initial",
    });
    expect(
      deriveSatStudentTransitionSurface(
        input({ isInitialEntry: true, entryRecoverable: true, entryHoldExpired: true }),
      ),
    ).toEqual({ kind: "entry-recovery" });
  });

  it("holds the prior exam frame until the bounded handoff expires", () => {
    expect(
      deriveSatStudentTransitionSurface(input({ hasPreviousExamFrame: true })),
    ).toEqual({ kind: "hold-exam-frame" });
    expect(
      deriveSatStudentTransitionSurface(
        input({ hasPreviousExamFrame: true, entryHoldExpired: true }),
      ),
    ).toEqual({ kind: "entry-recovery" });
  });

  it("shows a restoring or waiting pre-start surface when no prior frame can be held", () => {
    expect(deriveSatStudentTransitionSurface(input())).toEqual({
      kind: "pre-start",
      reason: "restoring",
    });
    expect(
      deriveSatStudentTransitionSurface(input({ entryHoldExpired: true, entryBlocked: true })),
    ).toEqual({ kind: "pre-start", reason: "waiting" });
  });

  it("surfaces a proctor/runtime block immediately instead of holding a stale module", () => {
    expect(
      deriveSatStudentTransitionSurface(
        input({ hasPreviousExamFrame: true, entryBlocked: true }),
      ),
    ).toEqual({ kind: "pre-start", reason: "waiting" });
  });

  it("keeps every scheduled-break phase on one surface", () => {
    expect(
      deriveSatStudentTransitionSurface(
        input({ isBetweenSections: true, pendingSectionWaitSeconds: 90 }),
      ),
    ).toMatchObject({ kind: "scheduled-break", phase: "waiting-for-break", remainingSeconds: 90 });
    expect(
      deriveSatStudentTransitionSurface(input({ runnerPhase: "break", pendingBreakSeconds: 600 })),
    ).toMatchObject({ kind: "scheduled-break", phase: "on-break", remainingSeconds: 600 });
    expect(
      deriveSatStudentTransitionSurface(input({ runnerPhase: "break", pendingBreakSeconds: 0 })),
    ).toMatchObject({
      kind: "scheduled-break",
      phase: "opening-next-section",
      remainingSeconds: null,
    });
  });

  it.each(["loading", "module", "review", "submitting", "complete"] as const)(
    "leaves %s rendering to the route",
    (runnerPhase) => {
      expect(deriveSatStudentTransitionSurface(input({ runnerPhase }))).toBeNull();
    },
  );
});
