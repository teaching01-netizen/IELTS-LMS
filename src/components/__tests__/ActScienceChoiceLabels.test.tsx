import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ActScienceQuestionBuilderPane,
  createActScienceBlock,
  createActScienceQuestion,
} from "../ActScienceQuestionBuilderPane";
import { QuestionRenderer } from "../student/QuestionRenderer";
import type { ActScienceStimulus, SingleMCQBlock } from "../../types";
import { createInitialExamState, hydrateExamState } from "../../services/examAdapterService";
import { validateActScienceModule } from "../../utils/examUtils";

function buildStimulus(): ActScienceStimulus {
  const first = createActScienceQuestion("question-1");
  const second = { ...createActScienceQuestion("question-2"), stem: "Second question" };
  const block = createActScienceBlock("block-1");
  const questions = [first, second];
  return {
    id: "stimulus-1",
    title: "Stimulus",
    content: "A science passage.",
    blocks: [{ ...block, stem: first.stem, options: first.options, questions }],
    images: [],
    wordCount: 4,
  };
}

function BuilderHarness() {
  const [stimulus, setStimulus] = useState(buildStimulus);
  return <ActScienceQuestionBuilderPane stimulus={stimulus} onChange={setStimulus} />;
}

describe("ACT Science choice labels", () => {
  it("lets each question use its own answer-choice letters", () => {
    render(<BuilderHarness />);

    ["F", "G", "H", "J"].forEach((label, index) => {
      const name = "Choice label " + String(index + 1) + " for question 2";
      fireEvent.change(screen.getByRole("textbox", { name }), { target: { value: label } });
    });

    ["F", "G", "H", "J"].forEach((label, index) => {
      const name = "Choice label " + String(index + 1) + " for question 2";
      expect(screen.getByRole("textbox", { name })).toHaveValue(label);
    });
    expect(screen.getByRole("textbox", { name: "Choice label 1 for question 1" })).toHaveValue("A");
  });

  it("shows the saved custom letters to students while answers remain keyed by option id", () => {
    const base = createActScienceBlock("block-student");
    const questionOptions = createActScienceQuestion("question-options").options;
    const question = {
      ...createActScienceQuestion("question-student"),
      stem: "Choose the best answer.",
      options: questionOptions.map((option, index) => ({
        ...option,
        label: ["F", "G", "H", "J"][index],
      })),
    };
    const block: SingleMCQBlock = {
      ...base,
      stem: question.stem,
      options: question.options,
      questions: [question],
    };

    render(
      <QuestionRenderer
        question={question}
        block={block}
        number={1}
        answer={question.options[2]!.id}
        onChange={() => undefined}
      />
    );

    expect(screen.getByText("F.")).toBeInTheDocument();
    expect(screen.getByText("G.")).toBeInTheDocument();
    expect(screen.getByText("H.")).toBeInTheDocument();
    expect(screen.getByText("J.")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")[2]).toBeChecked();
  });

  it("keeps custom labels when ACT questions are hydrated from saved exam state", () => {
    const state = createInitialExamState("ACT labels", "ACT", "ACT Science");
    const base = createActScienceBlock("saved-block");
    const question = createActScienceQuestion("saved-question");
    const options = question.options.map((option, index) => ({
      ...option,
      label: ["F", "G", "H", "J"][index],
    }));
    const savedQuestion = { ...question, options };
    state.science.stimuli = [
      {
        id: "saved-stimulus",
        title: "Saved stimulus",
        content: "Read the results.",
        blocks: [{ ...base, stem: savedQuestion.stem, options, questions: [savedQuestion] }],
        images: [],
        wordCount: 3,
      },
    ];

    const hydrated = hydrateExamState(state);
    expect(
      hydrated.science.stimuli[0]?.blocks[0]?.questions?.[0]?.options.map((option) => option.label)
    ).toEqual(["F", "G", "H", "J"]);
  });

  it("rejects duplicate choice labels within one question", () => {
    const stimulus = buildStimulus();
    const block = stimulus.blocks[0]!;
    const question = block.questions![0]!;
    const duplicate = {
      ...question,
      options: question.options.map((option, index) => ({
        ...option,
        label: ["F", "F", "H", "J"][index],
      })),
    };
    stimulus.blocks[0] = {
      ...block,
      stem: duplicate.stem,
      options: duplicate.options,
      questions: [duplicate, ...block.questions!.slice(1)],
    };

    expect(
      validateActScienceModule([stimulus]).some((error) =>
        error.message.includes("choice labels must be unique")
      )
    ).toBe(true);
  });
});
