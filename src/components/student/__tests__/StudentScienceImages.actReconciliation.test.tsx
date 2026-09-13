/**
 * Phase 04 ACT reconciliation — student runtime image rendering (AT-06).
 *
 * Covers the Phase 04 scope items the plan assigns to the student runtime:
 * question-level SingleMCQQuestion.imageUrl and choice-level MCQOption.imageUrl
 * render via Drive-tolerant candidates (getImageUrlCandidates), unsafe schemes
 * mount nothing, broken URLs keep answer controls mounted, and stimulus image
 * srcs resolve through the same Drive-tolerant path.
 *
 * No SAT/IELTS behavior is touched: these tests mount QuestionRenderer with
 * SINGLE_MCQ blocks and StudentScience with a minimal ACT ExamState only.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionRenderer } from "../QuestionRenderer";
import { StudentScience } from "../StudentScience";
import type { ExamState, SingleMCQBlock } from "../../../types";

function singleMcqBlock(): SingleMCQBlock {
  return {
    id: "sci-block-1",
    type: "SINGLE_MCQ",
    instruction: "Use the figure to answer.",
    stem: "Block fallback stem",
    options: [],
    questions: [
      {
        id: "sci-q1",
        stem: "Which trend does the chart show?",
        imageUrl: "https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing",
        options: [
          { id: "opt-a", text: "Rises", isCorrect: true, imageUrl: "/opt-a.png" },
          { id: "opt-b", text: "Falls", isCorrect: false },
        ],
      },
    ],
  };
}

describe("Phase 04 ACT science runtime images", () => {
  it("renders question-level imageUrl through Drive-tolerant candidates", () => {
    const block = singleMcqBlock();
    render(
      <QuestionRenderer
        question={block.questions![0]!}
        block={block}
        number={1}
        answer=""
        onChange={() => {}}
      />,
    );
    const figure = screen.getByAltText("Question 1 figure");
    expect(figure).toBeInTheDocument();
    // Drive share link normalizes to the thumbnail endpoint first.
    expect(figure.getAttribute("src")).toContain("drive.google.com/thumbnail?id=1AbCDefG123456");
  });

  it("renders choice-level imageUrl figures without removing answer controls", () => {
    const block = singleMcqBlock();
    const onChange = vi.fn();
    render(
      <QuestionRenderer
        question={block.questions![0]!}
        block={block}
        number={1}
        answer=""
        onChange={onChange}
      />,
    );
    expect(screen.getByAltText("Option A figure")).toHaveAttribute("src", "/opt-a.png");
    // Option B has no image: exactly one option figure mounts.
    expect(screen.queryByAltText("Option B figure")).not.toBeInTheDocument();
    // Answer controls stay mounted and functional.
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    fireEvent.click(radios[0]!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onChange).mock.calls[0]![0]).toBe("opt-a");
  });

  it("mounts no image for unsafe question/choice schemes (XSS-safe)", () => {
    const block = singleMcqBlock();
    block.questions![0]!.imageUrl = "javascript:alert(1)";
    block.questions![0]!.options[0]!.imageUrl = "data:text/html,<script>alert(1)</script>";
    render(
      <QuestionRenderer
        question={block.questions![0]!}
        block={block}
        number={1}
        answer=""
        onChange={() => {}}
      />,
    );
    expect(screen.queryByAltText("Question 1 figure")).not.toBeInTheDocument();
    expect(screen.queryByAltText("Option A figure")).not.toBeInTheDocument();
    // Controls still work with no images mounted.
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("keeps answer controls mounted when images fail to load", () => {
    const block = singleMcqBlock();
    block.questions![0]!.imageUrl = "/missing-question.png";
    const onChange = vi.fn();
    render(
      <QuestionRenderer
        question={block.questions![0]!}
        block={block}
        number={1}
        answer=""
        onChange={onChange}
      />,
    );
    const figure = screen.getByAltText("Question 1 figure");
    fireEvent.error(figure);
    // Single-candidate source: no fallback to swap to, but controls survive.
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    fireEvent.click(radios[1]!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onChange).mock.calls[0]![0]).toBe("opt-b");
  });

  it("resolves stimulus image srcs through Drive-tolerant candidates", () => {
    const block = singleMcqBlock();
    const state = {
      type: "ACT",
      activeModule: "science",
      activeScienceStimulusId: "stim-1",
      config: { sections: { science: { enabled: true } } },
      science: {
        stimuli: [
          {
            id: "stim-1",
            title: "Growth experiment",
            content: "Plants under lamps.",
            blocks: [block],
            images: [
              {
                id: "img-1",
                alt: "Growth chart",
                annotations: [],
                crop: { x: 0, y: 0, width: 800, height: 600 },
                height: 600,
                src: "https://drive.google.com/file/d/IMGID999/view?usp=sharing",
                width: 800,
                zoom: 1,
              },
            ],
          },
        ],
      },
    } as unknown as ExamState;
    render(
      <StudentScience
        state={state}
        answers={{}}
        onAnswerChange={() => {}}
        currentQuestionId="sci-q1"
        onNavigate={() => {}}
      />,
    );
    const stimulus = screen.getByAltText("Growth chart");
    expect(stimulus.getAttribute("src")).toContain("drive.google.com/thumbnail?id=IMGID999");
  });
});
