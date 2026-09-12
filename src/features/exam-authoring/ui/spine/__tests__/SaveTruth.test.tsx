import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpineQuestionView } from "../SpineQuestionView";
import type { QuestionRevision } from "../../../contracts/assessment";

function revision(): QuestionRevision {
  const content = { version: 2 as const, nodes: [], document: { type: "doc" as const, content: [{ type: "paragraph" as const }] } };
  return {
    id: "rev-1",
    revision: 1,
    semanticRevision: 1,
    questionType: "single_choice",
    stimulus: content,
    prompt: content,
    rationale: content,
    answer: { kind: "single_choice", options: [], correctOptionId: null },
    metadata: { sectionKey: "reading-writing", domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: { altText: null, extendedTime: false },
  };
}

function view() {
  return (
    <SpineQuestionView
      question={revision()}
      questionNumber={1}
      saveStatus="saved"
      lastSavedAt={null}
      issues={[]}
      keepMetadataForNext
      onKeepMetadataForNextChange={vi.fn()}
      onChange={vi.fn()}
      onSaveNow={vi.fn()}
      onSaveAndNext={vi.fn()}
      onRetrySave={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      onPreview={vi.fn()}
      onIssueSelect={vi.fn()}
    />
  );
}

describe("SaveTruth — one save vocabulary per question", () => {
  it("renders exactly one save status region per question view", () => {
    render(view());
    const saved = screen.getAllByText("Saved", { selector: "span" });
    // Header slot renders in the workspace; the question view owns exactly
    // one: no duplicated SaveCluster text competing with the footer truth.
    expect(saved).toHaveLength(1);
  });
});
