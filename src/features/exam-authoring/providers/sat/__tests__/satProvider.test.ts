import { describe, expect, it } from "vitest";
import type { QuestionRevision, StructuredContent } from "../../../contracts/assessment";
import { plainContentFromText } from "../../../editor/richContent";
import { validateSatQuestion } from "../satProvider";

function question(overrides: Partial<QuestionRevision> = {}): QuestionRevision {
  return {
    id: "revision",
    questionId: "question",
    semanticRevision: 1,
    revision: 0,
    state: "draft",
    questionType: "single_choice",
    stimulus: plainContentFromText(""),
    prompt: plainContentFromText("Which choice is correct?"),
    answer: {
      kind: "single_choice",
      options: ["A", "B", "C", "D"].map((id) => ({
        id,
        content: plainContentFromText(`Choice ${id}`),
      })),
      correctOptionId: "A",
    },
    rationale: plainContentFromText(""),
    metadata: {
      sectionKey: "reading-writing",
      domain: "expression-of-ideas",
      skill: "Transitions",
      difficulty: "medium",
      tags: [],
    },
    accessibility: { longDescription: null },
    ...overrides,
  };
}

describe("SAT frontend validation parity", () => {
  it("recognizes version-2 document text as meaningful content", () => {
    expect(validateSatQuestion("reading-writing", question())).toEqual([]);
  });

  it("requires domain, skill, choice text, and a valid answer key", () => {
    const value = question({
      metadata: {
        sectionKey: "reading-writing",
        domain: null,
        skill: null,
        difficulty: "medium",
        tags: [],
      },
      answer: {
        kind: "single_choice",
        options: ["A", "B", "C", "D"].map((id) => ({
          id,
          content: plainContentFromText(id === "D" ? "" : `Choice ${id}`),
        })),
        correctOptionId: "missing",
      },
    });
    const codes = validateSatQuestion("reading-writing", value).map((issue) => issue.code);
    expect(codes).toContain("sat.metadata.domain.required");
    expect(codes).toContain("sat.metadata.skill.required");
    expect(codes).toContain("sat.choice.content.required");
    expect(codes).toContain("sat.correct_answer.invalid");
  });

  it("validates alternative text inside version-2 rich documents", () => {
    const rich: StructuredContent = {
      version: 2,
      nodes: [],
      document: { type: "doc", content: [{ type: "image", attrs: { alt: "" } }] },
    };
    const codes = validateSatQuestion("reading-writing", question({ stimulus: rich })).map(
      (issue) => issue.code
    );
    expect(codes).toContain("sat.accessibility.alt.required");
  });
  it("accepts graphical answer choices when every visual has a source and alt text", () => {
    const options = ["A", "B", "C", "D"].map((id) => ({
      id,
      content: {
        version: 2 as const,
        nodes: [],
        document: {
          type: "doc" as const,
          content: [
            {
              type: "image",
              attrs: {
                assetId: `asset-${id}`,
                src: `/api/v1/media/asset-${id}`,
                alt: `Graph ${id}`,
              },
            },
          ],
        },
      },
    }));
    const value = question({
      metadata: {
        sectionKey: "math",
        domain: "advanced-math",
        skill: "Nonlinear Functions",
        difficulty: "medium",
        tags: [],
      },
      answer: { kind: "single_choice", options, correctOptionId: "B" },
    });
    expect(validateSatQuestion("math", value)).toEqual([]);
  });

  it("rejects an image node that has alt text but no media source", () => {
    const rich: StructuredContent = {
      version: 2,
      nodes: [],
      document: { type: "doc", content: [{ type: "image", attrs: { alt: "A graph" } }] },
    };
    expect(
      validateSatQuestion("reading-writing", question({ stimulus: rich })).map(
        (issue) => issue.code
      )
    ).toContain("sat.media.source.required");
  });

  it("rejects a skill that does not belong to the selected domain", () => {
    const value = question({
      metadata: {
        sectionKey: "reading-writing",
        domain: "expression-of-ideas",
        skill: "Circles",
        difficulty: "medium",
        tags: [],
      },
    });
    expect(validateSatQuestion("reading-writing", value).map((issue) => issue.code)).toContain(
      "sat.metadata.skill.invalid"
    );
  });

  it("requires the primary student-produced response even when an equivalent is present", () => {
    const value = question({
      questionType: "student_produced_response",
      metadata: {
        sectionKey: "math",
        domain: "algebra",
        skill: "Linear Functions",
        difficulty: "medium",
        tags: [],
      },
      answer: {
        kind: "student_produced_response",
        acceptedResponses: ["", "12"],
        normalizeFraction: true,
        normalizeDecimal: true,
        numericTolerance: null,
      },
    });
    expect(validateSatQuestion("math", value).map((issue) => issue.code)).toContain(
      "sat.spr.primary.required"
    );
  });

  it("rejects SAT-invalid student-produced response keys", () => {
    const value = question({
      questionType: "student_produced_response",
      metadata: {
        sectionKey: "math",
        domain: "algebra",
        skill: "Linear Functions",
        difficulty: "medium",
        tags: [],
      },
      answer: {
        kind: "student_produced_response",
        acceptedResponses: ["12%", "1/0"],
        normalizeFraction: true,
        normalizeDecimal: true,
        numericTolerance: null,
      },
    });
    const codes = validateSatQuestion("math", value).map((issue) => issue.code);
    expect(codes).toContain("sat.spr.characters");
    expect(codes).toContain("sat.spr.denominator_zero");
  });
});
