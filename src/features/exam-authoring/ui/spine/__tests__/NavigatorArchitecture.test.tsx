import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentModuleShell, AssessmentSectionShell } from "../../../contracts/assessment";
import { QuestionQueueRail } from "../QuestionQueueRail";

function summary(id: string, index: number, status: "ready" | "incomplete" | "error" = "ready") {
  return {
    examQuestionId: id,
    questionId: id + "-base",
    questionRevisionId: id + "-rev",
    displayOrder: index,
    isPretest: false,
    questionType: "single_choice" as const,
    semanticRevision: 1,
    revision: 1,
    promptPreview: "Prompt " + (index + 1),
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

function module(id: string, title: string, questions: ReturnType<typeof summary>[]): AssessmentModuleShell {
  return {
    id,
    moduleKey: id,
    title,
    displayOrder: 0,
    durationSeconds: 1920,
    targetQuestionCount: 3,
    adaptiveRole: "base",
    toolPolicy: {},
    revision: 1,
    questions,
  };
}

const mathModule = module("math-m1", "Module 1", [summary("m-1", 0)]);
const rwModules = [
  module("rw-m1", "Module 1", [summary("q-1", 0), summary("q-2", 1, "error")]),
  module("rw-m2", "Module 2", [summary("q-3", 0)]),
];
const sections: AssessmentSectionShell[] = [
  {
    id: "rw",
    sectionKey: "reading-writing",
    title: "Reading & Writing",
    displayOrder: 0,
    durationSeconds: 3840,
    breakAfterSeconds: 600,
    revision: 1,
    routingPolicy: null,
    modules: rwModules,
  },
  {
    id: "math",
    sectionKey: "math",
    title: "Math",
    displayOrder: 1,
    durationSeconds: 2100,
    breakAfterSeconds: 0,
    revision: 1,
    routingPolicy: null,
    modules: [mathModule],
  },
];

function rail(overrides: Record<string, unknown> = {}) {
  const base = {
    module: rwModules[0]!,
    sections,
    sectionKey: "reading-writing",
    sectionTitle: "Reading & Writing",
    moveTargets: [],
    selectedQuestionId: "q-1",
    selectedQuestionIds: new Set(),
    searchQuery: "",
    filter: "all" as const,
    searchInputRef: { current: null },
    isMutating: false,
    onSearchQueryChange: vi.fn(),
    onSelectModule: vi.fn(),
    onOpenImport: vi.fn(),
    onFilterChange: vi.fn(),
    onSelectQuestion: vi.fn(),
    onCreateQuestion: vi.fn(),
    onToggleSelection: vi.fn(),
    onClearSelection: vi.fn(),
    onReorder: vi.fn().mockResolvedValue(undefined),
    onBulkAction: vi.fn().mockResolvedValue(undefined),
  };
  const props = Object.assign(base, overrides);
  return <QuestionQueueRail {...(props as never)} />;
}

describe("Navigator architecture", () => {
  it("exposes every module of the section as one-click tabs, not a dropdown", () => {
    const onSelectModule = vi.fn();
    render(rail({ onSelectModule }));
    const module1 = screen.getByRole("tab", { name: /Module 1,.*ready/i });
    const module2 = screen.getByRole("tab", { name: /Module 2,.*ready/i });
    expect(module1).toBeVisible();
    expect(module2).toBeVisible();
    fireEvent.click(module2);
    expect(onSelectModule).toHaveBeenCalledWith("rw-m2");
    expect(screen.queryByRole("button", { name: /choose module/i })).not.toBeInTheDocument();
  });

  it("exposes both sections when more than one exists", () => {
    render(rail());
    const tabs = screen.getAllByRole("tab");
    const labels = tabs.map((tab) => tab.textContent ?? "");
    expect(labels.some((label) => /Reading & Writing/.test(label))).toBe(true);
    expect(labels.some((label) => /Math/.test(label))).toBe(true);
  });

  it("supports arrow-key module switching with tabs semantics", () => {
    const onSelectModule = vi.fn();
    render(rail({ onSelectModule }));
    const module1 = screen.getByRole("tab", { name: /Module 1,.*ready/i });
    module1.focus();
    fireEvent.keyDown(module1.parentElement!, { key: "ArrowRight" });
    expect(onSelectModule).toHaveBeenCalledWith("rw-m2");
  });

  it("labels progress in words and separates authored from ready", () => {
    render(rail());
    expect(screen.getByText(/of \d+ authored/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Module 1, 1 of 3 questions ready/i })).toBeInTheDocument();
  });

  it("restores the remembered question when returning to a module", () => {
    const onSelectQuestion = vi.fn();
    const { rerender } = render(rail({ onSelectQuestion, selectedQuestionId: "q-1" }));
    // User selects question 2 in Module 1, then switches to Module 2
    rerender(rail({ onSelectQuestion, selectedQuestionId: "q-2", module: rwModules[0]! }));
    rerender(rail({ onSelectQuestion, selectedQuestionId: "q-2", module: rwModules[1]! }));
    rerender(rail({ onSelectQuestion, selectedQuestionId: "q-3", module: rwModules[1]! }));
    // Returning to Module 1 should restore question 2, not question 1
    rerender(rail({ onSelectQuestion, selectedQuestionId: "q-3", module: rwModules[0]! }));
    const calls = onSelectQuestion.mock.calls.map((call) => call[0]);
    expect(calls).toContain("q-2");
  });

  it("keeps module controls outside the scrolling question list", () => {
    render(rail());
    const nav = screen.getByRole("navigation", { name: /question navigator/i });
    const list = nav.querySelector("[data-queue-scroll-region]");
    const region = nav.querySelector(".sat-spine__nav-region");
    expect(list).not.toBeNull();
    expect(region).not.toBeNull();
    expect(list!.contains(region!)).toBe(false);
    expect(within(nav).getByRole("tab", { name: /Module 2,.*ready/i })).toBeVisible();
  });
});
