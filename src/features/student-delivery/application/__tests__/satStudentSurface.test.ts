import { describe, expect, it } from "vitest";
import {
  deriveSatStudentStage,
  type DeriveSatStudentStageInput,
  type SatStudentStage,
} from "../satStudentSurface";

const ATTEMPT_KEY = "schedule-1:attempt-1:candidate-1";

function input(
  overrides: Partial<DeriveSatStudentStageInput> = {},
): DeriveSatStudentStageInput {
  return {
    runnerPhase: "directions",
    hasData: true,
    loadFailed: false,
    hasResult: false,
    terminated: false,
    terminatedByProctor: false,
    finalizationFailed: false,
    allModulesFinal: false,
    isInitialEntry: false,
    pendingModule: null,
    hasExamFrame: false,
    frameFresh: false,
    moduleResolved: false,
    moduleQuestionResolved: true,
    entryRecoverable: false,
    entryBlocked: false,
    entryHoldExpired: false,
    pendingBreakSeconds: 0,
    pendingSectionWaitSeconds: 0,
    entryInFlight: false,
    attemptKey: ATTEMPT_KEY,
    ...overrides,
  };
}

function pending(title: string, sectionKey: "reading-writing" | "math", startsNewSection = false) {
  return { id: `module-${title}`, title, sectionKey, startsNewSection } as const;
}

function derive(overrides: Partial<DeriveSatStudentStageInput> = {}): SatStudentStage {
  return deriveSatStudentStage(input(overrides));
}

describe("deriveSatStudentStage — terminal and finalizing surfaces", () => {
  it("owns the load failure and the not-yet-loaded wait", () => {
    expect(derive({ loadFailed: true, hasData: false })).toMatchObject({
      kind: "error",
      reason: "load",
    });
    expect(derive({ hasData: false })).toMatchObject({ kind: "pre-start", reason: "loading" });
  });

  it("keeps complete and terminated ahead of everything the runner says", () => {
    expect(derive({ hasResult: true })).toEqual({ kind: "complete", key: `complete:${ATTEMPT_KEY}` });
    expect(
      derive({ runnerPhase: "submitting", terminated: true, terminatedByProctor: true }),
    ).toMatchObject({ kind: "terminated", byProctor: true });
    expect(derive({ runnerPhase: "complete" })).toMatchObject({ kind: "complete" });
  });

  it.each([
    ["directions", { allModulesFinal: true }],
    ["submitting", {}],
  ] as const)("finalizes from %s as one stage with a retryable content", (runnerPhase, extra) => {
    expect(derive({ runnerPhase, ...extra })).toMatchObject({
      kind: "finalizing",
      failed: false,
      key: `finalizing:${ATTEMPT_KEY}`,
    });
    expect(derive({ runnerPhase, ...extra, finalizationFailed: true })).toMatchObject({
      kind: "finalizing",
      failed: true,
    });
  });
});

describe("deriveSatStudentStage — the scheduled break is only a section boundary", () => {
  it("crosses into a later section's first module through the break", () => {
    const stage = derive({
      pendingModule: pending("Module 1", "math", true),
      pendingBreakSeconds: 640,
    });
    expect(stage).toMatchObject({
      kind: "scheduled-break",
      phase: "on-break",
      remainingSeconds: 640,
      nextSectionKey: "math",
      entryProgress: "idle",
    });
  });

  it("counts the section clock down before the break opens", () => {
    expect(
      derive({
        pendingModule: pending("Module 1", "math", true),
        pendingSectionWaitSeconds: 300,
        pendingBreakSeconds: 640,
      }),
    ).toMatchObject({ kind: "scheduled-break", phase: "waiting-for-break", remainingSeconds: 300 });
  });

  it("names the entry progress while the next section opens", () => {
    const boundary = pending("Module 1", "math", true);
    expect(derive({ pendingModule: boundary, entryInFlight: true })).toMatchObject({
      kind: "scheduled-break",
      phase: "opening-next-section",
      remainingSeconds: null,
      entryProgress: "starting",
    });
    expect(derive({ pendingModule: boundary, entryRecoverable: true })).toMatchObject({
      entryProgress: "retrying",
    });
  });

  it("keeps every break phase on ONE stage key", () => {
    const boundary = pending("Module 1", "math", true);
    const waiting = derive({ pendingModule: boundary, pendingSectionWaitSeconds: 300 });
    const onBreak = derive({ pendingModule: boundary, pendingBreakSeconds: 600 });
    const opening = derive({ pendingModule: boundary, entryInFlight: true });
    expect(waiting.key).toBe(onBreak.key);
    expect(opening.key).toBe(onBreak.key);
    expect([waiting, onBreak, opening].map((stage) => stage.kind)).toEqual([
      "scheduled-break",
      "scheduled-break",
      "scheduled-break",
    ]);
  });

  it("takes the runner's own break phase as a boundary", () => {
    expect(derive({ runnerPhase: "break", pendingBreakSeconds: 60 })).toMatchObject({
      kind: "scheduled-break",
      phase: "on-break",
    });
  });
});

