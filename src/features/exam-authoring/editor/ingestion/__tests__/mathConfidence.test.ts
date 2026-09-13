import { describe, expect, it } from "vitest";
import { MATH_CONFIDENCE_THRESHOLD, SUPPORTED_MACROS, judgeRawLatex, validateLatex } from "../mathConfidence";

describe("SUPPORTED_MACROS", () => {
  it("covers the plan allowlist", () => {
    for (const macro of ["frac", "sqrt", "sum", "int", "pi", "le", "left", "binom"]) {
      expect(SUPPORTED_MACROS.has(macro)).toBe(true);
    }
    expect(MATH_CONFIDENCE_THRESHOLD).toBe(0.75);
  });
});

describe("judgeRawLatex", () => {
  it("accepts allowlisted raw latex above threshold", () => {
    const verdict = judgeRawLatex("\\frac{2x}{3} + \\sqrt{x}");
    expect(verdict).not.toBeNull();
    expect(verdict?.score).toBeGreaterThanOrEqual(0.75);
  });
  it("rejects unknown macros silently (null, no throw)", () => {
    expect(judgeRawLatex("\\qwerty{abc} + \\frac{1}{2}")).toBeNull();
  });
  it("forces currency below threshold", () => {
    expect(judgeRawLatex("$5 and \\frac{1}{2}")).toBeNull();
    expect(judgeRawLatex("US$10 \\sqrt{x}")).toBeNull();
  });
  it("rejects backslash file paths and code", () => {
    expect(judgeRawLatex("C:\\path\\to\\frac")).toBeNull();
  });
  it("penalizes plain English", () => {
    expect(judgeRawLatex("the question and \\frac{1}{2}")).toBeNull();
  });
});

describe("validateLatex", () => {
  it.each(["\\frac{x+1}{2}=8", "x^{2}", "\\sum_{i=1}^{n} i", "\\pi"])("accepts %s", (latex) => {
    expect(validateLatex(latex)).toEqual({ ok: true });
  });
  it.each(["\\frac{1", "\\qwerty{1}", "{"])("rejects %s with capped error", (latex) => {
    const result = validateLatex(latex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeLessThanOrEqual(120);
  });
});
