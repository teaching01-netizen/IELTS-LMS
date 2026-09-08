import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AssessmentQuestionSummary } from "../../../contracts/assessment";
import { QuestionJumpPalette } from "../QuestionJumpPalette";

function summary(id: string, index: number, promptPreview: string): AssessmentQuestionSummary {
  return {
    examQuestionId: id,
    questionId: `${id}-base`,
    questionRevisionId: `${id}-rev`,
    displayOrder: index,
    isPretest: false,
    questionType: "single_choice",
    semanticRevision: 1,
    revision: 1,
    promptPreview,
    answerKeyPreview: "A",
    domain: "algebra",
    skill: "Linear equations",
    difficulty: "medium",
    tags: [],
    hasStimulus: false,
    contentComplexity: "plain",
    readiness: { status: "ready", blockingIssueCount: 0, warningCount: 0 },
  };
}

const questions = [
  summary("q-1", 0, "Solve the linear equation"),
  summary("q-2", 1, "Find the area of the circle"),
];

describe("QuestionJumpPalette", () => {
  it("filters with shared queue search semantics and selects flush-guarded", () => {
    const onSelect = vi.fn();
    render(
      <QuestionJumpPalette
        open
        questions={questions}
        selectedQuestionId="q-1"
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByRole("combobox", { name: /jump to question/i });
    fireEvent.change(input, { target: { value: "circle" } });
    expect(screen.getByRole("option", { name: /find the area/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /linear equation/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /find the area/i }));
    expect(onSelect).toHaveBeenCalledWith("q-2");
  });

  it("announces the current question", () => {
    render(
      <QuestionJumpPalette
        open
        questions={questions}
        selectedQuestionId="q-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: /current$/i })).toHaveTextContent(/solve the linear/i);
  });
});
