import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuestionRevision } from "../../../contracts/assessment";
import { AnswerKeyField } from "../AnswerKeyField";

const content = (id: string, text: string) => ({
  version: 1 as const,
  nodes: [{ type: "paragraph" as const, id, text }],
});

// FastQuestionComposer mounts TipTap; stub it to a labelled textbox so the key
// selection contract (radiogroup + 44px targets + Key text) is tested in isolation.
vi.mock("../../../editor/FastQuestionComposer", () => ({
  FastQuestionComposer: ({ label, value }: { label: string; value: { nodes: { text: string }[] } }) => (
    <input aria-label={label} defaultValue={value.nodes[0]?.text ?? ""} />
  ),
}));

function mcq(correctOptionId: string | null = "B"): QuestionRevision {
  return {
    id: "revision-1",
    questionId: "question-1",
    semanticRevision: 1,
    revision: 1,
    state: "draft",
    questionType: "single_choice",
    stimulus: content("stimulus", ""),
    prompt: content("prompt", "Prompt"),
    answer: {
      kind: "single_choice",
      options: [
        { id: "A", content: content("a", "First") },
        { id: "B", content: content("b", "Second") },
        { id: "C", content: content("c", "Third") },
        { id: "D", content: content("d", "Fourth") },
      ],
      correctOptionId,
    },
    rationale: content("rationale", ""),
    metadata: { sectionKey: "reading-writing", domain: null, skill: null, difficulty: "medium", tags: [] },
    accessibility: { longDescription: null },
  };
}

describe("AnswerKeyField", () => {
  it("exposes the key as a radiogroup with an unmissable selected state", () => {
    render(<AnswerKeyField question={mcq()} onChange={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: /answer key/i });
    expect(group).toBeInTheDocument();
    const selected = screen.getByRole("radio", { name: /choice B.*correct answer.*key/i });
    expect(selected).toHaveAttribute("aria-checked", "true");
    // The "Key" badge is a sighted sibling (same row), not inside the radio:
    // unmissable at scan distance without polluting the accessible name twice.
    const row = selected.closest("[data-spine-key-row]");
    expect(row?.textContent).toMatch(/key/i);
    expect(screen.getByRole("radio", { name: /choice A/i })).toHaveAttribute("aria-checked", "false");
  });

  it("meets the 44px target floor on every key button", () => {
    // jsdom does not compute Tailwind arbitrary values; assert the contract
    // class is present so the 44px floor survives class refactors.
    render(<AnswerKeyField question={mcq()} onChange={vi.fn()} />);
    for (const letter of ["A", "B", "C", "D"]) {
      const radio = screen.getByRole("radio", { name: new RegExp(`choice ${letter}`, "i") });
      expect(radio.className).toContain("min-h-[44px]");
      expect(radio.className).toContain("min-w-[44px]");
    }
  });

  it("sets the key on click with the same payload shape as the legacy editor", () => {
    const onChange = vi.fn();
    render(<AnswerKeyField question={mcq("B")} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /choice C/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as QuestionRevision;
    if (next.answer.kind !== "single_choice") throw new Error("expected single_choice");
    expect(next.answer.correctOptionId).toBe("C");
    expect(next.answer.options).toHaveLength(4);
  });

  it("moves the key with arrow keys inside the radiogroup", () => {
    const onChange = vi.fn();
    render(<AnswerKeyField question={mcq("B")} onChange={onChange} />);
    const b = screen.getByRole("radio", { name: /choice B/i });
    b.focus();
    fireEvent.keyDown(b, { key: "ArrowDown" });
    const next = onChange.mock.calls[0]?.[0] as QuestionRevision;
    if (next.answer.kind !== "single_choice") throw new Error("expected single_choice");
    expect(next.answer.correctOptionId).toBe("C");
  });
});
