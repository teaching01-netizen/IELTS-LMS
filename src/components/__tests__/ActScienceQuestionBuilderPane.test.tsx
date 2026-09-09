import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("uploads an image file for an ACT Science answer choice", async () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-upload-1",
      title: "Experiment with uploaded diagrams",
      content: "Compare the diagrams.",
      blocks: [createActScienceBlock("block-upload-1")],
    };
    const onChange = vi.fn();
    const uploadChoiceImage = vi.fn().mockResolvedValue("https://media.example/option-a.png");

    render(
      <ActScienceQuestionBuilderPane
        stimulus={stimulus}
        startNumber={1}
        onChange={onChange}
        uploadChoiceImage={uploadChoiceImage}
      />
    );

    const file = new File(["fake-image"], "option-a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload image for option A question 1"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(uploadChoiceImage).toHaveBeenCalledWith(file, expect.any(String)));
    await waitFor(() => {
      const latestStimulus = onChange.mock.lastCall?.[0] as ActScienceStimulus;
      expect(latestStimulus.blocks[0]?.questions?.[0]?.options[0]?.imageUrl).toBe(
        "https://media.example/option-a.png"
      );
    });
  });

  it("uploads an image file for an ACT Science question stem", async () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-question-image-1",
      title: "Experiment with a question diagram",
      content: "Use the diagram to answer the question.",
      blocks: [createActScienceBlock("block-question-image-1")],
    };
    const onChange = vi.fn();
    const uploadQuestionImage = vi.fn().mockResolvedValue("https://media.example/question.png");

    render(
      <ActScienceQuestionBuilderPane
        stimulus={stimulus}
        startNumber={1}
        onChange={onChange}
        uploadQuestionImage={uploadQuestionImage}
      />
    );

    const file = new File(["fake-image"], "question.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload image for question 1 stem"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(uploadQuestionImage).toHaveBeenCalledWith(file, expect.any(String)));
    await waitFor(() => {
      const latestStimulus = onChange.mock.lastCall?.[0] as ActScienceStimulus;
      expect(latestStimulus.blocks[0]?.questions?.[0]?.imageUrl).toBe(
        "https://media.example/question.png"
      );
    });
  });

  it("releases the hidden question-image input focus after a file is selected", async () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-question-image-focus-1",
      title: "Experiment with a question diagram",
      content: "Use the diagram to answer the question.",
      blocks: [createActScienceBlock("block-question-image-focus-1")],
    };
    const uploadQuestionImage = vi.fn().mockResolvedValue("https://media.example/question.png");

    render(
      <ActScienceQuestionBuilderPane
        stimulus={stimulus}
        startNumber={1}
        onChange={vi.fn()}
        uploadQuestionImage={uploadQuestionImage}
      />
    );

    const input = screen.getByLabelText("Upload image for question 1 stem");
    const file = new File(["fake-image"], "question.png", { type: "image/png" });
    const scrollTo = vi.mocked(window.scrollTo);
    input.focus();
    expect(input).toHaveFocus();
    expect(input).toHaveClass("fixed", "left-0", "top-0");
    expect(input).not.toHaveClass("sr-only");

    fireEvent.change(input, { target: { files: [file] } });

    expect(input).not.toHaveFocus();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    await waitFor(() => expect(uploadQuestionImage).toHaveBeenCalled());
  });

  it("releases the hidden choice-image input focus without moving the document viewport", async () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-choice-image-focus-1",
      title: "Experiment with a choice diagram",
      content: "Use the diagram to answer the question.",
      blocks: [createActScienceBlock("block-choice-image-focus-1")],
    };
    const uploadChoiceImage = vi.fn().mockResolvedValue("https://media.example/choice.png");
    const scrollTo = vi.mocked(window.scrollTo);

    render(
      <ActScienceQuestionBuilderPane
        stimulus={stimulus}
        startNumber={1}
        onChange={vi.fn()}
        uploadChoiceImage={uploadChoiceImage}
      />
    );

    const input = screen.getByLabelText("Upload image for option A question 1");
    const file = new File(["fake-image"], "choice.png", { type: "image/png" });
    input.focus();
    expect(input).toHaveFocus();
    expect(input).toHaveClass("fixed", "left-0", "top-0");
    expect(input).not.toHaveClass("sr-only");

    fireEvent.change(input, { target: { files: [file] } });

    expect(input).not.toHaveFocus();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    await waitFor(() => expect(uploadChoiceImage).toHaveBeenCalled());
  });

  it("keeps long backend upload diagnostics collapsed until the author requests them", async () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-question-upload-error-1",
      title: "Experiment with a missing media bucket",
      content: "Use the diagram to answer the question.",
      blocks: [createActScienceBlock("block-question-upload-error-1")],
    };
    const longBackendError =
      "Image upload failed with status 502: media storage operation failed: " +
      "NoSuchBucket ".repeat(40);
    const uploadQuestionImage = vi.fn().mockRejectedValue(new Error(longBackendError));

    render(
      <ActScienceQuestionBuilderPane
        stimulus={stimulus}
        startNumber={1}
        onChange={vi.fn()}
        uploadQuestionImage={uploadQuestionImage}
      />
    );

    const file = new File(["fake-image"], "question.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload image for question 1 stem"), {
      target: { files: [file] },
    });

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("Image upload failed (502). See technical details.")
    ).toBeVisible();

    const disclosure = within(alert).getByText("Technical details").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure?.querySelector("p")?.textContent).toBe(longBackendError);

    fireEvent.click(within(alert).getByText("Technical details"));
    expect(disclosure).toHaveAttribute("open");
  });

  it("keeps long answer-choice upload diagnostics collapsed too", async () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-choice-upload-error-1",
      title: "Experiment with a missing media bucket",
      content: "Compare the diagrams.",
      blocks: [createActScienceBlock("block-choice-upload-error-1")],
    };
    const longBackendError =
      "Image upload failed with status 502: media storage operation failed: " +
      "NoSuchBucket ".repeat(40);
    const uploadChoiceImage = vi.fn().mockRejectedValue(new Error(longBackendError));

    render(
      <ActScienceQuestionBuilderPane
        stimulus={stimulus}
        startNumber={1}
        onChange={vi.fn()}
        uploadChoiceImage={uploadChoiceImage}
      />
    );

    const file = new File(["fake-image"], "option-a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload image for option A question 1"), {
      target: { files: [file] },
    });

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("Image upload failed (502). See technical details.")
    ).toBeVisible();
    expect(within(alert).getByText("Technical details").closest("details")).not.toHaveAttribute(
      "open"
    );
  });

  it("previews and removes an uploaded ACT Science answer-choice image", async () => {
    const stimulus: ActScienceStimulus = {
      id: "stimulus-remove-image-1",
      title: "Experiment with removable diagrams",
      content: "Compare the diagrams.",
      blocks: [createActScienceBlock("block-remove-image-1")],
    };
    const onChange = vi.fn();
    const uploadChoiceImage = vi.fn().mockResolvedValue("https://media.example/option-b.png");

    const { rerender } = render(
      <ActScienceQuestionBuilderPane
        stimulus={stimulus}
        startNumber={1}
        onChange={onChange}
        uploadChoiceImage={uploadChoiceImage}
      />
    );

    const file = new File(["fake-image"], "option-b.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Upload image for option B question 1"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(uploadChoiceImage).toHaveBeenCalledWith(file, expect.any(String)));
    const uploadedStimulus = onChange.mock.lastCall?.[0] as ActScienceStimulus;
    rerender(
      <ActScienceQuestionBuilderPane
        stimulus={uploadedStimulus}
        startNumber={1}
        onChange={onChange}
        uploadChoiceImage={uploadChoiceImage}
      />
    );

    expect(screen.getByAltText("Option B preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove image from option B question 1" }));
    const removedStimulus = onChange.mock.lastCall?.[0] as ActScienceStimulus;
    expect(removedStimulus.blocks[0]?.questions?.[0]?.options[1]?.imageUrl).toBeUndefined();
  });
});
