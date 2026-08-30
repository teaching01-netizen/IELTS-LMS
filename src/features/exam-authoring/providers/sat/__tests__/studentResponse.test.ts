import { describe, expect, it } from "vitest";
import { sanitizeSatStudentResponseInput, validateSatStudentResponse } from "../studentResponse";

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

  it("sanitizes student typing without allowing illegal structure or overflow", () => {
    expect(sanitizeSatStudentResponseInput("$-12.3%4")).toBe("-12.34");
    expect(sanitizeSatStudentResponseInput("123456789")).toBe("12345");
    expect(sanitizeSatStudentResponseInput("-123456789")).toBe("-12345");
    expect(sanitizeSatStudentResponseInput("1/2.3")).toBe("1/2");
  });
});
