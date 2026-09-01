import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuestionRevision } from "../../contracts/assessment";
import { QuestionQuickPreview } from "../QuestionQuickPreview";

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
  stimulus: content("stimulus", "A short passage."),
  prompt: content("prompt", "What is the answer?"),
  answer: {
    kind: "single_choice",
    options: [
      { id: "A", content: content("a", "First") },
      { id: "B", content: content("b", "Second") },
    ],
    correctOptionId: "B",
  },
  rationale: content("rationale", "Because the second choice is supported."),
  metadata: {
    sectionKey: "reading-writing",
    domain: null,
    skill: null,
    difficulty: "medium",
    tags: [],
  },
  accessibility: { longDescription: null },
};

describe("QuestionQuickPreview", () => {
  it("exposes a responsive preview surface without a fixed inner width", () => {
    render(<QuestionQuickPreview open question={question} onClose={vi.fn()} />);

    const preview = screen.getByRole("complementary", { name: "Student question preview" });
    expect(preview).toHaveClass("authoring-question-preview");
    expect(preview.firstElementChild).toHaveClass("authoring-question-preview__inner");
  });
});
