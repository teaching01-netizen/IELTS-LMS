import { fireEvent, render, screen } from "@testing-library/react";
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

function view(issues: Parameters<typeof SpineQuestionView>[0]["issues"] = []) {
  return (
    <SpineQuestionView
      question={revision()}
      questionNumber={1}
      saveStatus="saved"
      lastSavedAt={null}
      issues={issues}
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

describe("Question canvas", () => {
 it("uses content sections instead of stages and numbered cards",()=>{render(view());expect(screen.queryByRole("navigation",{name:/question stages/i})).not.toBeInTheDocument();expect(screen.getByRole("heading",{name:"Question",exact:true})).toBeInTheDocument();expect(screen.getByRole("button",{name:/add an explanation/i})).toBeInTheDocument();});
 it("shows existing blockers in readiness and routes their real field",()=>{render(view([{code:"b.1",path:"metadata.domain",message:"Choose the SAT domain",blocking:true}]));fireEvent.click(screen.getByRole("button",{name:/1 issue/i}));expect(screen.getByRole("menuitem",{name:/Choose the SAT domain/})).toBeInTheDocument();});
});
