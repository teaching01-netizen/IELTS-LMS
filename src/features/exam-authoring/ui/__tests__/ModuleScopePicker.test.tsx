import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentSectionShell } from "../../contracts/assessment";
import { ModuleScopePicker } from "../ModuleScopePicker";

function module(id: string, title: string, authored: number, target = 27) {
  return {
    id,
    moduleKey: id,
    title,
    displayOrder: 0,
    durationSeconds: 1920,
    targetQuestionCount: target,
    adaptiveRole: "base" as const,
    toolPolicy: {},
    revision: 1,
    questions: Array.from({ length: authored }, (_, index) => ({
      examQuestionId: `${id}-q-${index}`,
      questionId: `${id}-base-${index}`,
      questionRevisionId: `${id}-revision-${index}`,
      displayOrder: index,
      isPretest: false,
      questionType: "single_choice" as const,
      semanticRevision: 1,
      revision: 1,
      promptPreview: `Question ${index + 1}`,
      answerKeyPreview: "A",
      domain: "information-and-ideas",
      skill: "Central Ideas and Details",
      difficulty: "medium" as const,
      tags: [],
      hasStimulus: false,
      contentComplexity: "plain" as const,
      readiness: { status: "ready" as const, blockingIssueCount: 0, warningCount: 0 },
    })),
  };
}

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
    modules: [module("rw-m1", "Module 1", 18), module("rw-m2", "Module 2 — Higher", 27)],
  },
  {
    id: "math",
    sectionKey: "math",
    title: "Math",
    displayOrder: 1,
    durationSeconds: 4200,
    breakAfterSeconds: 0,
    revision: 1,
    routingPolicy: null,
    modules: [module("math-m1", "Module 1", 7, 22)],
  },
];

describe("ModuleScopePicker", () => {
  it("keeps the current SAT scope visible without a permanent structure sidebar", () => {
    render(<ModuleScopePicker sections={sections} selectedModuleId="rw-m1" onSelectModule={vi.fn()} />);
    expect(screen.getByText("Reading & Writing")).toBeInTheDocument();
    expect(screen.getByText("18/27")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows all module choices grouped by section and changes the active scope", () => {
    const onSelectModule = vi.fn();
    render(<ModuleScopePicker sections={sections} selectedModuleId="rw-m1" onSelectModule={onSelectModule} />);
    fireEvent.click(screen.getByRole("button", { name: /Reading & Writing/i }));
    expect(screen.getByRole("menu", { name: "Choose SAT module" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    expect(screen.getByRole("menuitemradio", { name: /Module 1.*18\/27/i })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Module 2 — Higher/i }));
    expect(onSelectModule).toHaveBeenCalledWith("rw-m2");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("keeps the full adaptive module menu isolated and scroll-bounded", () => {
    render(<ModuleScopePicker sections={sections} selectedModuleId="rw-m1" onSelectModule={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Reading & Writing/i }));
    const menu = screen.getByRole("menu", { name: "Choose SAT module" });
    expect(menu).toHaveClass("bg-au-surface", "overflow-y-auto", "overscroll-contain", "isolate");
    expect(menu.className).toContain("max-h-[min(520px,calc(100vh-112px))]");
    for (const item of screen.getAllByRole("menuitemradio")) {
      expect(item.className).toContain("min-h-[58px]");
    }
  });

  it("opens from ArrowDown and closes with Escape", () => {
    render(<ModuleScopePicker sections={sections} selectedModuleId="rw-m1" onSelectModule={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /Reading & Writing/i });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
