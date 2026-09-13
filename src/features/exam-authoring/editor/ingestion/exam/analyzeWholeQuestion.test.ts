import { describe, expect, it } from "vitest";
import { parseTextHtml } from "../adapters/textHtml";
import { analyzeWholeQuestion, bandForConfidence } from "./analyzeWholeQuestion";
import type { AnalyzeWholeQuestionInput } from "./wholeQuestionTypes";

function input(text: string, sectionKey: "reading-writing" | "math" = "math"): AnalyzeWholeQuestionInput {
  const parsed = parseTextHtml({ kind: "text", text }, { target: "rich" });
  return { pasted: parsed.document, targetField: "prompt", sectionKey, pastedPlainText: text };
}

const FULL_MCQ =
  "What is 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B\nExplanation: Basic addition.";

describe("analyzeWholeQuestion", () => {
  it("full MCQ paste suggests with choice-run + answer-key + explanation signals", () => {
    const a = analyzeWholeQuestion(input(FULL_MCQ));
    expect(a.band).toBe("suggest");
    expect(a.choices.map((c) => c.label)).toEqual(["A", "B", "C", "D"]);
    expect(a.correctChoice).toBe("B");
    expect(a.prompt).not.toBeNull();
    expect(a.rationale).not.toBeNull();
    expect(a.signals.map((s) => s.kind)).toEqual(expect.arrayContaining(["choice-run", "answer-key", "explanation-marker"]));
    expect(a.spans?.prompt).toBeDefined();
    expect(a.spans?.choices).toBeDefined();
    expect(a.spans?.rationale).toBeDefined();
  });
  it("maps bands at exactly 0.98 and 0.75", () => {
    expect(bandForConfidence(0.99)).toBe("auto-cleanup-only");
    expect(bandForConfidence(0.98)).toBe("auto-cleanup-only");
    expect(bandForConfidence(0.9)).toBe("suggest");
    expect(bandForConfidence(0.75)).toBe("suggest");
    expect(bandForConfidence(0.5)).toBe("preserve");
  });
  it("ambiguous prose preserves with ambiguous-label-prose", () => {
    const a = analyzeWholeQuestion(input("Plan A. was late. Part B. followed."));
    expect(a.band).toBe("preserve");
    expect(a.choices).toEqual([]);
  });
  it("partial A-B preserves with choice-count-mismatch", () => {
    const a = analyzeWholeQuestion(input("Pick one.\nA. yes\nB. no"));
    expect(a.band).toBe("preserve");
    expect(a.signals.map((s) => s.kind)).toContain("choice-count-mismatch");
  });
  it("conflicting keys preserve", () => {
    const a = analyzeWholeQuestion(input("Q?\nA. 1\nB. 2\nC. 3\nD. 4\nAnswer: B\nAnswer: C"));
    expect(a.band).toBe("preserve");
  });
  it("marker before choices is ignored; rationale null without post-choice marker", () => {
    const a = analyzeWholeQuestion(input("Explain the risks.\nA. x\nB. y\nC. z\nD. w"));
    expect(a.rationale).toBeNull();
    expect(a.band).toBe("suggest");
  });
  it("RW numeric answer never builds SPR", () => {
    const a = analyzeWholeQuestion(input("Solve 2x=6.\nAnswer: 3", "reading-writing"));
    expect(a.sprPrimary).toBeNull();
    expect(a.signals.map((s) => s.kind)).toContain("rw-spr-conflict");
  });
  it("math SPR stem+numeric suggests with spr-numeric-answer", () => {
    const a = analyzeWholeQuestion(input("Solve 2x=6.\nAnswer: 3", "math"));
    expect(a.band).toBe("suggest");
    expect(a.sprPrimary).toBe("3");
    expect(a.signals.map((s) => s.kind)).toContain("spr-numeric-answer");
  });
  it("stimulus split separates passage from stem", () => {
    const a = analyzeWholeQuestion(
      input("The passage describes photosynthesis.\n\nPlants convert light into energy.\n\nWhich process is described?\nA. respiration\nB. photosynthesis\nC. digestion\nD. fermentation"),
    );
    expect(a.stimulus).not.toBeNull();
    expect(a.signals.map((s) => s.kind)).toContain("stimulus-split");
  });
  it("short no-choice paste preserves with null stimulus", () => {
    const a = analyzeWholeQuestion(input("What is 2+2?"));
    expect(a.band).toBe("preserve");
    expect(a.stimulus).toBeNull();
  });
});
