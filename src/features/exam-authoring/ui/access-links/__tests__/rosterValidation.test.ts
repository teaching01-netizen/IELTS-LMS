import { describe, expect, it } from "vitest";
import { describeRosterResult, rosterTemplate, validateRosterSource } from "../rosterValidation";

describe("validateRosterSource", () => {
  it("accepts valid rows with progressive per-row errors", () => {
    const result = validateRosterSource([
      "W1, Jane Doe, jane@example.com",
      "W2, John",
      "W1, Duplicate",
      ", Missing code",
      "W3, Bad, not-an-email",
      "a,b,c,d",
    ].join("\n"));
    expect(result.rows).toHaveLength(2);
    expect(result.totalRows).toBe(6);
    expect(result.errors.map((issue) => issue.row)).toEqual([3, 4, 5, 6]);
    expect(result.errors[0]?.message).toMatch(/Row 3/);
  });

  it("skips blank lines but keeps original row numbers", () => {
    const result = validateRosterSource("W1\n\nW1");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.row).toBe(3);
  });

  it("handles quoted commas and reports unclosed quotes", () => {
    const quoted = validateRosterSource('"W1", "Doe, Jane", jane@example.com');
    expect(quoted.errors).toHaveLength(0);
    expect(quoted.rows[0]?.studentName).toBe("Doe, Jane");
    const broken = validateRosterSource('"W1, Jane');
    expect(broken.errors).toHaveLength(1);
    expect(broken.errors[0]?.row).toBe(1);
  });

  it("rejects duplicate codes case-insensitively with first occurrence winning", () => {
    const result = validateRosterSource("ABC\nabc");
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/more than once/);
  });
});

describe("rosterTemplate / describeRosterResult", () => {
  it("summarizes ready and attention counts", () => {
    expect(describeRosterResult(validateRosterSource(""))).toBe("");
    expect(describeRosterResult(validateRosterSource(rosterTemplate()))).toBe("2 students ready");
    expect(describeRosterResult(validateRosterSource("W1\nW1"))).toMatch(/needs attention/);
  });
});
