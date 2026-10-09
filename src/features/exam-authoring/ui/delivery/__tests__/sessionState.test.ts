import { describe, expect, it } from "vitest";
import { entryLabel, sessionActionPlan, sessionPhaseFromRuntime, sessionStatusLine, type SessionPhase } from "../sessionState";

describe("sessionPhaseFromRuntime", () => {
  it.each([
    ["live", undefined, "live"],
    ["paused", undefined, "paused"],
    ["not_started", undefined, "ready"],
    ["completed", undefined, "finished"],
    // A cancelled or completed schedule wins even when the runtime row lags behind.
    ["not_started", "cancelled", "cancelled"],
    ["cancelled", undefined, "cancelled"],
    [undefined, "completed", "finished"],
    ["something-new", undefined, "unknown"],
    [null, null, "unknown"],
  ] as const)("maps runtime %s / schedule %s to %s", (runtime, schedule, expected) => {
    expect(sessionPhaseFromRuntime(runtime, schedule)).toBe(expected);
  });
});

describe("sessionActionPlan", () => {
  const run = { canRun: true, stale: false };

  it("never offers more than one primary action and puts the next sensible step first", () => {
    const primaries: Record<Exclude<SessionPhase, "unknown">, string> = {
      ready: "open-room",
      live: "open-live",
      paused: "open-room",
      finished: "view-results",
      cancelled: "open-room",
    };
    for (const [phase, kind] of Object.entries(primaries)) {
      expect(sessionActionPlan(phase as SessionPhase, run).primary?.kind).toBe(kind);
    }
  });

  it("gives staff who cannot run rooms no room actions in any phase", () => {
    for (const phase of ["ready", "live", "paused", "finished", "cancelled", "unknown"] as const) {
      expect(sessionActionPlan(phase, { canRun: false, stale: false })).toEqual({ primary: null, supporting: [] });
    }
  });

  it("keeps start and resume in the room: lists only navigate there", () => {
    for (const phase of ["ready", "live", "paused", "finished", "cancelled"] as const) {
      const plan = sessionActionPlan(phase, run);
      const kinds = [plan.primary, ...plan.supporting].map((action) => action?.kind);
      expect(kinds).not.toContain("start");
      expect(kinds).not.toContain("resume");
    }
    expect(sessionActionPlan("cancelled", run).primary?.label).toBe("Review room");
  });

  it("replaces every action with a refresh when state is stale or unknown, never a guess", () => {
    expect(sessionActionPlan("ready", { canRun: true, stale: true }).primary?.kind).toBe("refresh");
    expect(sessionActionPlan("live", { canRun: true, stale: true }).supporting).toEqual([]);
    expect(sessionActionPlan("unknown", run).primary?.kind).toBe("refresh");
  });

  it("keeps Duplicate setup off active rooms", () => {
    for (const phase of ["ready", "live", "paused"] as const) {
      expect(sessionActionPlan(phase, run).supporting.map((action) => action.kind)).not.toContain("duplicate");
    }
    expect(sessionActionPlan("finished", run).supporting.map((action) => action.kind)).toContain("duplicate");
  });
});

describe("entryLabel", () => {
  it("describes check-in, not the exam, so pausing check-in cannot read as pausing a room", () => {
    expect(entryLabel("paused")).toBe("Check-in paused");
    expect(entryLabel("live")).toBe("Check-in open");
    expect(entryLabel("upcoming")).toBe("Check-in opens later");
  });
});

describe("sessionStatusLine", () => {
  it("states check-in and exam run state side by side, never one for the other", () => {
    expect(sessionStatusLine("live", "ready")).toBe("Check-in open · Exam not started");
    expect(sessionStatusLine("paused", "live")).toBe("Check-in paused · Exam running");
    expect(sessionStatusLine("ended", "finished")).toBe("Check-in closed · Exam finished");
  });

  it("names only the exam state when check-in is unknown to the viewer", () => {
    expect(sessionStatusLine(null, "ready")).toBe("Exam not started");
    expect(sessionStatusLine(null, "unknown")).toBe("Exam status unavailable");
  });
});
