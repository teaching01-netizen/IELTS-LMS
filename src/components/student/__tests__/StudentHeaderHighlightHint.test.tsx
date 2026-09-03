import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { StudentHeader } from "../StudentHeader";

describe("StudentHeader highlight tool", () => {
  it("shows a 44px native split control only in a highlight-capable exam context", () => {
    render(
      <StudentHeader
        testTakerId="W000000"
        timeRemaining={60}
        highlightEnabled
        highlightToolMode="off"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        isExamActive
      />
    );

    const mainButton = screen.getByRole("button", { name: "Highlight" });
    expect(mainButton.tagName).toBe("BUTTON");
    expect(mainButton).toHaveClass("min-h-11");
    expect(mainButton).toHaveAttribute("aria-pressed", "false");
    const eraseButton = screen.getByRole("button", { name: "Erase highlights" });
    expect(eraseButton).toHaveClass("min-h-11");
    expect(eraseButton).toHaveClass("min-w-11");
    expect(eraseButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Tip: Select text to highlight")).toBeNull();
  });

  it("selects colors and erase mode from the palette while announcing the active mode", async () => {
    const onSelectHighlightColor = vi.fn();
    const onSelectEraseMode = vi.fn();
    render(
      <StudentHeader
        testTakerId="W000000"
        timeRemaining={60}
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={onSelectHighlightColor}
        onSelectEraseMode={onSelectEraseMode}
        onOpenNavigator={() => {}}
        isExamActive
      />
    );

    expect(screen.getByRole("button", { name: "Highlighting" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("status")).toHaveTextContent("Highlighting with Yellow");

    const trigger = screen.getByRole("button", { name: "Choose highlight color" });
    fireEvent.click(trigger);
    for (const name of ["Yellow", "Pink", "Green", "Blue", "Purple"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("min-h-11");
    }
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    expect(onSelectHighlightColor).toHaveBeenCalledWith("blue");
    await waitFor(() => expect(trigger).toHaveFocus());

    expect(screen.queryByRole("button", { name: "Erase highlights" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Erase highlights" }));
    expect(onSelectEraseMode).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("moves focus into the disclosure and restores it after Escape or outside dismissal", async () => {
    render(
      <StudentHeader
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="green"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        onOpenNavigator={() => {}}
        isExamActive
      />
    );
    const trigger = screen.getByRole("button", { name: "Choose highlight color" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Green" })).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Highlight options")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Green" })).toHaveFocus());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText("Highlight options")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("anchors the disclosure below its trigger instead of the viewport edge", async () => {
    render(
      <StudentHeader
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        onOpenNavigator={() => {}}
        isExamActive
      />
    );

    const trigger = screen.getByRole("button", { name: "Choose highlight color" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 420,
      y: 10,
      top: 10,
      right: 464,
      bottom: 54,
      left: 420,
      width: 44,
      height: 44,
      toJSON: () => ({}),
    });

    fireEvent.click(trigger);
    const panel = screen.getByRole("group", { name: "Highlight options" });
    await waitFor(() => expect(panel).toHaveStyle({ left: "224px", top: "62px", width: "240px" }));
    expect(panel).not.toHaveClass("right-3");
  });

  it("hides the tool when the exam is inactive or highlighting is unavailable", () => {
    const { rerender } = render(
      <StudentHeader highlightEnabled highlightToolMode="off" highlightColor="yellow" />
    );
    expect(screen.queryByRole("button", { name: "Highlight" })).toBeNull();

    rerender(
      <StudentHeader
        highlightEnabled={false}
        highlightToolMode="off"
        highlightColor="yellow"
        isExamActive
      />
    );
    expect(screen.queryByRole("button", { name: "Highlight" })).toBeNull();
  });

  it("shows the ACT Science choice elimination mode beside the test taker identity", () => {
    const onToggleChoiceElimination = vi.fn();

    render(
      <StudentHeader
        examType="ACT"
        choiceEliminationAvailable
        choiceEliminationEnabled={false}
        onToggleChoiceElimination={onToggleChoiceElimination}
        highlightEnabled
        highlightToolMode="off"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        isExamActive
      />
    );

    const eliminateButton = screen.getByRole("button", { name: "Eliminate choices" });
    expect(eliminateButton).toHaveAttribute("aria-pressed", "false");
    expect(eliminateButton).toHaveClass("min-h-11");
    expect(screen.getByText("Test taker ID").parentElement?.parentElement).toContainElement(
      eliminateButton
    );

    fireEvent.click(eliminateButton);
    expect(onToggleChoiceElimination).toHaveBeenCalledTimes(1);
  });

  it("does not expose choice elimination in the IELTS header", () => {
    render(
      <StudentHeader
        examType="Academic"
        choiceEliminationAvailable
        onToggleChoiceElimination={() => {}}
      />
    );

    expect(screen.queryByRole("button", { name: "Eliminate choices" })).toBeNull();
  });

  it("keeps Highlight and Erase together in the right-side tool group", () => {
    render(
      <StudentHeader
        examType="ACT"
        choiceEliminationAvailable
        choiceEliminationEnabled
        onToggleChoiceElimination={() => {}}
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        isExamActive
      />
    );

    const controls = within(screen.getByTestId("student-header-controls-slot"))
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(controls).toEqual(["Highlighting", "Choose highlight color", "Erase highlights"]);
  });

  it("keeps the Highlighting label visible in a stable-width toolbar slot", () => {
    const { rerender } = render(
      <StudentHeader
        examType="ACT"
        highlightEnabled
        highlightToolMode="off"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        isExamActive
      />
    );

    const inactiveButton = screen.getByRole("button", { name: "Highlight" });
    expect(inactiveButton).toHaveClass("min-w-[9.5rem]", "whitespace-nowrap");

    rerender(
      <StudentHeader
        examType="ACT"
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        isExamActive
      />
    );

    const activeButton = screen.getByRole("button", { name: "Highlighting" });
    expect(activeButton).toHaveClass("min-w-[9.5rem]", "whitespace-nowrap");
    expect(within(activeButton).getByText("Highlighting")).not.toHaveClass("hidden");
  });

  it("keeps the IELTS highlight layout outside the ACT-only balance adjustment", () => {
    render(
      <StudentHeader
        examType="Academic"
        highlightEnabled
        highlightToolMode="highlight"
        highlightColor="yellow"
        onToggleHighlightMode={() => {}}
        onSelectHighlightColor={() => {}}
        onSelectEraseMode={() => {}}
        isExamActive
      />
    );

    const highlightButton = screen.getByRole("button", { name: "Highlighting" });
    expect(highlightButton).not.toHaveClass("min-w-[10.5rem]", "whitespace-nowrap");
    expect(within(highlightButton).getByText("Highlighting")).toHaveClass("hidden", "md:inline");
  });
});
