import { describe, expect, it } from "vitest";
import { validateSatAnswerKey, validateSatStudentResponse } from "../studentResponse";

describe("SAT student-produced response contract", () => {
  it.each(["12", ".5", "3/4", "-2.5", "-2/3"])("accepts %s", (value) => {
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
  ])("rejects %s with %s", (value, code) => {
    const result = validateSatStudentResponse(value);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe(code);
  });

  it("allows longer canonical answer keys while retaining student entry limits", () => {
    expect(validateSatAnswerKey("100/333").valid).toBe(true);
    expect(validateSatAnswerKey("3.14159265").valid).toBe(true);
    expect(validateSatStudentResponse("100/333").valid).toBe(false);
    expect(validateSatAnswerKey("1 1/2").valid).toBe(false);
  });
});
