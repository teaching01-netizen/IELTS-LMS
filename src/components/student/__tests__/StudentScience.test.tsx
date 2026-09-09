import React, { useEffect } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createInitialExamState } from "../../../services/examAdapterService";
import type { ExamState, SingleMCQBlock } from "../../../types";
import { QuestionRenderer } from "../QuestionRenderer";
import { StudentScience } from "../StudentScience";
import { StudentHighlightPersistenceProvider } from "../highlightV2Persistence";
import { readPersistedSurfaceRanges } from "../highlight/highlightStore";
import { StudentUIProvider, useStudentUI } from "../providers/StudentUIProvider";

function HighlightMode({ children }: { children: React.ReactNode }) {
  const {
    actions: { setHighlightToolMode },
  } = useStudentUI();

  useEffect(() => setHighlightToolMode("highlight"), [setHighlightToolMode]);
  return children;
}

function createActScienceState(includeSecondQuestion = false): ExamState {
  const state = createInitialExamState("ACT Science Practice", "ACT", "ACT Science");
  const options = ["A", "B", "C", "D"].map((label, index) => ({
    id: `option-${label.toLowerCase()}`,
    text: `Option ${label}`,
    isCorrect: index === 0,
  }));
  const question = {
    id: "science-question-1",
    stem: "Which conclusion is supported by the experiment?",
    skillCategory: "interpretation_of_data" as const,
    options,
  };
  const questions = [
    question,
    ...(includeSecondQuestion
      ? [
          {
            ...question,
            id: "science-question-2",
            stem: "Which variable was changed by the researchers?",
            skillCategory: "scientific_investigation" as const,
          },
        ]
      : []),
  ];

  return {
    ...state,
    activeModule: "science",
    activeScienceStimulusId: "stimulus-1",
    science: {
      stimuli: [
        {
          id: "stimulus-1",
          title: "Water temperature results",
          content: "The table shows the results of an experiment.",
          blocks: [
            {
              id: "science-block-1",
              type: "SINGLE_MCQ" as const,
              instruction: "Use the experiment results to answer the question.",
              stem: question.stem,
              options,
              questions,
            },
          ],
          images: [],
        },
      ],
    },
  };
}

function createActScienceStateWithSecondStimulus(): ExamState {
  const state = createActScienceState(true);
  const options = ["A", "B", "C", "D"].map((label, index) => ({
    id: `second-option-${label.toLowerCase()}`,
    text: `Second option ${label}`,
    isCorrect: index === 0,
  }));
  const question = {
    id: "science-question-3",
    stem: "Which result was observed in the second experiment?",
    skillCategory: "interpretation_of_data" as const,
    options,
  };

  state.science.stimuli.push({
    id: "stimulus-2",
    title: "Cell growth results",
    content: "The second passage shows a different experiment.",
    blocks: [
      {
        id: "science-block-2",
        type: "SINGLE_MCQ" as const,
        instruction: "Use the second experiment results to answer the question.",
        stem: question.stem,
        options,
        questions: [
          question,
          {
            ...question,
            id: "science-question-4",
            stem: "Which variable was measured in the second experiment?",
            skillCategory: "scientific_investigation" as const,
          },
        ],
      },
    ],
    images: [],
  });

  return state;
}

