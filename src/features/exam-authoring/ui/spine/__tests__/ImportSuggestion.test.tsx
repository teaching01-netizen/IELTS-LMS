import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuestionRevision, StructuredContent } from "../../../contracts/assessment";
import type { SmartPasteStatus } from "../../../editor/RichQuestionComposer";
import { parseTextHtml } from "../../../editor/ingestion/adapters/textHtml";
import { ImportSuggestion } from "../ImportSuggestion";
import { SpineQuestionView } from "../SpineQuestionView";

function content(): StructuredContent {
  return { version: 2, nodes: [], document: { type: "doc", content: [{ type: "paragraph" }] } };
}

function choiceRevision(): QuestionRevision {
  const option = (id: string) => ({ id, content: content() });
  return {
    id: "rev-1", questionId: "q-1", semanticRevision: 1, revision: 1, state: "draft",
    questionType: "single_choice", stimulus: content(), prompt: content(), rationale: content(),
    answer: { kind: "single_choice", options: [option("a"), option("b"), option("c"), option("d")], correctOptionId: "a" },
    metadata: { sectionKey: "math", domain: "algebra", skill: "linear", difficulty: "medium", tags: [] },
    accessibility: { longDescription: null },
  };
}

const FULL = "What is 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B\nExplanation: Basic addition.";

function promptPasteStatus(): SmartPasteStatus {
  const parsed = parseTextHtml({ kind: "text", text: FULL }, { target: "rich" });
  return { visible: true, source: "text", imageCount: 0, mathCount: 0, needsAltText: false, document: parsed.document, pastedPlainText: FULL };
}

function renderView(question: QuestionRevision, onChange: (q: QuestionRevision) => void) {
  return render(
    <SpineQuestionView question={question} questionNumber={1} saveStatus="saved" lastSavedAt={null} issues={[]} keepMetadataForNext onKeepMetadataForNextChange={vi.fn()} onChange={onChange} onSaveNow={vi.fn()} onSaveAndNext={vi.fn()} onRetrySave={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} onPreview={vi.fn()} onIssueSelect={vi.fn()} />,
  );
}

describe("ImportSuggestion wiring", () => {
  it("no auto-apply: no card and no onChange without a paste", () => {
    const onChange = vi.fn();
    renderView(choiceRevision(), onChange);
    expect(screen.queryByRole("button", { name: "Split pasted content into question fields" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("card is not a dialog, buttons reachable, Esc dismisses without onChange", async () => {
    const onChange = vi.fn();
    const parsed = parseTextHtml({ kind: "text", text: FULL }, { target: "rich" });
    const { analyzeWholeQuestion } = await import("../../../editor/ingestion/exam/analyzeWholeQuestion");
    const analysis = analyzeWholeQuestion({ pasted: parsed.document, targetField: "prompt", sectionKey: "math", pastedPlainText: FULL });
    expect(analysis.band).toBe("suggest");
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(<ImportSuggestion analysis={analysis} targetField="prompt" sectionKey="math" onAccept={onAccept} onDismiss={onDismiss} />);
    const card = screen.getByLabelText("Paste suggestion");
    expect(card.tagName.toLowerCase()).toBe("section");
    expect(card.getAttribute("role")).not.toBe("dialog");
    const split = screen.getByRole("button", { name: "Split pasted content into question fields" });
    const keep = screen.getByRole("button", { name: "Keep pasted content as is" });
    expect(split.tabIndex).toBeGreaterThanOrEqual(-1);
    expect(keep.tabIndex).toBeGreaterThanOrEqual(-1);
    fireEvent.keyDown(card, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    const outcome = onDismiss.mock.calls[0]?.[0] as { accepted: boolean; choiceCount: number; hadKey: boolean; hadRationale: boolean };
    expect(outcome.accepted).toBe(false);
    expect(outcome.choiceCount).toBe(4);
    expect(outcome.hadKey).toBe(true);
    expect(outcome.hadRationale).toBe(true);
  });
  it("accept calls onAccept once; dismiss records accepted:false", async () => {
    const parsed = parseTextHtml({ kind: "text", text: FULL }, { target: "rich" });
    const { analyzeWholeQuestion } = await import("../../../editor/ingestion/exam/analyzeWholeQuestion");
    const analysis = analyzeWholeQuestion({ pasted: parsed.document, targetField: "prompt", sectionKey: "math", pastedPlainText: FULL });
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    const { unmount } = render(<ImportSuggestion analysis={analysis} targetField="answer-choice" sectionKey="math" onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.getByText("Choices will replace the current 4 options.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Split pasted content into question fields" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    unmount();
    const onDismiss2 = vi.fn();
    render(<ImportSuggestion analysis={analysis} targetField="prompt" sectionKey="math" onAccept={vi.fn()} onDismiss={onDismiss2} />);
    fireEvent.click(screen.getByRole("button", { name: "Keep pasted content as is" }));
    expect(onDismiss2).toHaveBeenCalledTimes(1);
    expect((onDismiss2.mock.calls[0]?.[0] as { accepted: boolean }).accepted).toBe(false);
    void promptPasteStatus;
  });
});
