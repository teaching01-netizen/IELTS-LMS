import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AssessmentModuleShell,
  AssessmentQuestionSummary,
  AssessmentSectionShell,
} from "../../../contracts/assessment";
import { QuestionCardStack, describeCardStatus, type QuestionCardStackProps } from "../QuestionCardStack";

function summary(id: string, overrides: Partial<AssessmentQuestionSummary> = {}): AssessmentQuestionSummary {
  return {
    examQuestionId: id,
    questionId: `q-${id}`,
    questionRevisionId: `rev-${id}`,
    displayOrder: 0,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview: `Prompt for ${id}`,
    answerKeyPreview: "B",
    domain: "Algebra",
    skill: "Linear equations",
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
    ...overrides,
  };
}

function moduleWith(questions: AssessmentQuestionSummary[], target = 3): AssessmentModuleShell {
  return {
    id: "mod-1",
    moduleKey: "m1",
    title: "Module 1",
    displayOrder: 0,
    durationSeconds: 1920,
    targetQuestionCount: target,
    adaptiveRole: "base",
    toolPolicy: {},
    revision: 1,
    questions,
  } as AssessmentModuleShell;
}

function renderStack(overrides: Partial<QuestionCardStackProps> = {}, module = moduleWith([summary("a"), summary("b"), summary("c", { domain: null, skill: null, readiness: { status: "incomplete", blockingIssueCount: 2, warningCount: 0 } })])) {
  const section = { id: "s1", sectionKey: "math", title: "Math", modules: [module] } as unknown as AssessmentSectionShell;
  const props: QuestionCardStackProps = {
    module,
    sections: [section],
    sectionTitle: "Math",
    selectedQuestionId: "a",
    isMutating: false,
    showModuleSwitcher: false,
    onSelectModule: vi.fn(),
    onSelectQuestion: vi.fn(),
    onAddQuestion: vi.fn(),
    activeCard: <div data-testid="editor">The one editor</div>,
    ...overrides,
  };
  return { props, ...render(<QuestionCardStack {...props} />) };
}

describe("describeCardStatus", () => {
  it("says Ready for a ready question", () => {
    expect(describeCardStatus(summary("a"))).toEqual({ tone: "ready", label: "Ready", text: "Ready", missing: [], field: null });
  });

  it("names what an incomplete question is missing, in words", () => {
    const status = describeCardStatus(
      summary("a", {
        promptPreview: "",
        answerKeyPreview: null,
        domain: null,
        skill: null,
        readiness: { status: "incomplete", blockingIssueCount: 4, warningCount: 0 },
      }),
    );
    expect(status.tone).toBe("incomplete");
    expect(status.label).toBe("Incomplete");
    expect(status.text).toBe("Incomplete · Missing question text, answer key, Domain, Skill");
    expect(status.field).toBe("prompt");
  });

  it("uses the accepted-answer wording for student-produced responses and flags errors", () => {
    const status = describeCardStatus(
      summary("a", {
        questionType: "student_produced_response",
        answerKeyPreview: null,
        readiness: { status: "error", blockingIssueCount: 1, warningCount: 0 },
      }),
    );
    expect(status).toEqual({ tone: "error", label: "Needs attention", text: "Needs attention · Missing accepted answer", missing: ["accepted answer"], field: "answer" });
  });
});

describe("QuestionCardStack", () => {
  it("mounts the editor once, in the active card only", () => {
    renderStack();
    const active = screen.getByRole("region", { name: "Question 1, editing" });
    expect(within(active).getByTestId("editor")).toBeInTheDocument();
    expect(screen.getAllByTestId("editor")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Question 2\. Ready\. Open to edit$/ })).toBeInTheDocument();
  });

  it("summarises an unfinished card with words, not colour alone", () => {
    renderStack();
    expect(
      screen.getByRole("button", { name: "Question 3. Incomplete · Missing Domain, Skill. Open to edit" }),
    ).toBeInTheDocument();
  });

  it("opens a card when its summary is chosen", () => {
    const { props } = renderStack();
    fireEvent.click(screen.getByRole("button", { name: /^Question 2\./ }));
    expect(props.onSelectQuestion).toHaveBeenCalledWith("b", null);
  });

  it("opens an unfinished card at its first missing field and names the gap on the card", () => {
    const { props } = renderStack();
    const card = screen.getByRole("button", { name: /^Question 3\./ });
    expect(within(card).getByText("Missing Domain, Skill")).toBeInTheDocument();
    expect(within(card).getByText("Incomplete")).toBeInTheDocument();
    fireEvent.click(card);
    expect(props.onSelectQuestion).toHaveBeenCalledWith("c", "domain");
  });

  it("adds a question and explains why it cannot when the module is full", () => {
    const full = moduleWith([summary("a"), summary("b")], 2);
    const { props, rerender } = renderStack({}, full);
    const add = screen.getByRole("button", { name: "Add question" });
    expect(add).toBeDisabled();
    expect(screen.getByText("Module 1 has all 2 questions. Delete one to add another.")).toBeInTheDocument();
    rerender(<QuestionCardStack {...props} module={moduleWith([summary("a")], 2)} />);
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(props.onAddQuestion).toHaveBeenCalledOnce();
  });

  it("blocks Add while another structural change is running", () => {
    renderStack({ isMutating: true });
    expect(screen.getByRole("button", { name: "Add question" })).toBeDisabled();
  });

  it("shows the module switcher only when the outline rail does not carry it", () => {
    const { rerender, props } = renderStack({ showModuleSwitcher: true });
    expect(screen.getByRole("tablist", { name: "Math modules" })).toBeInTheDocument();
    rerender(<QuestionCardStack {...props} showModuleSwitcher={false} />);
    expect(screen.queryByRole("tablist", { name: "Math modules" })).not.toBeInTheDocument();
  });

  it("toggles the optional outline and reports its state", () => {
    const onToggleOutline = vi.fn();
    renderStack({ outlineOpen: false, onToggleOutline });
    const toggle = screen.getByRole("button", { name: "Question outline" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(onToggleOutline).toHaveBeenCalledOnce();
  });

  it("explains an empty module instead of rendering an empty list", () => {
    renderStack({ selectedQuestionId: null }, moduleWith([], 3));
    expect(screen.getByText("No questions in Module 1 yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Questions in this module" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add question" })).toBeEnabled();
  });

  it("walks the summary cards with Arrow Up and Down, stopping at the ends", () => {
    renderStack({ selectedQuestionId: null });
    const [first, second, third] = screen.getAllByRole("button", { name: /^Question \d\. / });
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second!, { key: "ArrowDown" });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third!, { key: "ArrowDown" });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third!, { key: "ArrowUp" });
    expect(second).toHaveFocus();
  });

  it("brings a newly chosen card into view, but never scrolls on first render", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { props, rerender } = renderStack();
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<QuestionCardStack {...props} selectedQuestionId="b" />);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  });
});
