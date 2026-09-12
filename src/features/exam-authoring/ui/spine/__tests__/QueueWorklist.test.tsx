import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentModuleShell, AssessmentSectionShell } from "../../../contracts/assessment";
import { QuestionQueueRail } from "../QuestionQueueRail";

function summary(id: string, index: number, status: "ready" | "incomplete" | "error" = "ready") {
  return {
    examQuestionId: id,
    questionId: `${id}-base`,
    questionRevisionId: `${id}-rev`,
    displayOrder: index,
    isPretest: false,
    questionType: "single_choice" as const,
    semanticRevision: 1,
    revision: 1,
    promptPreview: `Prompt ${index + 1}`,
    answerKeyPreview: "A",
    domain: "algebra",
    skill: "Linear equations",
    difficulty: "medium" as const,
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain" as const,
    readiness: { status, blockingIssueCount: status === "ready" ? 0 : 1, warningCount: 0 },
  };
}

const module: AssessmentModuleShell = {
  id: "rw-m1",
  moduleKey: "rw-m1",
  title: "Module 1",
  displayOrder: 0,
  durationSeconds: 1920,
  targetQuestionCount: 3,
  adaptiveRole: "base",
  toolPolicy: {},
  revision: 1,
  questions: [summary("q-1", 0, "ready"), summary("q-2", 1, "error")],
};

const sections: AssessmentSectionShell[] = [
  { id: "rw", sectionKey: "reading-writing", title: "Reading & Writing", displayOrder: 0, durationSeconds: 3840, breakAfterSeconds: 600, revision: 1, routingPolicy: null, modules: [module] },
];

function rail(overrides: Partial<Parameters<typeof QuestionQueueRail>[0]> = {}) {
  return (
    <QuestionQueueRail
      module={module}
      sections={sections}
      sectionKey="reading-writing"
      moveTargets={[]}
      selectedQuestionId="q-1"
      selectedQuestionIds={new Set()}
      searchQuery=""
      filter="all"
      searchInputRef={{ current: null }}
      isMutating={false}
      onSearchQueryChange={vi.fn()}
      onSelectModule={vi.fn()}
      onOpenImport={vi.fn()}
      onFilterChange={vi.fn()}
      onSelectQuestion={vi.fn()}
      onCreateQuestion={vi.fn()}
      onToggleSelection={vi.fn()}
      onClearSelection={vi.fn()}
      onReorder={vi.fn().mockResolvedValue(undefined)}
      onBulkAction={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />
  );
}

describe("QueueWorklist — scannable worklist", () => {
  it("surfaces difficulty at a glance in every row", () => {
    render(rail());
    const rows = screen.getAllByRole("button", { name: /question \d+:/i });
    for (const row of rows) expect(row.getAttribute("aria-label")).toMatch(/medium/i);
  });

  it("makes bulk selection keyboard-operable with a visible checkbox", () => {
    const onToggleSelection = vi.fn();
    render(rail({ onToggleSelection }));
    expect(screen.queryByRole("checkbox", { name: /select question 1/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Question list actions"}));
    fireEvent.click(screen.getByRole("menuitem", {name: "Select questions"}));
    const toggle = screen.getByRole("checkbox", { name: /select question 1/i });
    expect(toggle).toBeVisible();
    fireEvent.click(toggle);
    expect(onToggleSelection).toHaveBeenCalledWith("q-1", false);
  });
});
