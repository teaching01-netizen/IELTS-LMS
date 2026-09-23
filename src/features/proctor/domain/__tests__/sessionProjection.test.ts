import { describe, expect, it } from "vitest";
import type { StudentSession } from "../../../../types";
import { mergeSessionProjection, sessionProjectionSupersedes } from "../mergeProctorRuntime";

/**
 * The staff roster merge used to order two projections of one candidate by
 * `lastActivity` (the presence heartbeat). Heartbeat freshness is not exam-state
 * freshness: two responses stamped with the same heartbeat can describe
 * different adaptive modules, so the older one could regress the roster back to
 * Module 1 after the server had already routed the candidate into Module 2
 * Higher. These tests pin the replacement order — attempt revision, then the
 * active module attempt's revision, then the server's read stamp — and that a
 * heartbeat can no longer decide which module is authoritative.
 */
function session(overrides: Partial<StudentSession> = {}): StudentSession {
  return {
    id: "attempt-1",
    studentId: "cand-1",
    name: "Candidate",
    email: "cand@example.com",
    scheduleId: "schedule-1",
    status: "active",
    currentSection: "reading",
    timeRemaining: 1800,
    runtimeStatus: "live",
    runtimeCurrentSection: "reading-writing",
    runtimeTimeRemainingSeconds: 1800,
    runtimeDeadlineAt: null,
    runtimeServerNow: "2026-01-01T12:00:00.000Z",
    runtimeModuleRole: "base",
    runtimeModuleDeadlineAt: null,
    runtimeModuleRemainingSeconds: 1800,
    runtimeSectionStatus: "live",
    runtimeWaiting: false,
    violations: [],
    warnings: 0,
    lastActivity: "2026-01-01T12:00:00.000Z",
    examId: "exam-1",
    examName: "SAT",
    attemptRevision: 10,
    runtimeCurrentModuleId: "rw-m1",
    runtimeModuleAttemptId: "ma-rw-m1",
    runtimeModuleAttemptRevision: 1,
    ...overrides,
  };
}

const moduleOne = session();
const moduleTwoHigher = session({
  attemptRevision: 12,
  runtimeCurrentModuleId: "rw-m2-higher",
  runtimeModuleAttemptId: "ma-rw-m2-higher",
  runtimeModuleRole: "higher_branch",
  currentSection: "reading",
});

describe("sessionProjectionSupersedes", () => {
  it("keeps Higher when an older projection with the same heartbeat arrives late", () => {
    // Equal heartbeats: the heartbeat cannot decide, the attempt revision does.
    expect(sessionProjectionSupersedes(moduleTwoHigher, moduleOne)).toBe(false);
    expect(sessionProjectionSupersedes(moduleOne, moduleTwoHigher)).toBe(true);
  });

  it("keeps Higher even when the older projection has the newer heartbeat", () => {
    const staleButRecentlySeen = session({
      lastActivity: "2026-01-01T12:05:00.000Z",
      runtimeServerNow: "2026-01-01T12:05:00.000Z",
    });
    expect(sessionProjectionSupersedes(moduleTwoHigher, staleButRecentlySeen)).toBe(false);
  });

  it("orders by the active module attempt's revision inside one attempt revision", () => {
    const earlierModule = session({
      attemptRevision: 12,
      runtimeModuleAttemptRevision: 1,
      runtimeModuleAttemptId: "ma-rw-m2-lower",
      runtimeCurrentModuleId: "rw-m2-lower",
      runtimeModuleRole: "lower_branch",
    });
    const laterModule = session({
      attemptRevision: 12,
      runtimeModuleAttemptRevision: 2,
      runtimeModuleAttemptId: "ma-rw-m2-higher",
      runtimeCurrentModuleId: "rw-m2-higher",
      runtimeModuleRole: "higher_branch",
    });
    expect(sessionProjectionSupersedes(laterModule, earlierModule)).toBe(false);
    expect(sessionProjectionSupersedes(earlierModule, laterModule)).toBe(true);
  });

  it("does not let a projection that lost its revisions overwrite a known one", () => {
    const unknownRevision = session({
      attemptRevision: null,
      runtimeModuleAttemptRevision: null,
    });
    expect(sessionProjectionSupersedes(moduleTwoHigher, unknownRevision)).toBe(false);
  });

  it("falls back to the server read stamp when the identity is identical", () => {
    const older = session({ runtimeServerNow: "2026-01-01T12:00:00.000Z" });
    const newer = session({ runtimeServerNow: "2026-01-01T12:00:30.000Z" });
    expect(sessionProjectionSupersedes(older, newer)).toBe(true);
    expect(sessionProjectionSupersedes(newer, older)).toBe(false);
    // Exact tie: keep what is already held.
    expect(sessionProjectionSupersedes(older, session({ runtimeServerNow: older.runtimeServerNow }))).toBe(false);
  });
});

describe("mergeSessionProjection", () => {
  it("keeps the newer adaptive module while still taking the newest heartbeat", () => {
    const staleProjection = session({
      lastActivity: "2026-01-01T12:09:00.000Z",
      runtimeServerNow: "2026-01-01T12:09:00.000Z",
    });
    const merged = mergeSessionProjection(moduleTwoHigher, staleProjection);
    expect(merged.runtimeModuleRole).toBe("higher_branch");
    expect(merged.runtimeCurrentModuleId).toBe("rw-m2-higher");
    expect(merged.attemptRevision).toBe(12);
    // Presence is independent: the newest heartbeat seen survives the merge.
    expect(merged.lastActivity).toBe("2026-01-01T12:09:00.000Z");
  });

  it("takes the incoming runtime identity when it is the newer projection", () => {
    const merged = mergeSessionProjection(moduleOne, moduleTwoHigher);
    expect(merged.runtimeCurrentModuleId).toBe("rw-m2-higher");
    expect(merged.runtimeModuleRole).toBe("higher_branch");
  });

  it("accepts non-authoritative enrichment from a same-state read", () => {
    const enriched = session({
      runtimeServerNow: "2026-01-01T12:01:00.000Z",
      warnings: 2,
      lastActivity: "2026-01-01T12:01:00.000Z",
    });
    const merged = mergeSessionProjection(moduleOne, enriched);
    expect(merged.warnings).toBe(2);
    expect(merged.runtimeModuleAttemptId).toBe("ma-rw-m1");
  });
});
