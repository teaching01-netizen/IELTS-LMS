import { describe, expect, it } from "vitest";
import { parseDelimitedRows, parseQuestionImport } from "../questionImportParser";
import { plainTextFromContent } from "../../editor/richContent";

describe("SAT question import parser", () => {
  it("parses a tab-separated MCQ copied from a spreadsheet", () => {
    const input = [
      "Prompt\tA\tB\tC\tD\tCorrect\tDomain\tSkill\tDifficulty",
      "Which transition fits?\tHowever\tTherefore\tSimilarly\tAdditionally\tA\texpression-of-ideas\tTransitions\tHard",
    ].join("\n");
    const result = parseQuestionImport(input, "reading-writing");
    expect(result.issues).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.answer).toMatchObject({ kind: "single_choice", correctOptionId: "A" });
    expect(result.drafts[0]?.metadata).toMatchObject({
      domain: "expression-of-ideas",
      skill: "Transitions",
      difficulty: "hard",
    });
    expect(plainTextFromContent(result.drafts[0]!.prompt)).toBe("Which transition fits?");
  });

  it("honors RFC-style quotes, escaped quotes, commas, and embedded newlines", () => {
    const rows = parseDelimitedRows(
      'Prompt,A,B,C,D,Correct\n"Line one, with comma\nLine two","A ""quoted"" choice",B,C,D,A'
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[0]).toBe("Line one, with comma\nLine two");
    expect(rows[1]?.[1]).toBe('A "quoted" choice');
  });

  it("rejects invalid SAT taxonomy instead of silently importing it", () => {
    const input =
      "Prompt,A,B,C,D,Correct,Domain,Skill\nQuestion,A,B,C,D,A,not-a-domain,Imaginary Skill";
    const result = parseQuestionImport(input, "reading-writing");
    expect(result.drafts).toHaveLength(0);
    expect(result.issues.some((issue) => issue.field === "domain")).toBe(true);
  });

  it("supports Math student-produced responses with equivalent answers", () => {
    const input =
      "Prompt,Response Type,Accepted Responses,Domain,Skill,Difficulty\nSolve x,SPR,12;12.0,algebra,Linear Equations in One Variable,Easy";
    const result = parseQuestionImport(input, "math");
    expect(result.issues).toEqual([]);
    expect(result.drafts[0]?.answer).toMatchObject({
      kind: "student_produced_response",
      acceptedResponses: ["12", "12.0"],
    });
  });

  it("rejects Math SPR rows with non-SAT answer syntax", () => {
    const input =
      "Prompt,Response Type,Accepted Responses,Domain,Skill\nSolve x,SPR,12%,algebra,Linear Equations in One Variable";
    const result = parseQuestionImport(input, "math");
    expect(result.drafts).toHaveLength(0);
    expect(
      result.issues.some(
        (issue) => issue.field === "accepted responses" && issue.message.includes("digits")
      )
    ).toBe(true);
  });

  it("rejects SPR rows in Reading & Writing", () => {
    const input = "Prompt,Response Type,Accepted Responses\nQuestion,SPR,12";
    const result = parseQuestionImport(input, "reading-writing");
    expect(result.drafts).toHaveLength(0);
    expect(result.issues.some((issue) => issue.message.includes("only supported in Math"))).toBe(
      true
    );
  });

  it("rejects malformed quoted input deterministically", () => {
    const result = parseQuestionImport(
      'Prompt,A,B,C,D,Correct\n"unterminated,A,B,C,D,A',
      "reading-writing"
    );
    expect(result.drafts).toHaveLength(0);
    expect(result.issues[0]?.message).toContain("unterminated quoted field");
  });
});
