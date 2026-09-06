import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AssessmentAuthoringShell,
  AssessmentModuleShell,
  AssessmentQuestionSummary,
} from "../../contracts/assessment";
import { StructurePane } from "../StructurePane";

// jsdom guards: @dnd-kit/react sortable sensors may probe these browser APIs at
// render/effect time. Rendering the grid does not need real drag support.
if (typeof window !== "undefined") {
  if (typeof (window as unknown as Record<string, unknown>).ResizeObserver === "undefined") {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  }
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
}

function makeQuestion(
  overrides: Partial<AssessmentQuestionSummary> & { examQuestionId: string },
): AssessmentQuestionSummary {
  return {
    questionId: "q-" + overrides.examQuestionId,
    questionRevisionId: "qr-" + overrides.examQuestionId,
    displayOrder: 0,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview: "Prompt " + overrides.examQuestionId,
    answerKeyPreview: "B",
    domain: null,
    skill: null,
    difficulty: "easy",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "incomplete", blockingIssueCount: 0, warningCount: 0 },
    ...overrides,
  };
}

function makeModule(
  id: string,
  title: string,
  questions: AssessmentQuestionSummary[],
  targetQuestionCount = 10,
): AssessmentModuleShell {
  return {
    id,
    moduleKey: id,
    title,
    displayOrder: 0,
    durationSeconds: 1920,
    targetQuestionCount,
    adaptiveRole: "base",
    toolPolicy: {},
    revision: 1,
    questions,
  };
}

function makeShell(modules: AssessmentModuleShell[]): AssessmentAuthoringShell {
  return {
    examId: "exam-1",
    providerKey: "sat",
    versionId: "v-1",
    versionRevision: 1,
    sections: [
      {
        id: "sec-rw",
        sectionKey: "reading-writing",
        title: "Reading & Writing",
        displayOrder: 0,
        durationSeconds: 3840,
        breakAfterSeconds: 600,
        revision: 1,
        routingPolicy: null,
        modules,
      },
    ],
  };
}

function defaultShell(): AssessmentAuthoringShell {
  return makeShell([
    makeModule("mod-a", "Module A", [
      makeQuestion({
        examQuestionId: "eq-1",
        displayOrder: 0,
        readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
      }),
      makeQuestion({
        examQuestionId: "eq-2",
        displayOrder: 1,
        readiness: { status: "error", blockingIssueCount: 2, warningCount: 0 },
      }),
    ]),
    makeModule("mod-b", "Module B", [makeQuestion({ examQuestionId: "eq-3", displayOrder: 0 })]),
  ]);
}

function setup(overrides?: Partial<ComponentProps<typeof StructurePane>>) {
  const callbacks = {
    onSelectModule: vi.fn(),
    onSelectQuestion: vi.fn(),
    onCreateQuestion: vi.fn(),
    onReorderQuestions: vi.fn().mockResolvedValue(undefined),
    onBulkAction: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <StructurePane
      shell={defaultShell()}
      selectedModuleId="mod-a"
      selectedExamQuestionId={null}
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

describe("StructurePane", () => {
  it("renders sections, modules, and the selected module questions", () => {
    setup();

    expect(screen.getByText("Reading & Writing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Module A/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Module B/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Question 1. Ready to publish" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Question 2. 2 issues to fix" })).toBeInTheDocument();
    // The collapsed module questions stay hidden until it is selected.
    expect(screen.queryByRole("button", { name: /^Question 3/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add question/ })).toBeInTheDocument();
  });

  it("notifies when a module header is clicked", () => {
    const { onSelectModule } = setup();

    fireEvent.click(screen.getByRole("button", { name: /Module B/ }));

    expect(onSelectModule).toHaveBeenCalledWith("mod-b");
  });

  it("notifies when a question tile is clicked", () => {
    const { onSelectQuestion } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Question 2. 2 issues to fix" }));

    expect(onSelectQuestion).toHaveBeenCalledWith("eq-2", "mod-a");
  });

  it("creates a question from the add button", () => {
    const { onCreateQuestion } = setup();

    fireEvent.click(screen.getByRole("button", { name: /Add question/ }));

    expect(onCreateQuestion).toHaveBeenCalledWith("mod-a");
  });

  it("disables adding once the module reaches its target question count", () => {
    const shell = makeShell([
      makeModule("mod-full", "Full Module", [makeQuestion({ examQuestionId: "eq-9" })], 1),
    ]);
    const { onCreateQuestion } = setup({ shell, selectedModuleId: "mod-full" });

    expect(screen.getByText("Module complete")).toBeInTheDocument();
    const addButton = screen.getByRole("button", { name: /Module complete/ });
    expect(addButton).toBeDisabled();
    fireEvent.click(addButton);
    expect(onCreateQuestion).not.toHaveBeenCalled();
  });

  it("selects questions in bulk and duplicates them", async () => {
    const { onBulkAction } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(screen.getByText("Select questions")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Question 1. Ready to publish" }));
    fireEvent.click(screen.getByRole("button", { name: "Question 2. 2 issues to fix" }));
    // The selection count cross-fades through AnimatePresence mode="wait",
    // so the new count appears after the previous label exits.
    expect(await screen.findByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    await waitFor(() =>
      expect(onBulkAction).toHaveBeenCalledWith(["eq-1", "eq-2"], {
        type: "duplicate",
        destinationModuleId: "mod-a",
      }),
    );
  });

  it("moves selected questions to another module", async () => {
    const { onBulkAction } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Question 1. Ready to publish" }));

    expect(
      screen.getByRole("combobox", { name: "Move selected questions to module" }),
    ).toHaveValue("mod-b");

    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() =>
      expect(onBulkAction).toHaveBeenCalledWith(["eq-1"], {
        type: "move",
        destinationModuleId: "mod-b",
      }),
    );
  });

  it("deletes selected questions after confirmation", async () => {
    const { onBulkAction } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Question 1. Ready to publish" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByRole("alertdialog", { name: "Delete 1 question?" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));

    await waitFor(() =>
      expect(onBulkAction).toHaveBeenCalledWith(["eq-1"], { type: "delete" }),
    );
  });

  it("lists sortable question tiles in display order", () => {
    setup();

    // Reordering itself is a pointer-drag gesture through @dnd-kit with no
    // keyboard/button affordance, so jsdom (zero layout rects, no pointer
    // capture) cannot drive a real reorder. Pin the rendered tile order that
    // the drag source reads from instead.
    const tiles = screen.getAllByRole("button", { name: /^Question/ });
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
      "Question 1. Ready to publish",
      "Question 2. 2 issues to fix",
    ]);
  });

  it("renders an empty shell without crashing", () => {
    setup({ shell: { ...defaultShell(), sections: [] }, selectedModuleId: null });

    expect(screen.getByText("Questions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Module/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Question/ })).not.toBeInTheDocument();
  });

  it("renders an empty module with an add affordance and no select toggle", () => {
    const shell = makeShell([makeModule("mod-empty", "Empty Module", [])]);
    setup({ shell, selectedModuleId: "mod-empty" });

    expect(screen.getByRole("button", { name: /Empty Module/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Question/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add question/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select" })).not.toBeInTheDocument();
  });
});