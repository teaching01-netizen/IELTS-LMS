import { describe, expect, it, vi } from "vitest";
import type { QuestionRevision, StructuredContent } from "../../../contracts/assessment";
import { validateSatQuestion } from "../../../providers/sat/satProvider";
import { plainTextFromContent } from "../../richContent";
import { parseTextHtml } from "../adapters/textHtml";
import { analyzeWholeQuestion } from "./analyzeWholeQuestion";
import { buildSplitQuestion } from "./applyWholeQuestionSplit";

function content(): StructuredContent {
  return { version: 2, nodes: [], document: { type: "doc", content: [{ type: "paragraph" }] } };
}

function choiceRevision(sectionKey = "math"): QuestionRevision {
  const option = (id: string) => ({ id, content: content() });
  return {
    id: "rev-1", questionId: "q-1", semanticRevision: 1, revision: 1, state: "draft",
    questionType: "single_choice", stimulus: content(), prompt: content(), rationale: content(),
    answer: { kind: "single_choice", options: [option("a"), option("b"), option("c"), option("d")], correctOptionId: "a" },
    metadata: { sectionKey, domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: { longDescription: null },
  };
}

const FULL_MCQ = "What is 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B\nExplanation: Basic addition.";

function mcqAnalysis() {
  const parsed = parseTextHtml({ kind: "text", text: FULL_MCQ }, { target: "rich" });
  return analyzeWholeQuestion({ pasted: parsed.document, targetField: "prompt", sectionKey: "math", pastedPlainText: FULL_MCQ });
}

describe("buildSplitQuestion", () => {
  it("atomically applies MCQ: same ids, key on B, revalidates", () => {
    const current = choiceRevision();
    const analysis = mcqAnalysis();
    expect(analysis.band).toBe("suggest");
    const next = buildSplitQuestion(current, analysis);
    if (next.answer.kind !== "single_choice") throw new Error("expected single_choice");
    expect(next.answer.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    expect(next.answer.correctOptionId).toBe("b");
    expect(next.questionType).toBe("single_choice");
    expect(plainTextFromContent(next.prompt)).toContain("2 + 2");
    expect(plainTextFromContent(next.answer.options[1]?.content ?? content())).toContain("4");
    expect(plainTextFromContent(next.rationale)).toContain("addition");
    const issues = validateSatQuestion("math", next);
    expect(issues.filter((i) => i.blocking && i.code !== "sat.metadata.domain.required" && i.code !== "sat.metadata.skill.required").map((i) => i.code)).toEqual([]);
  });
  it("missing key applies with null key and validation flags it", () => {
    const current = choiceRevision();
    const text = "Pick one.\nA. x\nB. y\nC. z\nD. w";
    const parsed = parseTextHtml({ kind: "text", text }, { target: "rich" });
    const analysis = analyzeWholeQuestion({ pasted: parsed.document, targetField: "prompt", sectionKey: "math", pastedPlainText: text });
    const next = buildSplitQuestion(current, analysis);
    if (next.answer.kind !== "single_choice") throw new Error("expected single_choice");
    expect(next.answer.correctOptionId).toBeNull();
    const issues = validateSatQuestion("math", next);
    expect(issues.map((i) => i.code)).toContain("sat.correct_answer.required");
  });
  it("SPR applies in math, never in RW", () => {
    const sprText = "Solve 2x=6.\nAnswer: 3";
    const parsed = parseTextHtml({ kind: "text", text: sprText }, { target: "rich" });
    const mathAnalysis = analyzeWholeQuestion({ pasted: parsed.document, targetField: "prompt", sectionKey: "math", pastedPlainText: sprText });
    const mathNext = buildSplitQuestion(choiceRevision("math"), mathAnalysis, { makeId: () => "fixed-id" });
    expect(mathNext.questionType).toBe("student_produced_response");
    if (mathNext.answer.kind !== "student_produced_response") throw new Error("expected spr");
    expect(mathNext.answer.acceptedResponses).toEqual(["3"]);
    const issues = validateSatQuestion("math", mathNext);
    expect(issues.filter((i) => i.blocking && i.code.startsWith("sat.spr."))).toEqual([]);
    const rwParsed = parseTextHtml({ kind: "text", text: sprText }, { target: "rich" });
    const rwAnalysis = analyzeWholeQuestion({ pasted: rwParsed.document, targetField: "prompt", sectionKey: "reading-writing", pastedPlainText: sprText });
    const rwNext = buildSplitQuestion(choiceRevision("reading-writing"), rwAnalysis);
    expect(rwNext.answer.kind).toBe("single_choice");
  });
  it("preserves metadata/accessibility/counters", () => {
    const current = { ...choiceRevision(), metadata: { sectionKey: "math", domain: "algebra", skill: "linear", difficulty: "easy" as const, tags: ["t1"] }, accessibility: { longDescription: "desc" } };
    const next = buildSplitQuestion(current, mcqAnalysis());
    expect(next.metadata).toEqual(current.metadata);
    expect(next.accessibility).toEqual(current.accessibility);
    expect(next.revision).toBe(current.revision);
    expect(next.semanticRevision).toBe(current.semanticRevision);
    expect(next.id).toBe(current.id);
  });
  it("single-writer: pure builder with no React/TipTap/network imports", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "applyWholeQuestionSplit.ts"), "utf8");
    for (const token of ["from \"react\"", "from '@tiptap", "from \"@tiptap", "fetch(", "XMLHttpRequest", "useEditor", "useState"]) {
      expect(source.includes(token), "builder must not contain " + token).toBe(false);
    }
    expect(source).not.toMatch(/export function (?!buildSplitQuestion)/);
  });
});
