import { describe, expect, it } from "vitest";
import {
  EMPTY_CONTROL_EPOCH_COUNTERS,
  controlEpochRecoveredPerModuleStart,
  sumControlEpochCounters,
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
