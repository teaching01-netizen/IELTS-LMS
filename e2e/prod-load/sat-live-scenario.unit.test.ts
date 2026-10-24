import { describe, expect, it } from "vitest";
import { SatCohortBarrier } from "./sat-cohort-barrier";
import {
  EMPTY_CONTROL_EPOCH_COUNTERS,
  controlEpochRecoveredPerModuleStart,
  sumControlEpochCounters,
  summarizeDeadlineToAnswerableFrames,
  summarizeSynchronizedDeadlineToAnswerableFrames,
  type SatControlEpochCounters,
} from "./sat-live-scenario";

function counters(overrides: Partial<SatControlEpochCounters> = {}): SatControlEpochCounters {
  return { ...EMPTY_CONTROL_EPOCH_COUNTERS, ...overrides };
}

describe("sumControlEpochCounters", () => {
  it("sums every counter across the run", () => {
    const totals = sumControlEpochCounters([
      { controlEpoch: counters({ moduleStarts: 2, adopted: 2 }) },
      { controlEpoch: counters({ moduleStarts: 1, adopted: 1, skipped: 1, recovered: 3 }) },
    ]);

    expect(totals).toEqual({
      moduleStarts: 3,
      adopted: 3,
      skipped: 1,
      recovered: 3,
      blocked: 0,
      recoveryFailed: 0,
    });
  });

  it("treats a student with no captured counters as an absent sample", () => {
    // A student that never reached the exam shell must not be read as an entry
    // that failed to adopt, so it contributes nothing to any counter.
    const totals = sumControlEpochCounters([
      { controlEpoch: counters({ moduleStarts: 1, adopted: 1 }) },
      {},
      { controlEpoch: undefined },
    ]);

    expect(totals.moduleStarts).toBe(1);
    expect(totals.adopted).toBe(1);
    expect(totals.skipped).toBe(0);
  });

  it("returns all zeros for a run with no students", () => {
    expect(sumControlEpochCounters([])).toEqual(EMPTY_CONTROL_EPOCH_COUNTERS);
  });

  it("never mutates the shared empty template", () => {
    sumControlEpochCounters([{ controlEpoch: counters({ moduleStarts: 5, recovered: 1 }) }]);

    expect(EMPTY_CONTROL_EPOCH_COUNTERS).toEqual({
      moduleStarts: 0,
      adopted: 0,
      skipped: 0,
      recovered: 0,
      blocked: 0,
      recoveryFailed: 0,
    });
  });
});

describe("controlEpochRecoveredPerModuleStart", () => {
  it("reports null when the run never entered a module", () => {
    // Not 0: an unmeasured funnel must not read as a perfect score.
    expect(controlEpochRecoveredPerModuleStart(counters())).toBeNull();
  });

  it("reports a real zero when entries happened and no heal was needed", () => {
    expect(controlEpochRecoveredPerModuleStart(counters({ moduleStarts: 40 }))).toBe(0);
  });

  it("reports heal round trips per module entry, rounded to four places", () => {
    expect(controlEpochRecoveredPerModuleStart(counters({ moduleStarts: 3, recovered: 1 }))).toBe(
      0.3333
    );
    expect(controlEpochRecoveredPerModuleStart(counters({ moduleStarts: 3, recovered: 2 }))).toBe(
      0.6667
    );
    expect(controlEpochRecoveredPerModuleStart(counters({ moduleStarts: 40, recovered: 76 }))).toBe(
      1.9
    );
  });
});

describe("summarizeDeadlineToAnswerableFrames", () => {
  it("applies the p95 and p99 hard gates to actual transition frames", () => {
    const results = [
      ...Array.from({ length: 95 }, () => ({ answerableFrames: [{ moduleId: "m2", latencyMs: 20, deadlineToAnswerableMs: 3000 }] })),
      ...Array.from({ length: 4 }, () => ({ answerableFrames: [{ moduleId: "m2", latencyMs: 20, deadlineToAnswerableMs: 4500 }] })),
      { answerableFrames: [{ moduleId: "m2", latencyMs: 20, deadlineToAnswerableMs: 5000 }] },
    ];

    expect(summarizeDeadlineToAnswerableFrames(results)).toEqual({
      count: 100,
      p95Ms: 3000,
      p99Ms: 4500,
      maxMs: 5000,
      gatePassed: true,
    });
  });

  it("keeps an unmeasured transition distinct from a passing zero", () => {
    expect(summarizeDeadlineToAnswerableFrames([{ answerableFrames: [{ moduleId: "m1", latencyMs: 10 }] }])).toEqual({
      count: 0,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
      gatePassed: false,
    });
  });

  it("fails p95 when more than five percent of transitions exceed three seconds", () => {
    const results = [
      ...Array.from({ length: 94 }, () => ({ answerableFrames: [{ moduleId: "m2", latencyMs: 10, deadlineToAnswerableMs: 3000 }] })),
      ...Array.from({ length: 6 }, () => ({ answerableFrames: [{ moduleId: "m2", latencyMs: 10, deadlineToAnswerableMs: 5000 }] })),
    ];
    expect(summarizeDeadlineToAnswerableFrames(results).gatePassed).toBe(false);
  });
});

