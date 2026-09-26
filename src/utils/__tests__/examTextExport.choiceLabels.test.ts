import { describe, expect, it } from "vitest";
import { createInitialExamState } from "../../services/examAdapterService";
import type { Exam, SingleMCQBlock } from "../../types";
import { buildExamTextExport } from "../examTextExport";

describe("exam text export choice labels", () => {
  it("prints custom labels beside options and the correct answer", () => {
    const state = createInitialExamState("ACT Choice Labels", "Academic", "Academic");
    const block: SingleMCQBlock = {
      id: "choice-label-block",
      type: "SINGLE_MCQ",
      instruction: "Choose one answer.",
      stem: "Select the second choice.",
      options: [
        { id: "choice-f", label: "F", text: "First choice", isCorrect: false },
        { id: "choice-g", label: "G", text: "Correct choice", isCorrect: true },
      ],
    };
    state.reading.passages = [
      {
        id: "passage-choice-labels",
        title: "Passage",
        content: "Text",
        blocks: [block],
        images: [],
        wordCount: 1,
      },
    ];
    const exam: Exam = {
      id: "exam-choice-labels",
      title: "ACT Choice Labels",
      type: "Academic",
      status: "Draft",
      author: "Teacher",
      lastModified: "2026-09-26T00:00:00.000Z",
      createdAt: "2026-09-26T00:00:00.000Z",
      content: state,
    };

    const output = buildExamTextExport([exam], new Date("2026-09-26T00:00:00.000Z"));

    expect(output).toContain("F. First choice");
    expect(output).toContain("G. Correct choice");
  });
});