describe("deriveSatStudentStage — a module handoff never leaves the exam", () => {
  it.each(["reading-writing", "math"] as const)(
    "opens the next module inside the frame in %s",
    (sectionKey) => {
      const stage = derive({
        pendingModule: pending("Module 2", sectionKey),
        hasExamFrame: true,
        entryInFlight: true,
      });
      expect(stage).toMatchObject({
        kind: "exam",
        content: "opening",
        pendingModuleTitle: "Module 2",
      });
      // The same stage key as the live frame: the shell is reconciled, not
      // remounted, and the student never changes surface.
      expect(stage.key).toBe(
        derive({ runnerPhase: "module", moduleResolved: true }).key,
      );
    },
  );

  it("does not let a later section's Module 2 become a break", () => {
    // The regression: Math's section display order is 1, which used to look
    // like a boundary for Math Module 1 → Module 2.
    expect(
      derive({
        pendingModule: pending("Module 2", "math"),
        hasExamFrame: true,
        entryInFlight: true,
      }),
    ).toMatchObject({ kind: "exam", content: "opening" });
  });

  it("keeps the handoff in the frame while the entry retries", () => {
    const opening = derive({
      pendingModule: pending("Module 2", "math"),
      hasExamFrame: true,
      entryRecoverable: true,
      entryHoldExpired: true,
    });
    // No escalation to a recovery screen: the frame owns the whole handoff.
    expect(opening).toMatchObject({ kind: "exam", content: "opening" });
  });

  it("lets a proctor block own the screen instead of a stale frame", () => {
    expect(
      derive({
        pendingModule: pending("Module 2", "math"),
        hasExamFrame: true,
        entryBlocked: true,
      }),
    ).toMatchObject({ kind: "pre-start", reason: "waiting" });
  });
});

describe("deriveSatStudentStage — exam contents", () => {
  it("renders the resolved frame live, and holds it through a skew", () => {
    expect(derive({ runnerPhase: "module", moduleResolved: true })).toMatchObject({
      kind: "exam",
      content: "live",
    });
    expect(derive({ runnerPhase: "module", hasExamFrame: true, frameFresh: true })).toMatchObject({
      kind: "exam",
      content: "skew-hold",
    });
    expect(derive({ runnerPhase: "review" })).toMatchObject({
      kind: "exam",
      content: "refreshing",
    });
  });

  it("reports a question that cannot be resolved instead of an empty frame", () => {
    expect(
      derive({ runnerPhase: "module", moduleResolved: true, moduleQuestionResolved: false }),
    ).toMatchObject({ kind: "error", reason: "question" });
    // Review needs no single question, so it stays live.
    expect(derive({ runnerPhase: "review", moduleResolved: true })).toMatchObject({
      kind: "exam",
      content: "live",
    });
  });
});

describe("deriveSatStudentStage — the no-frame paths", () => {
  it("waits on pre-start for the first module and for a frame-less handoff", () => {
    expect(derive({ isInitialEntry: true })).toMatchObject({
      kind: "pre-start",
      reason: "initial",
    });
    expect(derive()).toMatchObject({ kind: "pre-start", reason: "restoring" });
  });

  it("escalates to the recovery surface once the hold window expires", () => {
    expect(
      derive({
        pendingModule: pending("Module 1", "math"),
        entryHoldExpired: true,
        entryRecoverable: true,
      }),
    ).toMatchObject({ kind: "entry-recovery", moduleId: "module-Module 1" });
  });

  it("treats a payload with the runner still loading as unrenderable", () => {
    expect(
      derive({ runnerPhase: "loading", hasExamFrame: true, frameFresh: true }),
    ).toMatchObject({ kind: "exam", content: "skew-hold" });
    expect(derive({ runnerPhase: "loading" })).toMatchObject({ kind: "error", reason: "state" });
  });
});

describe("deriveSatStudentStage — one stage per step, one key per stage", () => {
  it("gives every stage kind a non-empty presence key scoped to the attempt", () => {
    const stages: SatStudentStage[] = [
      derive({ loadFailed: true, hasData: false }),
      derive({ hasData: false }),
      derive({ hasResult: true }),
      derive({ terminated: true }),
      derive({ runnerPhase: "submitting" }),
      derive({ pendingModule: pending("Module 1", "math", true) }),
      derive({ runnerPhase: "module", moduleResolved: true }),
      derive({ runnerPhase: "module", hasExamFrame: true, frameFresh: true }),
      derive({ isInitialEntry: true }),
      derive({ entryHoldExpired: true }),
    ];
    for (const stage of stages) {
      expect(stage.key.length).toBeGreaterThan(0);
      expect(stage.kind.length).toBeGreaterThan(0);
    }
    // Identity is part of every key: a different attempt can never inherit the
    // presence of the one before it.
    expect(
      deriveSatStudentStage(input({ attemptKey: "other", hasResult: true })).key,
    ).not.toBe(derive({ hasResult: true }).key);
  });

  it("walks the runner's own phase sequence without changing the exam surface", () => {
    const live = derive({ runnerPhase: "module", moduleResolved: true });
    const submittingModule = derive({ runnerPhase: "module", moduleResolved: true });
    const handoff = derive({
      pendingModule: pending("Module 2", "math"),
      hasExamFrame: true,
      entryInFlight: true,
    });
    const nextModule = derive({ runnerPhase: "module", moduleResolved: true });
    expect(new Set([live.key, submittingModule.key, handoff.key, nextModule.key]).size).toBe(1);
  });
});
