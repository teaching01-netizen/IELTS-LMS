import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentModuleShell, AssessmentSectionShell } from "../../../contracts/assessment";
import { QuestionQueueRail } from "../QuestionQueueRail";

// react-virtuoso relies on layout measurement unavailable in jsdom; render
// rows synchronously like the existing workspace suites do.
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, row: never) => React.ReactNode }) => (
    <div data-testid="virtuoso-list">
      {data.map((row, index) => (
        <div key={index} data-testid="virtuoso-item">
          {itemContent(index, row as never)}
        </div>
      ))}
    </div>
  ),
}));

function summary(id: string, index: number) {
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
    readiness: { status: "ready" as const, blockingIssueCount: 0, warningCount: 0 },
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
  questions: [summary("q-1", 0), summary("q-2", 1)],
};

const sections: AssessmentSectionShell[] = [
  {
    id: "rw", sectionKey: "reading-writing", title: "Reading & Writing", displayOrder: 0,
    durationSeconds: 3840, breakAfterSeconds: 600, revision: 1, routingPolicy: null, modules: [module],
  },
];

function renderRail(overrides: Partial<Parameters<typeof QuestionQueueRail>[0]> = {}) {
  return render(
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
      onQuickAnswerKey={vi.fn()}
      onReorder={vi.fn().mockResolvedValue(undefined)}
      onBulkAction={vi.fn().mockResolvedValue(undefined)}
      saveStatus="saved"
      {...overrides}
    />,
  );
}

describe("QuestionQueueRail", () => {
  it("announces the current question with text, not color alone", () => {
    renderRail();
    expect(screen.getByRole("button", { name: /question 1.*current/i })).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("selects the question when any area of the row is clicked", () => {
    const onSelectQuestion = vi.fn();
    renderRail({ onSelectQuestion });
    fireEvent.click(screen.getByRole("button", { name: /question 2:/i }));
    expect(onSelectQuestion).toHaveBeenCalledWith("q-2");
  });

  it("clears the active search with Escape", () => {
    const onSearchQueryChange = vi.fn();
    renderRail({ searchQuery: "text", onSearchQueryChange });
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search questions" }), { key: "Escape" });
    expect(onSearchQueryChange).toHaveBeenCalledWith("");
  });

  it("pads empty slots only in the unfiltered view", () => {
    const { rerender } = renderRail();
    expect(screen.getByRole("button", { name: "Add question 3" })).toBeInTheDocument();
    rerender(
      <QuestionQueueRail
        module={module} sections={sections} sectionKey="reading-writing" moveTargets={[]}
        selectedQuestionId="q-1" selectedQuestionIds={new Set()} searchQuery="" filter="ready"
        searchInputRef={{ current: null }} isMutating={false} onSearchQueryChange={vi.fn()}
        onSelectModule={vi.fn()} onOpenImport={vi.fn()} onFilterChange={vi.fn()}
        onSelectQuestion={vi.fn()} onCreateQuestion={vi.fn()} onToggleSelection={vi.fn()}
        onClearSelection={vi.fn()} onQuickAnswerKey={vi.fn()}
        onReorder={vi.fn().mockResolvedValue(undefined)} onBulkAction={vi.fn().mockResolvedValue(undefined)}
        saveStatus="saved"
      />,
    );
    expect(screen.queryByRole("button", { name: /add question/i })).not.toBeInTheDocument();
  });
});