describe("SatCohortBarrier", () => {
  it("releases only after each distinct requested student reaches the exam", async () => {
    const barrier = new SatCohortBarrier(2, 1_000);
    let firstReleased = false;
    const first = barrier.arrive(0).then((result) => {
      firstReleased = true;
      return result;
    });
    const duplicate = barrier.arrive(0);

    expect(barrier.arrivals).toBe(1);
    expect(firstReleased).toBe(false);

    const second = await barrier.arrive(1);
    expect(second).toEqual({ ready: true, arrivals: 2, expected: 2 });
    expect(await first).toEqual(second);
    expect(await duplicate).toEqual(second);
    expect(barrier.passed).toBe(true);
    barrier.dispose();
  });

  it("releases waiting browsers with failure when one student cannot join", async () => {
    const barrier = new SatCohortBarrier(3, 1_000);
    const first = barrier.arrive(0);
    barrier.fail("candidate-2 failed to join");

    expect(await first).toEqual({
      ready: false,
      arrivals: 1,
      expected: 3,
      reason: "candidate-2 failed to join",
    });
    expect((await barrier.arrive(1)).ready).toBe(false);
  });

  it("releases the cohort when the configured recovery limit expires", async () => {
    const barrier = new SatCohortBarrier(2, 5);
    const waiting = barrier.arrive(0);

    await expect(waiting).resolves.toMatchObject({
      ready: false,
      arrivals: 1,
      expected: 2,
      reason: "Timed out with 1/2 students exam-ready.",
    });
  });
});

describe("summarizeSynchronizedDeadlineToAnswerableFrames", () => {
  it("passes only when each student's measured frame overlaps the full exam cohort", () => {
    const results = [
      {
        examEnteredAtMs: 1_000,
        examExitedAtMs: 4_000,
        answerableFrames: [{ moduleId: "m2", latencyMs: 25, observedAtMs: 2_000, deadlineToAnswerableMs: 1_200 }],
      },
      {
        examEnteredAtMs: 1_500,
        examExitedAtMs: 3_500,
        answerableFrames: [{ moduleId: "m2", latencyMs: 30, observedAtMs: 2_500, deadlineToAnswerableMs: 2_800 }],
      },
    ];

    expect(summarizeSynchronizedDeadlineToAnswerableFrames(results, 2)).toEqual({
      count: 2,
      studentsCovered: 2,
      expectedStudents: 2,
      minActiveStudentsAtFrame: 2,
      p95Ms: 2_800,
      p99Ms: 2_800,
      maxMs: 2_800,
      gatePassed: true,
    });
  });

  it("rejects sequential transitions and missing exam-interval evidence", () => {
    const sequential = [
      {
        examEnteredAtMs: 1_000,
        examExitedAtMs: 1_900,
        answerableFrames: [{ moduleId: "m2", latencyMs: 10, observedAtMs: 1_500, deadlineToAnswerableMs: 100 }],
      },
      {
        examEnteredAtMs: 2_000,
        examExitedAtMs: 3_000,
        answerableFrames: [{ moduleId: "m2", latencyMs: 10, observedAtMs: 2_500, deadlineToAnswerableMs: 200 }],
      },
    ];
    expect(summarizeSynchronizedDeadlineToAnswerableFrames(sequential, 2)).toMatchObject({
      studentsCovered: 0,
      expectedStudents: 2,
      gatePassed: false,
    });

    expect(summarizeSynchronizedDeadlineToAnswerableFrames([
      { answerableFrames: [{ moduleId: "m2", latencyMs: 10, observedAtMs: 2_000, deadlineToAnswerableMs: 100 }] },
      { examEnteredAtMs: 1_000, examExitedAtMs: 3_000, answerableFrames: [] },
    ], 2).gatePassed).toBe(false);
  });

  it("fails the hard latency gates for a synchronized cohort that transitions too slowly", () => {
    const results = [
      {
        examEnteredAtMs: 1_000,
        examExitedAtMs: 4_000,
        answerableFrames: [{ moduleId: "m2", latencyMs: 25, observedAtMs: 2_000, deadlineToAnswerableMs: 1_200 }],
      },
      {
        examEnteredAtMs: 1_500,
        examExitedAtMs: 3_500,
        answerableFrames: [{ moduleId: "m2", latencyMs: 30, observedAtMs: 2_500, deadlineToAnswerableMs: 5_100 }],
      },
    ];

    expect(summarizeSynchronizedDeadlineToAnswerableFrames(results, 2)).toMatchObject({
      studentsCovered: 2,
      minActiveStudentsAtFrame: 2,
      p95Ms: 5_100,
      p99Ms: 5_100,
      gatePassed: false,
    });
  });
});
