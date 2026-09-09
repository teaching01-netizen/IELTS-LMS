import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialExamState } from "../../services/examAdapterService";
import { ActScienceWorkspace } from "../ActScienceWorkspace";
import { createActScienceBlock } from "../ActScienceQuestionBuilderPane";
import type { ExamState } from "../../types";

describe("ActScienceWorkspace", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts with an empty stimulus list and adds a stimulus with a question set", () => {
    const state = createInitialExamState("ACT Science Practice", "ACT", "ACT Science");
    const setState = vi.fn((next: ExamState | ((previous: ExamState) => ExamState)) => {
      if (typeof next === "function") {
        next(state);
      }
    });

    render(<ActScienceWorkspace state={state} setState={setState} />);

    expect(screen.getByText("No ACT Science stimuli yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Stimulus" }));

    expect(setState).toHaveBeenCalled();
    const nextState = setState.mock.calls[0]?.[0];
    expect(typeof nextState).toBe("function");
    const updated = (nextState as (previous: ExamState) => ExamState)(state);
    expect(updated.science.stimuli).toHaveLength(1);
    expect(updated.science.stimuli[0]?.blocks[0]?.questions).toHaveLength(1);
  });

  it("keeps long ACT authoring content inside viewport-owned scroll panes", () => {
    const state = createInitialExamState("ACT Science Practice", "ACT", "ACT Science");
    state.science.stimuli = [
      {
        id: "stimulus-layout-1",
        title: "Long experiment",
        content: "Long stimulus content ".repeat(200),
        blocks: [createActScienceBlock("block-layout-1")],
        images: [],
        wordCount: 600,
      },
    ];
    state.activeScienceStimulusId = "stimulus-layout-1";

    const { container } = render(<ActScienceWorkspace state={state} setState={vi.fn()} />);

    const workspace = container.firstElementChild;
    const stimulusColumn = screen.getByLabelText("Stimulus title").closest("section");
    const questionColumn = screen
      .getByRole("button", { name: "Add ACT Science question" })
      .closest("aside");

    expect(workspace).toHaveClass("h-full", "min-h-0", "overflow-hidden");
    expect(stimulusColumn).toHaveClass("min-h-0", "overflow-hidden");
    expect(questionColumn).toHaveClass("h-full", "min-h-0", "overflow-hidden");
    expect(questionColumn?.firstElementChild).toHaveClass("h-full", "min-h-0", "overflow-y-auto");
  });

  it("keeps the document from becoming the scroll surface while ACT authoring is active", () => {
    const state = createInitialExamState("ACT Science Practice", "ACT", "ACT Science");
    const scrollTo = vi.mocked(window.scrollTo);
    const previousRootOverflow = document.documentElement.style.overflow;
    const previousRootOverscroll = document.documentElement.style.overscrollBehavior;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;

    const { unmount } = render(<ActScienceWorkspace state={state} setState={vi.fn()} />);

    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overscrollBehavior).toBe("none");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.overscrollBehavior).toBe("none");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    unmount();

    expect(document.documentElement.style.overflow).toBe(previousRootOverflow);
    expect(document.documentElement.style.overscrollBehavior).toBe(previousRootOverscroll);
    expect(document.body.style.overflow).toBe(previousBodyOverflow);
    expect(document.body.style.overscrollBehavior).toBe(previousBodyOverscroll);
  });
});
