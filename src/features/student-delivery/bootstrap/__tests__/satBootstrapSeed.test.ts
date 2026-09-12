import { describe, expect, it } from "vitest";
import {
  buildSatBootstrapSeed,
  getCachedDeliveryEtag,
  seedMatchesIdentity,
} from "../satBootstrapSeed";

function attempt(revision?: number | null) {
  return {
    id: "attempt-1",
    scheduleId: "sched-1",
    studentKey: "student-sched-1-W1",
    examId: "exam-1",
    revision: revision ?? null,
    examTitle: "SAT",
    candidateId: "cand-1",
    candidateName: "Cand",
    candidateEmail: "c@example.com",
    phase: "exam",
    currentModule: "reading",
    currentQuestionId: null,
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    proctorStatus: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as any;
}

function runtime(revision?: number | null) {
  return {
    id: "runtime-1",
    scheduleId: "sched-1",
    examId: "exam-1",
    revision: revision ?? null,
  } as any;
}

describe("seedMatchesIdentity", () => {
  const seed = buildSatBootstrapSeed({
    scheduleId: "sched-1",
    attemptId: "attempt-1",
    candidateId: "cand-1",
    attemptSnapshot: attempt(3),
    runtimeSnapshot: runtime(7),
    liveSnapshotReceivedAt: 123,
    staticVersionId: "ver-1",
    deliveryEtag: '"e1"',
    seedGeneration: 2,
  });

  it("matches the exact identity", () => {
    expect(
      seedMatchesIdentity(seed, {
        scheduleId: "sched-1",
        attemptId: "attempt-1",
        candidateId: "cand-1",
      }),
    ).toBe(true);
  });

  it("rejects schedule rotation", () => {
    expect(
      seedMatchesIdentity(seed, {
        scheduleId: "sched-2",
        attemptId: "attempt-1",
        candidateId: "cand-1",
      }),
    ).toBe(false);
  });

  it("rejects attempt rotation", () => {
    expect(
      seedMatchesIdentity(seed, {
        scheduleId: "sched-1",
        attemptId: "attempt-2",
        candidateId: "cand-1",
      }),
    ).toBe(false);
  });

  it("rejects candidate rotation", () => {
    expect(
      seedMatchesIdentity(seed, {
        scheduleId: "sched-1",
        attemptId: "attempt-1",
        candidateId: "cand-2",
      }),
    ).toBe(false);
  });

  it("rejects null/undefined seeds", () => {
    expect(
      seedMatchesIdentity(null, {
        scheduleId: "sched-1",
        attemptId: "attempt-1",
        candidateId: "cand-1",
      }),
    ).toBe(false);
    expect(
      seedMatchesIdentity(undefined, {
        scheduleId: "sched-1",
        attemptId: "attempt-1",
        candidateId: "cand-1",
      }),
    ).toBe(false);
  });
});

describe("buildSatBootstrapSeed", () => {
  it("extracts attempt/runtime revisions null-safely", () => {
    const full = buildSatBootstrapSeed({
      scheduleId: "sched-1",
      attemptId: "attempt-1",
      candidateId: "cand-1",
      attemptSnapshot: attempt(3),
      runtimeSnapshot: runtime(7),
      liveSnapshotReceivedAt: 456,
      staticVersionId: "ver-9",
      deliveryEtag: '"e9"',
      seedGeneration: 4,
    });
    expect(full.attemptRevision).toBe(3);
    expect(full.runtimeRevision).toBe(7);
    expect(full.liveSnapshotReceivedAt).toBe(456);
    expect(full.staticVersionId).toBe("ver-9");
    expect(full.deliveryEtag).toBe('"e9"');
    expect(full.seedGeneration).toBe(4);
    expect(full.attemptSnapshot?.id).toBe("attempt-1");

    const empty = buildSatBootstrapSeed({
      scheduleId: "sched-1",
      attemptId: "attempt-1",
      candidateId: "cand-1",
      attemptSnapshot: null,
      runtimeSnapshot: null,
      liveSnapshotReceivedAt: null,
      staticVersionId: null,
      deliveryEtag: null,
      seedGeneration: 1,
    });
    expect(empty.attemptRevision).toBeNull();
    expect(empty.runtimeRevision).toBeNull();
    expect(empty.liveSnapshotReceivedAt).toBeNull();
    expect(empty.staticVersionId).toBeNull();
    expect(empty.deliveryEtag).toBeNull();
  });
});

describe("getCachedDeliveryEtag", () => {
  it("returns null when storage is empty and round-trips a stored etag", () => {
    window.sessionStorage.clear();
    expect(getCachedDeliveryEtag("sched-1", "attempt-1")).toBeNull();
    window.sessionStorage.setItem(
      "sat-bootstrap-etag:sched-1:attempt-1",
      JSON.stringify({ etag: '"abc"', payload: {} }),
    );
    expect(getCachedDeliveryEtag("sched-1", "attempt-1")).toBe('"abc"');
  });

  it("returns null on corrupt storage (fail-open to full fetch)", () => {
    window.sessionStorage.setItem("sat-bootstrap-etag:sched-1:attempt-1", "not-json{");
    expect(getCachedDeliveryEtag("sched-1", "attempt-1")).toBeNull();
    window.sessionStorage.setItem(
      "sat-bootstrap-etag:sched-1:attempt-1",
      JSON.stringify({ payload: {} }),
    );
    expect(getCachedDeliveryEtag("sched-1", "attempt-1")).toBeNull();
    window.sessionStorage.clear();
  });
});
