import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { QuestionRevision, StructuredContent } from "../../../contracts/assessment";
import { plainContentFromText } from "../../../editor/richContent";
import { SAT_BLUEPRINT, validateSatQuestion } from "../satProvider";
import { SAT_DOMAINS, SAT_SKILLS } from "../taxonomy";

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

// offcut: the Go readiness gate and this editor keep separate copies of the SAT
// blueprint and taxonomy (different runtimes); these pins fail on drift instead
// of generating one from the other.
describe("Go readiness parity", () => {
  const goSource = readFileSync(
    resolve(process.cwd(), "backend/go/internal/authoring/readiness.go"),
    "utf8"
  );
  const goFunction = (name: string) => {
    const start = goSource.indexOf(`func ${name}(`);
    return goSource.slice(start, goSource.indexOf("\n}\n", start));
  };

  it.each(SAT_BLUEPRINT)("matches the Go blueprint for $key", (section) => {
    const goSection = section.key === "math" ? "SectionMath" : "SectionReadingWriting";
    const match = new RegExp(
      `case ${goSection}:\\s*spec = satBlueprintModuleSpec\\{durationSeconds: (\\d+) \\* 60, questionCount: (\\d+), pretestCount: (\\d+)(?:, tools: \\[\\]string\\{([^}]*)\\})?\\}\\s*switch moduleKey \\{\\s*case ([^:]+):`
    ).exec(goFunction("satBlueprintModule"));
    expect(match).not.toBeNull();
    const [, minutes, questionCount, pretestCount, tools = "", moduleKeys] = match!;
    const quoted = (list: string) => [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    expect(section.modules.map((module) => module.key)).toEqual(quoted(moduleKeys!));
    for (const module of section.modules) {
      expect(module.durationSeconds).toBe(Number(minutes) * 60);
      expect(module.questionCount).toBe(Number(questionCount));
      expect(module.pretestCount).toBe(Number(pretestCount));
      expect(module.tools).toEqual(quoted(tools));
    }
  });

  it("holds the same domains and skills as the Go taxonomy", () => {
    const goEntries = (name: string) =>
      [...goFunction(name).matchAll(/"([^"]+)": true/g)].map((m) => m[1]).sort();
    const domains = Object.values(SAT_DOMAINS).flatMap((list) => list.map((d) => d.key));
    const skills = Object.values(SAT_SKILLS).flat();

    expect(goEntries("satDomainValid")).toEqual([...domains].sort());
    expect(goEntries("satSkillValid")).toEqual([...skills].sort());
  });
});
