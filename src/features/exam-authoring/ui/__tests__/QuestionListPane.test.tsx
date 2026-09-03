import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentModuleShell, AssessmentSectionShell } from "../../contracts/assessment";
import { QuestionListPane } from "../QuestionListPane";

const module: AssessmentModuleShell = {
  id: "rw-m1",
  moduleKey: "rw-m1",
  title: "Module 1",
  displayOrder: 0,
  durationSeconds: 1920,
  targetQuestionCount: 1,
  adaptiveRole: "base",
  toolPolicy: {},
  revision: 1,
  questions: [],
};

const sections: AssessmentSectionShell[] = [
  {
    id: "rw",
    sectionKey: "reading-writing",
    title: "Reading & Writing",
    displayOrder: 0,
    durationSeconds: 3840,
    breakAfterSeconds: 0,
    revision: 1,
    routingPolicy: null,
    modules: [module],
  },
];

describe("QuestionListPane search", () => {
  it("clears the active search with Escape", () => {
    const onSearchQueryChange = vi.fn();
    render(
      <QuestionListPane
        module={module}
        sections={sections}
        sectionKey="reading-writing"
        moveTargets={[]}
        selectedQuestionId={null}
        selectedQuestionIds={new Set()}
        searchQuery="text"
        filter="all"
        searchInputRef={{ current: null }}
        isMutating={false}
        onSearchQueryChange={onSearchQueryChange}
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
      />,
    );

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search questions" }), {
      key: "Escape",
    });

    expect(onSearchQueryChange).toHaveBeenCalledWith("");
  });
});
