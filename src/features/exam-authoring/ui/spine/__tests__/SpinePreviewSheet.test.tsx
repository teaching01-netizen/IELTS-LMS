import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuestionRevision } from "../../../contracts/assessment";
import { SpinePreviewSheet } from "../SpinePreviewSheet";

vi.mock("../../../../exam-rendering/api/ExamQuestionRenderer", () => ({
  ExamQuestionRenderer: () => <div data-testid="delivery-renderer" />,
}));

function question(): QuestionRevision {
  return {
    id: "rev-1", questionId: "q-1", semanticRevision: 1, revision: 1, state: "draft",
    questionType: "single_choice",
    stimulus: { version: 2 as const, nodes: [], document: { type: "doc" as const } },
    prompt: { version: 2 as const, nodes: [], document: { type: "doc" as const } },
    answer: { kind: "single_choice" as const, options: [], correctOptionId: null },
    rationale: { version: 2 as const, nodes: [], document: { type: "doc" as const } },
    metadata: { sectionKey: "reading-writing", domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: { longDescription: null },
  };
}

describe("SpinePreviewSheet", () => {
  it("renders the delivery renderer when open with a question", () => {
    render(
      <SpinePreviewSheet
        open
        question={question()}
        onOpenChange={vi.fn()}
        onCaptureOpener={vi.fn()}
        onRestoreOpener={vi.fn()}
      />,
    );
    expect(screen.getByText("Student preview")).toBeInTheDocument();
    expect(screen.getByTestId("delivery-renderer")).toBeInTheDocument();
  });

  it("renders nothing actionable when closed", () => {
    render(
      <SpinePreviewSheet
        open={false}
        question={question()}
        onOpenChange={vi.fn()}
        onCaptureOpener={vi.fn()}
        onRestoreOpener={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("delivery-renderer")).not.toBeInTheDocument();
  });
});
