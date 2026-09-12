import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { buildExamOverview, selectionAfterDelete } from "../overviewModel";
import { ExamOverviewPane } from "../ExamOverviewPane";
import type { AssessmentSectionShell, AssessmentQuestionSummary } from "../../contracts/assessment";

function summary(id: string, status: "ready" | "incomplete" | "error", pretest = false): AssessmentQuestionSummary {
  return {
    examQuestionId: id, questionId: "q-" + id, questionRevisionId: "r-" + id, displayOrder: 0,
    isPretest: pretest, questionType: "single_choice", semanticRevision: 1, revision: 1,
    promptPreview: "prompt " + id, answerKeyPreview: "A", domain: "domain", skill: "skill",
    difficulty: "medium", tags: [], hasStimulus: false, contentComplexity: "plain",
    readiness: { status, blockingIssueCount: status === "error" ? 1 : 0, warningCount: 0 },
  };
}

function section(id: string, key: string, title: string, modules: { id: string; key: string; title: string; role: "base" | "lower_branch" | "higher_branch"; count: number; target: number; pretest: number }[]): AssessmentSectionShell {
  return {
    id, sectionKey: key, title, displayOrder: 0, durationSeconds: 1920, breakAfterSeconds: 600, revision: 1, routingPolicy: null,
    modules: modules.map((m) => ({
      id: m.id, moduleKey: m.key, title: m.title, displayOrder: 0, durationSeconds: 640,
      targetQuestionCount: m.target, adaptiveRole: m.role, toolPolicy: [], revision: 1,
      questions: Array.from({ length: m.count }, (_, i) => summary(m.id + "-q" + i, i === 0 && m.pretest === 0 ? "error" : "ready", i < m.pretest)),
    })),
  };
}

const sections = () => [
  section("s-rw", "reading-writing", "Reading & Writing", [
    { id: "rw-m1", key: "rw-m1", title: "Module 1", role: "base", count: 27, target: 27, pretest: 2 },
    { id: "rw-lo", key: "rw-m2-lower", title: "Module 2 Lower", role: "lower_branch", count: 27, target: 27, pretest: 2 },
    { id: "rw-hi", key: "rw-m2-higher", title: "Module 2 Higher", role: "higher_branch", count: 27, target: 27, pretest: 2 },
  ]),
  section("s-m", "math", "Math", [
    { id: "m-m1", key: "math-m1", title: "Module 1", role: "base", count: 22, target: 22, pretest: 2 },
    { id: "m-lo", key: "math-m2-lower", title: "Module 2 Lower", role: "lower_branch", count: 22, target: 22, pretest: 2 },
    { id: "m-hi", key: "math-m2-higher", title: "Module 2 Higher", role: "higher_branch", count: 22, target: 22, pretest: 2 },
  ]),
];

describe("buildExamOverview", () => {
  it("derives six modules with authored/target, readiness, and pretest", () => {
    const overview = buildExamOverview(sections());
    expect(overview.modules).toHaveLength(6);
    expect(overview.authored).toBe(147);
    expect(overview.target).toBe(147);
    expect(overview.pretest).toBe(12);
    expect(overview.deliveredPerCandidate).toBe(98);
    for (const module of overview.modules) {
      expect(module.authored).toBe(module.target);
      expect(module.pretest).toBe(2);
    }
  });

  it("renders the authored-vs-delivered explainer and per-module cards", () => {
    const overview = buildExamOverview(sections());
    render(<ExamOverviewPane overview={overview} isMutating={false} onSelectModule={vi.fn()} />);
    expect(screen.getByTestId("exam-overview-pane")).toBeInTheDocument();
    expect(screen.getByText(/each candidate sees only 98/)).toBeInTheDocument();
    expect(screen.getAllByText("Open")).toHaveLength(6);
  });

  it("opens the selected module when a card Open is pressed", () => {
    const overview = buildExamOverview(sections());
    const onSelectModule = vi.fn();
    render(<ExamOverviewPane overview={overview} isMutating={false} onSelectModule={onSelectModule} />);
    fireEvent.click(screen.getAllByText("Open")[0]);
    expect(onSelectModule).toHaveBeenCalledWith("rw-m1");
  });
});

describe("selectionAfterDelete", () => {
  it("prefers the next sibling, then previous, then first, then null", () => {
    const remaining = [{ examQuestionId: "b" }, { examQuestionId: "c" }];
    expect(selectionAfterDelete(remaining, 0)).toEqual({ examQuestionId: "b", moduleId: null });
    expect(selectionAfterDelete([{ examQuestionId: "a" }], 1)).toEqual({ examQuestionId: "a", moduleId: null });
    expect(selectionAfterDelete([], 0)).toEqual({ examQuestionId: null, moduleId: null });
  });
});
