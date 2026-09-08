import { describe, expect, it } from "vitest";
import type { AssessmentModuleShell, AssessmentQuestionSummary } from "../../../contracts/assessment";
import {
  buildQueueRows,
  countQueueReadiness,
  findQueueModule,
  matchesQueueSearch,
  normalizeQueueSearch,
} from "../queueModel";
import type { AssessmentSectionShell } from "../../../contracts/assessment";

function summary(overrides: Partial<AssessmentQuestionSummary> & { examQuestionId: string }): AssessmentQuestionSummary {
  return {
    questionId: `${overrides.examQuestionId}-base`,
    questionRevisionId: `${overrides.examQuestionId}-rev`,
    displayOrder: 0,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview: "Prompt",
    answerKeyPreview: "A",
    domain: null,
    skill: null,
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
    ...overrides,
  };
}

function moduleWith(questions: AssessmentQuestionSummary[], target = 4): AssessmentModuleShell {
  return {
    id: "rw-m1",
    moduleKey: "rw-m1",
    title: "Module 1",
    displayOrder: 0,
    durationSeconds: 1920,
    targetQuestionCount: target,
    adaptiveRole: "base",
    toolPolicy: {},
    revision: 1,
    questions,
  };
}

describe("queueModel", () => {
  it("normalizes search input (trim + lowercase)", () => {
    expect(normalizeQueueSearch("  Linear  ")).toBe("linear");
  });

  it("matches across prompt, key, domain, skill, difficulty, and tags", () => {
    const question = summary({
      examQuestionId: "q-1",
      promptPreview: "Solve the linear equation",
      answerKeyPreview: "B",
      domain: "algebra",
      skill: "Linear equations",
      difficulty: "hard",
      tags: ["no-calculator"],
    });
    expect(matchesQueueSearch(question, "linear")).toBe(true);
    // Callers normalize first (mirrors QuestionListPane: normalizeSearch then matchesSearch).
    expect(matchesQueueSearch(question, normalizeQueueSearch("NO-CALC"))).toBe(true);
    expect(matchesQueueSearch(question, "hard")).toBe(true);
    expect(matchesQueueSearch(question, "geometry")).toBe(false);
    expect(matchesQueueSearch(question, "")).toBe(true);
  });

  it("filters by readiness and pads empty slots only for the unfiltered view", () => {
    const module = moduleWith(
      [
        summary({ examQuestionId: "q-1", readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 } }),
        summary({ examQuestionId: "q-2", readiness: { status: "error", blockingIssueCount: 1, warningCount: 0 } }),
      ],
      4,
    );
    const all = buildQueueRows(module, "", "all");
    expect(all.filter((row) => row.kind === "question")).toHaveLength(2);
    expect(all.filter((row) => row.kind === "empty")).toHaveLength(2);
    const errors = buildQueueRows(module, "", "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe("question");
    const searched = buildQueueRows(module, "q-9-no-match", "all");
    expect(searched).toHaveLength(0);
  });

  it("counts readiness without forking semantics", () => {
    const module = moduleWith([
      summary({ examQuestionId: "q-1", readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 } }),
      summary({ examQuestionId: "q-2", readiness: { status: "incomplete", blockingIssueCount: 1, warningCount: 0 } }),
      summary({ examQuestionId: "q-3", readiness: { status: "error", blockingIssueCount: 1, warningCount: 0 } }),
    ]);
    expect(countQueueReadiness(module)).toEqual({ ready: 1, incomplete: 1, error: 1 });
  });

  it("finds a module across sections", () => {
    const module = moduleWith([]);
    const sections: AssessmentSectionShell[] = [
      {
        id: "rw", sectionKey: "reading-writing", title: "Reading & Writing", displayOrder: 0,
        durationSeconds: 3840, breakAfterSeconds: 600, revision: 1, routingPolicy: null, modules: [module],
      },
    ];
    expect(findQueueModule(sections, "rw-m1")?.id).toBe("rw-m1");
    expect(findQueueModule(sections, "missing")).toBeNull();
  });
});
