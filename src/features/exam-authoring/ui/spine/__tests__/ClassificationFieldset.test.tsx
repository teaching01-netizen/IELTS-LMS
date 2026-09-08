import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QuestionRevision } from "../../../contracts/assessment";
import { ClassificationFieldset } from "../ClassificationFieldset";

const content = (id: string, text: string) => ({
  version: 1 as const,
  nodes: [{ type: "paragraph" as const, id, text }],
});

function questionWith(metadata: Partial<QuestionRevision["metadata"]>): QuestionRevision {
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
      correctOptionId: "B",
    },
    rationale: content("rationale", ""),
    metadata: {
      sectionKey: "reading-writing",
      domain: null,
      skill: null,
      difficulty: "medium",
      tags: [],
      ...metadata,
    },
    accessibility: { longDescription: null },
  };
}

describe("ClassificationFieldset", () => {
  it("pairs every control with a visible label", () => {
    render(<ClassificationFieldset question={questionWith({})} onChange={vi.fn()} issues={[]} />);
    expect(screen.getByLabelText("Domain")).toBeInTheDocument();
    expect(screen.getByLabelText("Skill")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Difficulty" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tags")).toBeInTheDocument();
  });

  it("clears an incompatible skill when the domain changes", () => {
    const onChange = vi.fn();
    render(
      <ClassificationFieldset
        question={questionWith({ domain: "information-and-ideas", skill: "Inferences" })}
        onChange={onChange}
        issues={[]}
      />,
    );
    // NOTE: the reading-writing fixture has no "algebra" option, so drive the
    // incompatible change through a valid RW domain instead.
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "craft-and-structure" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as QuestionRevision;
    expect(next.metadata.domain).toBe("craft-and-structure");
    expect(next.metadata.skill).toBeNull();
  });

  it("keeps a compatible skill when the domain still contains it", () => {
    const onChange = vi.fn();
    render(
      <ClassificationFieldset
        question={questionWith({ domain: "information-and-ideas", skill: "Inferences" })}
        onChange={onChange}
        issues={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Domain"), { target: { value: "information-and-ideas" } });
    const next = onChange.mock.calls[0]?.[0] as QuestionRevision;
    expect(next.metadata.skill).toBe("Inferences");
  });

  it("surfaces blocking domain/skill issues inline with aria-describedby", () => {
    render(
      <ClassificationFieldset
        question={questionWith({})}
        onChange={vi.fn()}
        issues={[
          { code: "sat.metadata.domain.required", path: "metadata.domain", message: "Choose the SAT domain for this question.", blocking: true },
          { code: "sat.metadata.skill.required", path: "metadata.skill", message: "Choose the SAT skill for this question.", blocking: true },
        ]}
      />,
    );
    const domain = screen.getByLabelText("Domain");
    const skill = screen.getByLabelText("Skill");
    expect(domain).toHaveAttribute("aria-invalid", "true");
    expect(skill).toHaveAttribute("aria-invalid", "true");
    expect(domain.getAttribute("aria-describedby")).toContain("domain-error");
    expect(skill.getAttribute("aria-describedby")).toContain("skill-error");
    expect(screen.getByText("Choose the SAT domain for this question.")).toBeInTheDocument();
    expect(screen.getByText("Choose the SAT skill for this question.")).toBeInTheDocument();
  });
});
