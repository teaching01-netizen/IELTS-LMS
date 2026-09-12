import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ValidationChecklist } from "../ValidationChecklist";
import { ClassificationFieldset } from "../ClassificationFieldset";
import { ReleaseGateCard } from "../ReleaseGateCard";
import { SpineSaveFooter } from "../SpineSaveFooter";
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

describe("SpineCard — single card truth", () => {
  it("renders ValidationChecklist on the canonical spine card", () => {
    render(<ValidationChecklist issues={[]} onIssueSelect={vi.fn()} />);
    const card = screen.getByRole("region", { name: "Validation" });
    expect(card.className).toContain("spine-card");
  });

  it("renders ClassificationFieldset on the canonical spine card", () => {
    const { container } = render(
      <ClassificationFieldset question={revision()} onChange={vi.fn()} issues={[]} />,
    );
    expect(container.querySelector("fieldset")?.className).not.toContain("spine-card");
  });

  it("renders ReleaseGateCard on the canonical spine card", () => {
    render(
      <ReleaseGateCard
        readinessFresh
        readinessValid
        dirtyCount={0}
        isPublishing={false}
        blockerCount={0}
        releaseHref="/sat/exams/e/release"
        onOpenRelease={vi.fn()}
      />,
    );
    expect(screen.getByRole("region", { name: "Release readiness" }).className).toContain(
      "spine-card",
    );
  });

  it("renders SpineSaveFooter on the canonical spine card", () => {
    const { container } = render(
      <SpineSaveFooter
        status="saved"
        lastSavedAt={null}
        keepMetadataForNext
        saveDisabled={false}
        onKeepMetadataForNextChange={vi.fn()}
        onSaveAndNext={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(container.firstElementChild?.className).not.toContain("spine-card");
    expect(container.firstElementChild?.className).toContain("sat-spine__save-footer");
  });
});
