import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuestionRevision } from "../../contracts/assessment";
import { QuestionEditor } from "../QuestionEditor";

vi.mock("../../editor/FastQuestionComposer", () => ({
  FastQuestionComposer: ({ label }: { label: string }) => (
    <div role="textbox" aria-label={label} />
  ),
}));

const content = (id: string, text: string) => ({
  version: 1 as const,
  nodes: [{ type: "paragraph" as const, id, text }],
});

const question: QuestionRevision = {
  id: "revision-1",
  questionId: "question-1",
  semanticRevision: 1,
  revision: 1,
  state: "draft",
  questionType: "single_choice",
  stimulus: { version: 1, nodes: [] },
  prompt: content("prompt", "What is the answer?"),
  answer: {
    kind: "single_choice",
    options: [
      { id: "A", content: content("a", "First") },
      { id: "B", content: content("b", "Second") },
      { id: "C", content: content("c", "Third") },
      { id: "D", content: content("d", "Fourth") },
    ],
    correctOptionId: "A",
  },
  rationale: content("rationale", "The first choice is supported."),
  metadata: {
    sectionKey: "math",
    domain: "algebra",
    skill: "Linear equations",
    difficulty: "medium",
    tags: [],
  },
  accessibility: { longDescription: null },
};

describe("QuestionEditor response type changes", () => {
  it("confirms before discarding the current answer when changing response type", () => {
    const onChange = vi.fn();
    render(
      <QuestionEditor
        question={question}
        saveStatus="saved"
        onChange={onChange}
        onSaveNow={vi.fn()}
        onSaveAndNext={vi.fn()}
        keepMetadataForNext
        onKeepMetadataForNextChange={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Student response" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Change response type?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change response type" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        questionType: "student_produced_response",
        answer: expect.objectContaining({ kind: "student_produced_response" }),
      }),
    );
  });
});
