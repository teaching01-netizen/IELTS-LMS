import { describe, expect, it } from "vitest";
import {
  SAT_SPR_MAX_ANSWER_KEY_CHARACTERS,
  SAT_SPR_MAX_INPUT_CHARACTERS,
  SAT_SPR_MAX_NEGATIVE_CHARACTERS,
  SAT_SPR_MAX_POSITIVE_CHARACTERS,
  capSatStudentResponseInput,
  normalizeSatStudentResponseInput,
  validateSatAnswerKey,
  validateSatStudentResponse,
} from "../studentResponse";

describe("SAT student-produced response contract", () => {
  it.each(["12", ".5", "3/4", "-2.5", "-2/3", "-12345"])("accepts %s", (value) => {
    expect(validateSatStudentResponse(value).valid).toBe(true);
  });

  it.each([
    ["12%", "characters"],
    ["$5", "characters"],
    ["123456", "length"],
    ["-123456", "length"],
    ["1/0", "denominator_zero"],
    ["1.2/3", "format"],
    ["1 1/2", "characters"],
    ["5.", "format"],
    // Unicode minus is normalized at input, but validation judges the value
    // actually stored: it must reject text the server would reject.
    ["\u22125", "characters"],
  ])("rejects %s with %s", (value, code) => {
    const result = validateSatStudentResponse(value);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe(code);
  });

  it("pins the character budgets", () => {
    expect(SAT_SPR_MAX_POSITIVE_CHARACTERS).toBe(5);
    expect(SAT_SPR_MAX_NEGATIVE_CHARACTERS).toBe(6);
    expect(SAT_SPR_MAX_INPUT_CHARACTERS).toBe(64);
    expect(SAT_SPR_MAX_ANSWER_KEY_CHARACTERS).toBe(256);
  });
});

describe("SAT answer keys must be enterable by a student", () => {
  // Mirrors backend/go/internal/authoring/readiness_test.go and
  // assessscore.ValidateSATSPRKey: a canonical key may exceed five
  // characters only when a 5/6-character exact or SAT decimal form exists.
  it.each([
    "2/3",
    "-1.5",
    "100/333",
    "0.33333",
    "3.14159265",
    "-3.14159265",
    ".5",
    "12345",
    "-12345",
    "0.123456",
    "-100/333",
    "0.0001",
    "-0.0001",
    "2/4",
  ])("accepts key %s", (value) => {
    expect(validateSatAnswerKey(value)).toMatchObject({ valid: true, value });
  });

  it.each([
    "123456",
    "-123456",
    "100000",
    "1/123456",
    "1/99999",
    "0.00001",
    "-0.00001",
    "123456789",
  ])("rejects key %s with no student entry form", (value) => {
    expect(validateSatAnswerKey(value)).toMatchObject({ valid: false, code: "entry" });
  });

  it("separates key syntax failures from missing entry forms", () => {
    expect(validateSatAnswerKey("1 1/2")).toMatchObject({ valid: false, code: "characters" });
    expect(validateSatAnswerKey("1/0")).toMatchObject({ valid: false, code: "denominator_zero" });
    expect(validateSatAnswerKey("123456789")).toMatchObject({ valid: false, code: "entry" });
  });
});

describe("SAT response input normalization", () => {
  it("normalizes minus-like glyphs, full-width digits, and invisible spaces", () => {
    expect(normalizeSatStudentResponseInput("\u221212.5")).toBe("-12.5");
    expect(normalizeSatStudentResponseInput("\u201312.5")).toBe("-12.5");
    expect(normalizeSatStudentResponseInput("\uFF11\uFF12\uFF0E\uFF15")).toBe("12.5");
    expect(normalizeSatStudentResponseInput("1\u00A02")).toBe("1 2");
    expect(normalizeSatStudentResponseInput("\uFF0D\uFF13\uFF0F\uFF14")).toBe("-3/4");
  });

  it("bounds an unbounded paste without changing a legal-looking entry", () => {
    // Over-budget text is left intact for the validator to reject; truncating
    // -123456 to -12345 would silently change the answer into a correct one.
    expect(capSatStudentResponseInput("-123456")).toBe("-123456");
    expect(capSatStudentResponseInput("123456789")).toBe("123456789");
    expect(capSatStudentResponseInput("1".repeat(100))).toBe("1".repeat(64));
    expect(capSatStudentResponseInput("3/4")).toBe("3/4");
  });

  it("makes a normalized value valid without letting the raw glyph through", () => {
    const pasted = "\u22125";
    expect(validateSatStudentResponse(pasted).valid).toBe(false);
    expect(validateSatStudentResponse(normalizeSatStudentResponseInput(pasted)).valid).toBe(true);
  });
});
