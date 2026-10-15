import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { QuestionRevision } from "../../../exam-rendering/api/assessmentContracts";
import { plainContentFromText } from "../../../exam-authoring/editor/richContent";
import { SatQuestionPreview } from "../SatQuestionPreview";

const question: QuestionRevision = {
  id: "revision", questionId: "question", semanticRevision: 1, revision: 1, state: "draft",
  questionType: "single_choice", stimulus: plainContentFromText(""),
  prompt: plainContentFromText("Choose a value."),
  answer: { kind: "single_choice", correctOptionId: "B", options: ["A", "B", "C", "D"].map((id) => ({ id, content: plainContentFromText(`Choice ${id}`) })) },
  rationale: plainContentFromText("Private scoring explanation"),
  metadata: { sectionKey: "reading-writing", domain: null, skill: "Private classification", difficulty: "medium", tags: [] },
  accessibility: { longDescription: null },
};

describe("SAT read-only question preview", () => {
  it("shows unanswered disabled choices without exposing the key, rationale, or staff metadata", () => {
    render(<SatQuestionPreview question={question} questionNumber={7} />);
    expect(screen.getByRole("region", { name: "Student preview" })).toHaveClass("sat-ui");
    for (const input of screen.getAllByRole("radio")) {
      expect(input).toBeDisabled();
      expect(input).not.toBeChecked();
    }
    expect(screen.getByText("Choose a value.")).toBeInTheDocument();
    expect(screen.getByText("Read-only student preview. Answers are unavailable here.")).toBeInTheDocument();
    expect(screen.queryByText(/Private|paused by the proctor/)).not.toBeInTheDocument();
  });

  it("shows an empty disabled numeric input without the accepted responses", () => {
    const numeric: QuestionRevision = {
      ...question,
      questionType: "student_produced_response",
      answer: { kind: "student_produced_response", acceptedResponses: ["90001"], normalizeFraction: true, normalizeDecimal: true, numericTolerance: null },
      metadata: { ...question.metadata, sectionKey: "math" },
    };
    render(<SatQuestionPreview question={numeric} questionNumber={1} />);
    const input = screen.getByRole("textbox", { name: "Enter your answer" });
    expect(input).toBeDisabled();
    expect(input).toHaveValue("");
    expect(screen.queryByText("90001")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("uses the actual supporting pane for either section and removes it when Stimulus is empty", () => {
    const stimulus = plainContentFromText("Supporting text");
    const { rerender, container } = render(<SatQuestionPreview question={{ ...question, stimulus }} questionNumber={1} />);
    expect(screen.getByLabelText("Passage")).toHaveTextContent("Supporting text");
    rerender(<SatQuestionPreview question={{ ...question, stimulus, metadata: { ...question.metadata, sectionKey: "math" } }} questionNumber={1} />);
    expect(screen.getByLabelText("Supporting material")).toHaveTextContent("Supporting text");
    expect(screen.queryByLabelText("Passage")).not.toBeInTheDocument();
    rerender(<SatQuestionPreview question={question} questionNumber={1} />);
    expect(screen.queryByLabelText("Supporting material")).not.toBeInTheDocument();
    expect(container.querySelector("[data-sat-reading-layout]")).toHaveAttribute("data-sat-reading-layout", "single");
  });
});
