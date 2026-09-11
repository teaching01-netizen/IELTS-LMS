import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActScienceStimulus } from "../../types";
import {
  ActScienceQuestionBuilderPane,
  createActScienceBlock,
} from "../ActScienceQuestionBuilderPane";

describe("ActScienceQuestionBuilderPane", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("edits several questions under one stimulus with four choices and a skill category", () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-1",
      title: "Experiment 1",
      content: "<p>Data from an experiment.</p>",
      blocks: [createActScienceBlock("block-1")],
    };
    const onChange = vi.fn();

    const { rerender } = render(
      <ActScienceQuestionBuilderPane stimulus={stimulus} startNumber={1} onChange={onChange} />
    );

    expect(screen.getByText("Questions (1)")).toBeInTheDocument();
    expect(
      screen.getAllByRole("textbox", { name: /Option [A-D] text for question 1/i })
    ).toHaveLength(4);
    expect(screen.getByLabelText("Skill category for question 1")).toHaveValue(
      "interpretation_of_data"
    );

    fireEvent.change(screen.getByLabelText("Question 1 stem"), {
      target: { value: "What does the table show?" },
    });
    const stimulusWithStem = onChange.mock.lastCall?.[0] as ActScienceStimulus;
    rerender(
      <ActScienceQuestionBuilderPane
        stimulus={stimulusWithStem}
        startNumber={1}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText("Skill category for question 1"), {
      target: { value: "scientific_investigation" },
    });

    const latestStimulus = onChange.mock.lastCall?.[0] as ActScienceStimulus;
    expect(latestStimulus.blocks[0]?.questions?.[0]).toEqual(
      expect.objectContaining({
        stem: "What does the table show?",
        skillCategory: "scientific_investigation",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Add ACT Science question" }));
    const stimulusWithTwoQuestions = onChange.mock.lastCall?.[0] as ActScienceStimulus;
    expect(stimulusWithTwoQuestions.blocks[0]?.questions).toHaveLength(2);
  });

  it("edits an optional image URL for each ACT Science answer choice", () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-image-1",
      title: "Experiment with diagrams",
      content: "Compare the diagrams.",
      blocks: [createActScienceBlock("block-image-1")],
    };
    const onChange = vi.fn();

    render(
      <ActScienceQuestionBuilderPane stimulus={stimulus} startNumber={1} onChange={onChange} />
    );

    const imageUrl = "https://example.test/act-option-a.png";
    fireEvent.change(screen.getByLabelText("Option A image URL for question 1"), {
      target: { value: imageUrl },
    });

    const latestStimulus = onChange.mock.lastCall?.[0] as ActScienceStimulus;
    expect(latestStimulus.blocks[0]?.questions?.[0]?.options[0]).toEqual(
      expect.objectContaining({ imageUrl })
    );
  });

  it("uses URL input only and previews Google Drive images like IELTS", async () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-url-preview-1",
      title: "Experiment with linked diagrams",
      content: "Compare the diagrams.",
      blocks: [createActScienceBlock("block-url-preview-1")],
    };
    const driveUrl = "https://drive.google.com/file/d/1AbCDefG123456/view?usp=sharing";
    const question = stimulus.blocks[0]?.questions?.[0];
    if (!question) throw new Error("Expected an ACT Science question");
    question.imageUrl = driveUrl;
    question.options[0] = { ...question.options[0], imageUrl: driveUrl };

    render(
      <ActScienceQuestionBuilderPane stimulus={stimulus} startNumber={1} onChange={vi.fn()} />
    );

    expect(screen.queryByText("Upload image")).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
    expect(screen.getByAltText("Question 1 stem preview")).toHaveAttribute(
      "src",
      "https://drive.google.com/thumbnail?id=1AbCDefG123456&sz=w2000"
    );
    expect(screen.getByAltText("Option A preview")).toHaveAttribute(
      "src",
      "https://drive.google.com/thumbnail?id=1AbCDefG123456&sz=w2000"
    );

    fireEvent.error(screen.getByAltText("Question 1 stem preview"));
    await waitFor(() =>
      expect(screen.getByAltText("Question 1 stem preview")).toHaveAttribute(
        "src",
        "https://lh3.googleusercontent.com/d/1AbCDefG123456=s2000"
      )
    );
  });
});
