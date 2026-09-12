import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpineQuestionView } from "../SpineQuestionView";
import type { QuestionRevision, StructuredContent } from "../../../contracts/assessment";

function content(): StructuredContent {
  return { version: 2, nodes: [], document: { type: "doc", content: [{ type: "paragraph" }] } };
}

function choiceRevision(): QuestionRevision {
  const option = (id: string) => ({ id, content: content() });
  return {
    id: "rev-1", questionId: "q-1", semanticRevision: 1, revision: 1, state: "draft",
    questionType: "single_choice", stimulus: content(), prompt: content(), rationale: content(),
    answer: { kind: "single_choice", options: [option("a"), option("b"), option("c"), option("d")], correctOptionId: "b" },
    metadata: { sectionKey: "reading-writing", domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: { longDescription: null },
  };
}

function renderView(question: QuestionRevision, onChange: (q: QuestionRevision) => void) {
  render(
    <SpineQuestionView question={question} questionNumber={1} saveStatus="saved" lastSavedAt={null} issues={[]} keepMetadataForNext onKeepMetadataForNextChange={vi.fn()} onChange={onChange} onSaveNow={vi.fn()} onSaveAndNext={vi.fn()} onRetrySave={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onPreview={vi.fn()} onIssueSelect={vi.fn()} />
  );
}

describe("AnswerKeyField identity-safe reorder", () => {
  it("moves a choice by stable id and keeps the key on the same content", () => {
    let current = choiceRevision();
    const onChange = vi.fn((next: QuestionRevision) => { current = next; });
    const { rerender } = render(
      <SpineQuestionView question={current} questionNumber={1} saveStatus="saved" lastSavedAt={null} issues={[]} keepMetadataForNext onKeepMetadataForNextChange={vi.fn()} onChange={onChange} onSaveNow={vi.fn()} onSaveAndNext={vi.fn()} onRetrySave={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onPreview={vi.fn()} onIssueSelect={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Move choice B later" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const moved = onChange.mock.calls[0][0] as QuestionRevision;
    if (moved.answer.kind !== "single_choice") throw new Error("expected single_choice");
    expect(moved.answer.options.map((o) => o.id)).toEqual(["a", "c", "b", "d"]);
    expect(moved.answer.correctOptionId).toBe("b");
    rerender(
      <SpineQuestionView question={moved} questionNumber={1} saveStatus="saved" lastSavedAt={null} issues={[]} keepMetadataForNext onKeepMetadataForNextChange={vi.fn()} onChange={onChange} onSaveNow={vi.fn()} onSaveAndNext={vi.fn()} onRetrySave={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onPreview={vi.fn()} onIssueSelect={vi.fn()} />
    );
    expect(screen.getByRole("radio", { name: /correct answer, key/ })).toHaveAttribute("aria-label", expect.stringContaining("Choice C"));
  });

  it("asks before replacing existing supporting material", () => {
    const onChange = vi.fn();
    const filled = { ...choiceRevision(), stimulus: content() };
    (filled.stimulus.document as { content: object[] }).content = [{ type: "paragraph", content: [{ type: "text", text: "existing passage" }] }];
    renderView(filled, onChange);
    fireEvent.change(screen.getByRole("combobox", {name:"Supporting material type"}),{target:{value:"data_table"}});
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/replaces the current passage/i);
    fireEvent.click(screen.getByRole("button", { name: "Replace material" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
