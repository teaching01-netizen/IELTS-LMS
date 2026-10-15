import { describe, expect, it } from "vitest";
import { satExamConfigDiffers, validateSatExamConfig, type SatConfigLimits, type SatExamConfig } from "../satExamConfig";

const limits: SatConfigLimits = { minModuleMinutes: 1, maxModuleMinutes: 600, maxBreakMinutes: 240, operationalQuestions: { "reading-writing": 27, math: 22 } };
const base = (): SatExamConfig => ({
  sections: {
    "reading-writing": { module1Minutes: 32, module2LowerMinutes: 32, module2HigherMinutes: 32, breakAfterMinutes: 10, minimumCorrectForHigher: 13 },
    math: { module1Minutes: 35, module2LowerMinutes: 35, module2HigherMinutes: 35, breakAfterMinutes: 0, minimumCorrectForHigher: 11 },
  },
  showClassroomScoreReport: false,
});

describe("SAT exam configuration", () => {
  it("accepts the server defaults and the exact bounds", () => {
    expect(validateSatExamConfig(base(), limits)).toEqual({});
    const edge = base();
    edge.sections.math = { module1Minutes: 600, module2LowerMinutes: 1, module2HigherMinutes: 1, breakAfterMinutes: 240, minimumCorrectForHigher: 22 };
    expect(validateSatExamConfig(edge, limits)).toEqual({});
  });

  it("reports every bad field at once, keyed by section and field", () => {
    const bad = base();
    bad.sections.math = { ...bad.sections.math, module1Minutes: 601, breakAfterMinutes: -1, minimumCorrectForHigher: 23 };
    bad.sections["reading-writing"] = { ...bad.sections["reading-writing"], module2LowerMinutes: Number.NaN, module2HigherMinutes: 1.5 };
    const errors = validateSatExamConfig(bad, limits);
    expect(Object.keys(errors).sort()).toEqual([
      "math.breakAfterMinutes",
      "math.minimumCorrectForHigher",
      "math.module1Minutes",
      "reading-writing.module2HigherMinutes",
      "reading-writing.module2LowerMinutes",
    ]);
    expect(errors["reading-writing.module2LowerMinutes"]).toBe("Module 2 (lower) duration is required.");
  });

  it("detects when a configuration differs from the defaults", () => {
    const changed = base();
    expect(satExamConfigDiffers(changed, base())).toBe(false);
    changed.sections.math.breakAfterMinutes = 5;
    expect(satExamConfigDiffers(changed, base())).toBe(true);
    expect(satExamConfigDiffers({ ...base(), showClassroomScoreReport: true }, base())).toBe(true);
  });

  it("sends a narrowed section scope even when timings use defaults", () => {
    expect(satExamConfigDiffers({ ...base(), sectionScope: "reading-writing" }, base())).toBe(true);
    expect(satExamConfigDiffers({ ...base(), sectionScope: "full" }, base())).toBe(false);
  });
});
