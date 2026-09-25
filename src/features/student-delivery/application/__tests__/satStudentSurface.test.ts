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
    pendingBreakSeconds: 0,
    pendingSectionWaitSeconds: 0,
    attemptKey: ATTEMPT_KEY,
    ...overrides,
  };
}

function pending(
  title: string,
  sectionKey: "reading-writing" | "math",
  startsNewSection = false,
  started = false,
) {
  return { id: `module-${title}`, title, sectionKey, startsNewSection, started } as const;
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
    expect(
      derive({ runnerPhase: "complete", hasResult: true, terminated: true, terminatedByProctor: true }),
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
      phase: "active",
      remainingSeconds: 640,
      nextSectionKey: "math",
    });
  });

  it("counts the section clock down before the break opens", () => {
    expect(
      derive({
        pendingModule: pending("Module 1", "math", true),
        pendingSectionWaitSeconds: 300,
        pendingBreakSeconds: 0,
      }),
    ).toMatchObject({ kind: "scheduled-break", phase: "waiting", remainingSeconds: 300 });
  });

  it("keeps every break phase on ONE stage key", () => {
    const boundary = pending("Module 1", "math", true);
    const waiting = derive({ pendingModule: boundary, pendingSectionWaitSeconds: 300, pendingBreakSeconds: 0 });
    const onBreak = derive({ pendingModule: boundary, pendingBreakSeconds: 600 });
    expect(waiting.key).toBe(onBreak.key);
    expect([waiting, onBreak].map((stage) => stage.kind)).toEqual([
      "scheduled-break",
      "scheduled-break",
    ]);
  });

  it("takes the runner's own break phase as a boundary", () => {
    expect(derive({ runnerPhase: "break", pendingBreakSeconds: 60 })).toMatchObject({
      kind: "scheduled-break",
      phase: "active",
    });
  });

  it("returns to an already-started section module after resume", () => {
    const activeModule = pending("Module 1", "math", true, true);
    expect(
      derive({
        runnerPhase: "module",
        pendingModule: activeModule,
        moduleResolved: true,
      }),
    ).toMatchObject({ kind: "exam", content: "live" });
    expect(
      derive({
        runnerPhase: "break",
        pendingModule: activeModule,
        moduleResolved: true,
      }),
    ).toMatchObject({ kind: "exam", content: "live" });
  });

  it("never renders an opening-next-section surface", () => {
    const boundary = pending("Module 1", "math", true);
    const stage = derive({ pendingModule: boundary, pendingBreakSeconds: 0 });
    expect(stage).toMatchObject({ kind: "scheduled-break", phase: "active" });
    if (stage.kind === "scheduled-break") {
      expect(stage.phase).not.toBe("opening-next-section");
    }
  });
});

describe("deriveSatStudentStage — a module handoff never leaves the exam", () => {
  it.each(["reading-writing", "math"] as const)(
    "holds the previous frame inside the exam in %s (no opening overlay)",
    (sectionKey) => {
      const stage = derive({
        pendingModule: pending("Module 2", sectionKey),
        hasExamFrame: true,
        frameFresh: true,
      });
      expect(stage).toMatchObject({ kind: "exam", content: "skew-hold" });
      expect(stage.key).toBe(
        derive({ runnerPhase: "module", moduleResolved: true }).key,
      );
    },
  );

  it("does not let a later section's Module 2 become a break", () => {
    expect(
      derive({
        pendingModule: pending("Module 2", "math"),
        hasExamFrame: true,
        frameFresh: true,
      }),
    ).toMatchObject({ kind: "exam", content: "skew-hold" });
  });

  it("never escalates to a recovery screen", () => {
    const held = derive({
      pendingModule: pending("Module 2", "math"),
      hasExamFrame: true,
      frameFresh: true,
    });
    expect(held.kind).not.toBe("entry-recovery");
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
    expect(derive({ runnerPhase: "review", moduleResolved: true })).toMatchObject({
      kind: "exam",
      content: "live",
    });
  });
});

describe("deriveSatStudentStage — the no-frame paths", () => {
  it("waits in the waiting room for the first module and for a frame-less handoff", () => {
    expect(derive({ isInitialEntry: true })).toMatchObject({
      kind: "pre-start",
      reason: "waiting",
    });
    expect(derive()).toMatchObject({ kind: "pre-start", reason: "waiting" });
  });

  it("never returns an entry-recovery stage", () => {
    const stage = derive({ pendingModule: pending("Module 1", "math") });
    expect(stage.kind).not.toBe("entry-recovery");
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
    ];
    for (const stage of stages) {
      expect(stage.key.length).toBeGreaterThan(0);
      expect(stage.kind.length).toBeGreaterThan(0);
    }
    expect(
      deriveSatStudentStage(input({ attemptKey: "other", hasResult: true })).key,
    ).not.toBe(derive({ hasResult: true }).key);
  });

  it("walks Waiting Room → Module 1 → Module 2 → Break → Math without extra surfaces", () => {
    const waitingRoom = derive({ isInitialEntry: true });
    const module1 = derive({ runnerPhase: "module", moduleResolved: true });
    const handoff = derive({
      pendingModule: pending("Module 2", "reading-writing"),
      hasExamFrame: true,
      frameFresh: true,
    });
    const module2 = derive({ runnerPhase: "module", moduleResolved: true });
    const brk = derive({ pendingModule: pending("Module 1", "math", true), pendingBreakSeconds: 600 });
    expect(waitingRoom.kind).toBe("pre-start");
    expect(module1).toMatchObject({ kind: "exam", content: "live" });
    expect(handoff).toMatchObject({ kind: "exam", content: "skew-hold" });
    expect(module2).toMatchObject({ kind: "exam", content: "live" });
    expect(brk.kind).toBe("scheduled-break");
    expect(new Set([module1.key, handoff.key, module2.key]).size).toBe(1);
  });
});
