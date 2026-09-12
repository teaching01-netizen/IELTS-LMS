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

describe("StageJumpExpands — collapse never strands a focus target", () => {
  it("reveals empty explanation and keeps it mounted after one-shot focus clears", () => {
    window.localStorage.clear();
    const onIssueSelect = vi.fn();
    const props = {
      question:revision(),saveStatus:"saved" as const,lastSavedAt:null,issues:[],keepMetadataForNext:true,
      onKeepMetadataForNextChange:vi.fn(),onChange:vi.fn(),onSaveNow:vi.fn(),onSaveAndNext:vi.fn(),onRetrySave:vi.fn(),onDuplicate:vi.fn(),onDelete:vi.fn(),onPreview:vi.fn(),onIssueSelect,
    };
    const {rerender}=render(<SpineQuestionView {...props} focusField="rationale"/>);
    expect(screen.getByRole("textbox",{name:"Question explanation"})).toBeInTheDocument();
    rerender(<SpineQuestionView {...props} focusField={null}/>);
    expect(screen.getByRole("textbox",{name:"Question explanation"})).toBeInTheDocument();
    rerender(<SpineQuestionView {...props} question={{...revision(),id:"rev-2"}} focusField={null}/>);
    expect(screen.queryByRole("textbox",{name:"Question explanation"})).not.toBeInTheDocument();
  });
});