describe("StudentScience", () => {
  it("hides choice elimination controls until the toolbar mode is enabled", () => {
    render(
      <StudentScience
        state={createActScienceState()}
        answers={{}}
        onAnswerChange={vi.fn()}
        currentQuestionId="science-question-1"
        onNavigate={vi.fn()}
        flags={{}}
        onToggleFlag={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Eliminate option A" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminate option D" })).not.toBeInTheDocument();
  });

  it("shows one stimulus with its ACT Science question and four answer choices", () => {
    render(
      <StudentScience
        state={createActScienceState()}
        answers={{}}
        onAnswerChange={vi.fn()}
        currentQuestionId="science-question-1"
        onNavigate={vi.fn()}
        flags={{}}
        onToggleFlag={vi.fn()}
        highlightEnabled={false}
        highlightColor="yellow"
        tabletMode={false}
        layoutMode="wide"
        contentZoom={1}
        registerLiveAnswer={vi.fn()}
      />
    );

    expect(screen.getByTestId("science-split-workspace")).toBeInTheDocument();
    expect(screen.getByText("Water temperature results")).toBeInTheDocument();
    expect(screen.getByText("The table shows the results of an experiment.")).toBeInTheDocument();
    expect(
      screen.getByText("Which conclusion is supported by the experiment?")
    ).toBeInTheDocument();
    expect(screen.getByText("Option A")).toBeInTheDocument();
    expect(screen.getByText("Option B")).toBeInTheDocument();
    expect(screen.getByText("Option C")).toBeInTheDocument();
    expect(screen.getByText("Option D")).toBeInTheDocument();
  });

  it("shows only the active ACT Science question in the question pane", () => {
    render(
      <StudentScience
        state={createActScienceState(true)}
        answers={{}}
        onAnswerChange={vi.fn()}
        currentQuestionId="science-question-1"
        onNavigate={vi.fn()}
        flags={{}}
        onToggleFlag={vi.fn()}
      />
    );

    expect(
      screen.getByText("Which conclusion is supported by the experiment?")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Which variable was changed by the researchers?")
    ).not.toBeInTheDocument();
  });

  it("lets a student select one answer and replace it with another answer", () => {
    const onAnswerChange = vi.fn();

    function StudentScienceHarness() {
      const [answers, setAnswers] = React.useState<Record<string, string>>({});

      return (
        <StudentScience
          state={createActScienceState()}
          answers={answers}
          onAnswerChange={(questionId, answer, metadata) => {
            onAnswerChange(questionId, answer, metadata);
            setAnswers((currentAnswers) => ({
              ...currentAnswers,
              [questionId]: answer,
            }));
          }}
          currentQuestionId="science-question-1"
          onNavigate={vi.fn()}
          flags={{}}
          onToggleFlag={vi.fn()}
          highlightEnabled={false}
          highlightColor="yellow"
        />
      );
    }

    render(<StudentScienceHarness />);

    const optionB = screen.getByRole("radio", { name: /Option B/i });
    const optionC = screen.getByRole("radio", { name: /Option C/i });

    fireEvent.click(optionB);
    expect(optionB).toBeChecked();
    expect(onAnswerChange.mock.lastCall?.slice(0, 2)).toEqual(["science-question-1", "option-b"]);

    fireEvent.click(optionC);
    expect(optionB).not.toBeChecked();
    expect(optionC).toBeChecked();
    expect(onAnswerChange.mock.lastCall?.slice(0, 2)).toEqual(["science-question-1", "option-c"]);
  });

  it("renders an image inside an ACT Science answer choice", () => {
    const state = createActScienceState();
    const block = state.science.stimuli[0].blocks[0];
    const imageUrl = "https://example.test/act-option-b.png";
    const options = block.options.map((option) =>
      option.id === "option-b" ? { ...option, imageUrl } : option
    );
    block.options = options;
    block.questions![0].options = options;

    render(
      <StudentScience
        state={state}
        answers={{}}
        onAnswerChange={vi.fn()}
        currentQuestionId="science-question-1"
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("img", { name: "Option B image" })).toHaveAttribute("src", imageUrl);
  });

  it("renders an image inside an ACT Science question stem", () => {
    const state = createActScienceState();
    const imageUrl = "https://example.test/act-question.png";
    const question = state.science.stimuli[0].blocks[0].questions![0];
    state.science.stimuli[0].blocks[0].questions![0] = { ...question, imageUrl };

    render(
      <StudentScience
        state={state}
        answers={{}}
        onAnswerChange={vi.fn()}
        currentQuestionId="science-question-1"
        onNavigate={vi.fn()}
      />
    );

    const image = screen.getByRole("img", { name: "Question 1 stem image" });
    const zoomTrigger = screen.getByRole("button", { name: "Open question 1 stem image" });
    const legend = image.closest("legend");
    const mediaContainer = zoomTrigger.parentElement;
    const stemText = screen.getByText("Which conclusion is supported by the experiment?");

    expect(image).toHaveAttribute("src", imageUrl);
    expect(image).toHaveClass("max-h-[32rem]");
    expect(zoomTrigger).toContainElement(image);
    expect(legend).toHaveClass("w-full");
    expect(stemText.parentElement).not.toBe(legend);
    expect(stemText.parentElement).toHaveClass("flex", "gap-3");
    expect(mediaContainer?.parentElement).toBe(legend);
    expect(mediaContainer).toHaveClass("mx-auto", "mt-4", "w-full", "max-w-3xl");
  });

  it("keeps answer-choice images disabled by default for non-ACT callers", () => {
    const block: SingleMCQBlock = {
      id: "single-image-boundary",
      type: "SINGLE_MCQ",
      instruction: "Choose one answer.",
      stem: "Which diagram is correct?",
      options: [
        {
          id: "image-a",
          text: "Diagram A",
          isCorrect: true,
          imageUrl: "https://example.test/diagram-a.png",
        },
      ],
    };

    render(
      <QuestionRenderer
        question={null}
        block={block}
        number={1}
        answer={null}
        onChange={() => {}}
      />
    );

    expect(screen.queryByRole("img", { name: "Option A image" })).not.toBeInTheDocument();
  });

  it("lets a student eliminate and restore an ACT Science answer choice without changing the answer", () => {
    const onAnswerChange = vi.fn();

    render(
      <StudentScience
        state={createActScienceState()}
        answers={{ "science-question-1": "option-a" }}
        onAnswerChange={onAnswerChange}
        currentQuestionId="science-question-1"
        onNavigate={vi.fn()}
        flags={{}}
        onToggleFlag={vi.fn()}
        choiceEliminationEnabled
      />
    );

    const answerA = screen.getByRole("radio", { name: /Option A/i });
    expect(answerA).toBeChecked();
    expect(screen.getAllByRole("button", { name: /^Eliminate option [A-D]$/ })).toHaveLength(4);

    const eliminateOptionB = screen.getByRole("button", { name: "Eliminate option B" });
    expect(eliminateOptionB).toHaveAttribute("aria-pressed", "false");
    expect(eliminateOptionB).toHaveClass("h-8", "w-8", "bg-gray-800");
    expect(eliminateOptionB).not.toHaveTextContent("Eliminate");

    fireEvent.click(eliminateOptionB);

    expect(onAnswerChange).not.toHaveBeenCalled();
    expect(answerA).toBeChecked();
    expect(screen.getByRole("button", { name: "Restore option B" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Option B")).toHaveClass("text-gray-500");
    expect(screen.getAllByTestId("choice-elimination-mark")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Restore option B" }));

    expect(screen.getByRole("button", { name: "Eliminate option B" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByText("Option B")).not.toHaveClass("text-gray-500");
    expect(screen.queryAllByTestId("choice-elimination-mark")).toHaveLength(0);
    expect(onAnswerChange).not.toHaveBeenCalled();
  });

  it("limits choice elimination controls to ACT Science options A through D", () => {
    const state = createActScienceState();
    const block = state.science.stimuli[0].blocks[0];
    const options = [...block.options, { id: "option-e", text: "Option E", isCorrect: false }];
    block.options = options;
    block.questions![0].options = options;

    render(
      <StudentScience
        state={state}
        answers={{}}
        onAnswerChange={vi.fn()}
        currentQuestionId="science-question-1"
        onNavigate={vi.fn()}
        choiceEliminationEnabled
      />
    );

    expect(screen.getByText("Option E")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminate option E" })).not.toBeInTheDocument();
  });

  it("does not show choice elimination controls for a non-ACT exam", () => {
    const state = createActScienceState();
    state.type = "Academic";
    state.config.general.type = "Academic";

    render(
      <StudentScience
        state={state}
        answers={{}}
        onAnswerChange={vi.fn()}
        currentQuestionId="science-question-1"
        onNavigate={vi.fn()}
        choiceEliminationEnabled
      />
    );

    expect(screen.queryByRole("button", { name: "Eliminate option A" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminate option D" })).not.toBeInTheDocument();
  });

  it("keeps eliminated choices independent for each ACT Science question", () => {
    function StudentScienceEliminationHarness() {
      const [currentQuestionId, setCurrentQuestionId] = React.useState("science-question-1");

      return (
        <StudentScience
          state={createActScienceState(true)}
          answers={{}}
          onAnswerChange={vi.fn()}
          currentQuestionId={currentQuestionId}
          onNavigate={setCurrentQuestionId}
          choiceEliminationEnabled
        />
      );
    }

    render(<StudentScienceEliminationHarness />);

    const firstQuestion = screen.getByRole("group", {
      name: /Which conclusion is supported by the experiment\?/i,
    });
    fireEvent.click(within(firstQuestion).getByRole("button", { name: "Eliminate option B" }));

    expect(within(firstQuestion).getByRole("button", { name: "Restore option B" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));

    const secondQuestion = screen.getByRole("group", {
      name: /Which variable was changed by the researchers\?/i,
    });

    fireEvent.click(within(secondQuestion).getByRole("button", { name: "Eliminate option B" }));

    expect(
      within(secondQuestion).getByRole("button", { name: "Restore option B" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous question" }));

    expect(
      within(
        screen.getByRole("group", {
          name: /Which conclusion is supported by the experiment\?/i,
        })
      ).getByRole("button", { name: "Restore option B" })
    ).toBeInTheDocument();
  });

  it("keeps multiple questions under one stimulus and supports back-and-forth navigation", () => {
    const onNavigate = vi.fn();

    function StudentScienceNavigationHarness() {
      const [currentQuestionId, setCurrentQuestionId] = React.useState("science-question-1");

      return (
        <StudentScience
          state={createActScienceState(true)}
          answers={{}}
          onAnswerChange={vi.fn()}
          currentQuestionId={currentQuestionId}
          onNavigate={(questionId) => {
            onNavigate(questionId);
            setCurrentQuestionId(questionId);
          }}
          flags={{}}
          onToggleFlag={vi.fn()}
          highlightEnabled={false}
          highlightColor="yellow"
        />
      );
    }

    render(<StudentScienceNavigationHarness />);

    expect(
      screen.getByText("Which conclusion is supported by the experiment?")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Which variable was changed by the researchers?")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(onNavigate).toHaveBeenLastCalledWith("science-question-2");
    expect(
      screen.queryByText("Which conclusion is supported by the experiment?")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Which variable was changed by the researchers?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next question" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous question" }));
    expect(onNavigate).toHaveBeenLastCalledWith("science-question-1");
    expect(
      screen.getByText("Which conclusion is supported by the experiment?")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Which variable was changed by the researchers?")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous question" })).toBeDisabled();
  });

  it("switches to the next stimulus when navigation crosses a passage boundary", () => {
    const onNavigate = vi.fn();

    function StudentScienceStimulusNavigationHarness() {
      const [currentQuestionId, setCurrentQuestionId] = React.useState("science-question-1");

      return (
        <StudentScience
          state={createActScienceStateWithSecondStimulus()}
          answers={{}}
          onAnswerChange={vi.fn()}
          currentQuestionId={currentQuestionId}
          onNavigate={(questionId) => {
            onNavigate(questionId);
            setCurrentQuestionId(questionId);
          }}
          flags={{}}
          onToggleFlag={vi.fn()}
        />
      );
    }

    render(<StudentScienceStimulusNavigationHarness />);

    expect(screen.getByText("Water temperature results")).toBeInTheDocument();
    expect(screen.queryByText("Cell growth results")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(onNavigate).toHaveBeenLastCalledWith("science-question-2");
    expect(screen.getByText("Water temperature results")).toBeInTheDocument();
    expect(
      screen.queryByText("Which conclusion is supported by the experiment?")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(onNavigate).toHaveBeenLastCalledWith("science-question-3");
    expect(screen.queryByText("Water temperature results")).not.toBeInTheDocument();
    expect(screen.getByText("Cell growth results")).toBeInTheDocument();
    expect(
      screen.getByText("Which result was observed in the second experiment?")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Which variable was measured in the second experiment?")
    ).not.toBeInTheDocument();
  });

  it("renders stimulus tables and opens annotated images in the shared zoom view", () => {
    const state = createActScienceState();
    state.science.stimuli[0].content = `
      <p>Results are shown below.</p>
      <table>
        <thead><tr><th>Temperature</th><th>Growth</th></tr></thead>
        <tbody><tr><td>20°C</td><td>High</td></tr></tbody>
      </table>
    `;
    state.science.stimuli[0].images = [
      {
        id: "science-image-1",
        alt: "Results chart",
        annotations: [
          {
            id: "science-image-label-1",
            type: "text",
            x: 50,
            y: 50,
            text: "Key result",
          },
        ],
        crop: { x: 0, y: 0, width: 100, height: 100 },
        height: 400,
        src: "https://example.test/results-chart.png",
        width: 600,
        zoom: 1,
      },
    ];

    render(
      <StudentScience
        state={state}
        answers={{}}
        onAnswerChange={vi.fn()}
        currentQuestionId="science-question-1"
        onNavigate={vi.fn()}
        flags={{}}
        onToggleFlag={vi.fn()}
        highlightEnabled
        highlightColor="yellow"
      />
    );

    expect(screen.getByRole("columnheader", { name: "Temperature" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Results chart" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Results chart" }));
    const zoomDialog = screen.getByRole("dialog", { name: "Results chart zoomed view" });
    expect(zoomDialog).toBeInTheDocument();
    expect(within(zoomDialog).getByText("Key result")).toBeInTheDocument();
  });

  it("persists a PC-style text selection highlight on the ACT Science stimulus", () => {
    const namespace = "test:act-science-stimulus";

    render(
      <StudentHighlightPersistenceProvider namespace={namespace}>
        <StudentUIProvider>
          <HighlightMode>
            <StudentScience
              state={createActScienceState()}
              answers={{}}
              onAnswerChange={vi.fn()}
              currentQuestionId="science-question-1"
              onNavigate={vi.fn()}
              flags={{}}
              onToggleFlag={vi.fn()}
              highlightEnabled
              highlightColor="yellow"
            />
          </HighlightMode>
        </StudentUIProvider>
      </StudentHighlightPersistenceProvider>
    );

    const textNode = screen.getByText("The table shows the results of an experiment.").firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 9);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event("pointerup"));

    expect(
      readPersistedSurfaceRanges(namespace, "science:stimulus:stimulus-1")?.ranges
    ).toHaveLength(1);
  });
});
