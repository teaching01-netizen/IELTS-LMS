import { describe, expect, it } from "vitest";
import {
  SAT_EXAM_FIT_CANDIDATES,
  SAT_EXAM_FIT_CEILING,
  SAT_EXAM_FIT_TOLERANCE_PX,
  resolveSatExamZoom,
  satExamFitNextZoom,
  satExamFitShouldRun,
  satExamFitVerdict,
  type SatExamFitGateInput,
  type SatExamFitPane,
} from "./satExamFit";
import { SAT_EXAM_ZOOM_MIN, SAT_EXAM_ZOOM_STEP, clampSatExamZoom } from "./satReadingPreferences";

const pane = (scrollHeight: number, clientHeight: number): SatExamFitPane => ({
  scrollHeight,
  clientHeight,
});

function gate(overrides: Partial<SatExamFitGateInput> = {}): SatExamFitGateInput {
  return {
    enabled: true,
    zoomDecided: false,
    storedZoom: null,
    compact: false,
    blocked: false,
    attempted: false,
    ...overrides,
  };
}

describe("satExamFit candidates", () => {
  it("offers the zoom grid at or below the resting point, largest first", () => {
    expect(SAT_EXAM_FIT_CANDIDATES).toEqual([SAT_EXAM_FIT_CEILING, 0.75, SAT_EXAM_ZOOM_MIN]);
  });

  it("offers only values the Display control can represent", () => {
    for (const candidate of SAT_EXAM_FIT_CANDIDATES) {
      expect(clampSatExamZoom(candidate)).toBe(candidate);
      const steps = (candidate - SAT_EXAM_ZOOM_MIN) / SAT_EXAM_ZOOM_STEP;
      expect(Number.isInteger(Math.round(steps * 1000) / 1000)).toBe(true);
    }
  });
});

describe("satExamFitVerdict", () => {
  it("reads a pane that has room as fitting", () => {
    expect(satExamFitVerdict([pane(600, 900), pane(700, 900)])).toBe("fits");
  });

  it("reads a pane that has to scroll as overflowing", () => {
    expect(satExamFitVerdict([pane(700, 900), pane(1100, 900)])).toBe("overflows");
  });

  it("ignores the tolerance-sized overshoot a student cannot see", () => {
    expect(satExamFitVerdict([pane(900 + SAT_EXAM_FIT_TOLERANCE_PX, 900)])).toBe("fits");
    expect(satExamFitVerdict([pane(900 + SAT_EXAM_FIT_TOLERANCE_PX + 1, 900)])).toBe("overflows");
  });

  it("calls a rendering it cannot read unmeasurable, never an overflow", () => {
    expect(satExamFitVerdict([])).toBe("unmeasurable");
    expect(satExamFitVerdict([pane(5000, 0)])).toBe("unmeasurable");
    expect(satExamFitVerdict([pane(Number.NaN, 900)])).toBe("unmeasurable");
  });

  it("lets one unreadable pane be outvoted by a readable one", () => {
    expect(satExamFitVerdict([pane(5000, 0), pane(700, 900)])).toBe("fits");
    expect(satExamFitVerdict([pane(5000, 0), pane(1100, 900)])).toBe("overflows");
  });
});

describe("satExamFitNextZoom", () => {
  it("walks the candidates downwards one step at a time", () => {
    expect(satExamFitNextZoom(1)).toBe(0.75);
    expect(satExamFitNextZoom(0.75)).toBe(0.5);
  });

  it("stops at the floor", () => {
    expect(satExamFitNextZoom(SAT_EXAM_ZOOM_MIN)).toBeNull();
  });

  it("starts at the top of the list from a zoom that is not on it", () => {
    expect(satExamFitNextZoom(1.25)).toBe(1);
    expect(satExamFitNextZoom(2)).toBe(1);
  });
});

describe("resolveSatExamZoom", () => {
  it("renders the candidate being measured while a walk is in flight", () => {
    expect(resolveSatExamZoom({ probing: 0.75, stored: 1.5 })).toBe(0.75);
  });

  it("renders the attempt's own zoom at every other moment", () => {
    expect(resolveSatExamZoom({ probing: null, stored: 0.5 })).toBe(0.5);
    // Including an explicit 100%: a zoom the student chose is a zoom, not an absence.
    expect(resolveSatExamZoom({ probing: null, stored: 1 })).toBe(1);
  });

  it("rests at 100% when the attempt has no zoom at all", () => {
    expect(resolveSatExamZoom({ probing: null, stored: null })).toBe(SAT_EXAM_FIT_CEILING);
  });
});

describe("satExamFitShouldRun", () => {
  it("runs only when enabled, undecided, unchosen, roomy, interactive, and unrun", () => {
    expect(satExamFitShouldRun(gate())).toBe(true);
  });

  it("declines every way the fit would be wrong", () => {
    const stops: Partial<SatExamFitGateInput>[] = [
      { enabled: false },
      { zoomDecided: true },
      { storedZoom: 0.75 },
      { compact: true },
      { blocked: true },
      { attempted: true },
    ];
    for (const stop of stops) {
      expect(satExamFitShouldRun(gate(stop)), JSON.stringify(stop)).toBe(false);
    }
  });

  it("reads an explicit 100% as a choice, not as an empty attempt", () => {
    expect(satExamFitShouldRun(gate({ storedZoom: 1 }))).toBe(false);
  });

  it("stops an attempt that already decided even though it stored nothing", () => {
    // The scenario that made this input necessary: a first module that fit at
    // 100% writes no zoom, and the next module is a fresh mount of the same
    // attempt. Without the attempt-scoped flag, it would decide again.
    expect(satExamFitShouldRun(gate({ zoomDecided: true }))).toBe(false);
  });
});
