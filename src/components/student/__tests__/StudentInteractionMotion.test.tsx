import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StudentHeader } from "../StudentHeader";
import { StudentFooter } from "../StudentFooter";
import { StudentMaterialWithQuestionPane } from "../StudentMaterialWithQuestionPane";
import { StudentQuestionNumber } from "../StudentQuestionNumber";
import { QuestionNavigator } from "../QuestionNavigator";
import { SubmitConfirmation } from "../SubmitConfirmation";
import { CompactStudentHeader } from "../layout/CompactStudentHeader";
import { CompactQuestionNavigation } from "../layout/CompactQuestionNavigation";

const pressRecipe =
  "transition-[scale,background-color,border-color,box-shadow,opacity] duration-150 ease-out active:scale-[0.96]";

function question(id: string, groupId = "group-1"): any {
  return {
    id,
    blockId: "block-1",
    groupId,
    groupLabel: groupId === "group-1" ? "Section 1" : "Section 2",
    isMulti: false,
    correctCount: 1,
    answerKey: id,
    block: {} as any,
    question: null,
  };
}

function renderHeader(props: Record<string, unknown> = {}) {
  return render(
    <StudentHeader
      testTakerId="t1"
      timeRemaining={600}
      highlightEnabled
      highlightToolMode="highlight"
      highlightColor="yellow"
      onToggleHighlightMode={vi.fn()}
      onSelectHighlightColor={vi.fn()}
      onSelectEraseMode={vi.fn()}
      onOpenNavigator={vi.fn()}
      onOpenAccessibility={vi.fn()}
      isExamActive
      zoom={1}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onZoomReset={vi.fn()}
      {...props}
    />
  );
}

describe("student interaction motion class contracts", () => {
  describe("StudentFooter", () => {
    it("gives every question chip the press recipe and a per-state hover", () => {
      render(
        <StudentFooter
          questions={[
            question("q1"),
            question("q2"),
            question("q3"),
            question("q4"),
            question("q5"),
          ]}
          currentQuestionId="q1"
          onNavigate={() => {}}
          answers={{ q2: "answer", q3: "answer" }}
          flags={{ q4: true }}
          onSubmit={() => {}}
        />
      );
      const row = screen.getByTestId("student-footer-row");

      const current = within(row).getByRole("button", { name: /question 1/i });
      const answered = within(row).getByRole("button", { name: /question 2/i });
      const answered2 = within(row).getByRole("button", { name: /question 3/i });
      const flagged = within(row).getByRole("button", { name: /question 4/i });
      const unanswered = within(row).getByRole("button", { name: /question 5/i });

      expect(current).toHaveClass(pressRecipe);
      expect(current).toHaveClass(
        "bg-blue-800",
        "border-blue-800",
        "text-white",
        "hover:bg-blue-700"
      );

      expect(flagged).toHaveClass(pressRecipe);
      expect(flagged).toHaveClass("bg-amber-100", "border-amber-700", "hover:bg-amber-200");

      expect(answered).toHaveClass(pressRecipe);
      expect(answered).toHaveClass("bg-green-200", "border-green-700", "hover:bg-green-300");
      expect(answered2).toHaveClass(pressRecipe);
      expect(answered2).toHaveClass("hover:bg-green-300");

      expect(unanswered).toHaveClass(pressRecipe);
      expect(unanswered).toHaveClass("bg-white", "border-gray-200", "hover:bg-gray-100");
    });

    it("keeps the state color contract while adding motion (regression guard)", () => {
      render(
        <StudentFooter
          questions={[question("q1"), question("q2")]}
          currentQuestionId="q1"
          onNavigate={() => {}}
          answers={{ q2: "answer" }}
          onSubmit={() => {}}
        />
      );
      const row = screen.getByTestId("student-footer-row");
      const current = within(row).getByRole("button", { name: /question 1/i });
      const answered = within(row).getByRole("button", { name: /question 2/i });

      expect(current).toHaveClass("bg-blue-800", "text-white");
      expect(answered).toHaveClass("bg-green-200", "text-green-900");
      expect(answered).not.toHaveClass("bg-blue-800");
    });

    it("treats the part-jump target as a button with the recipe and keeps its hover/active shades", () => {
      render(
        <StudentFooter
          questions={[question("q1", "group-1"), question("q2", "group-2")]}
          currentQuestionId="q1"
          onNavigate={() => {}}
          answers={{}}
          onSubmit={() => {}}
        />
      );
      const row = screen.getByTestId("student-footer-row");
      const jump = within(row).getByRole("button", { name: /jump to part 2/i });

      expect(jump).toHaveClass(pressRecipe);
      expect(jump).toHaveClass("hover:bg-gray-50", "active:bg-gray-100");
      expect(jump).toHaveAttribute("title", "Click to jump to Part 2");
    });

    it("animates the part progress fill width without scaling the display", () => {
      render(
        <StudentFooter
          questions={[question("q1", "group-1"), question("q2", "group-2")]}
          currentQuestionId="q1"
          onNavigate={() => {}}
          answers={{ q2: "answer" }}
          onSubmit={() => {}}
        />
      );
      const row = screen.getByTestId("student-footer-row");
      const jump = within(row).getByRole("button", { name: /jump to part 2/i });
      const fill = jump.querySelector("div.h-full");

      expect(fill).not.toBeNull();
      expect(fill).toHaveClass("transition-[width]", "duration-300", "ease-out");
      expect(fill).not.toHaveClass("active:scale-[0.96]");
    });

    it("leaves pure display elements (counter, progress track) without press feedback", () => {
      render(
        <StudentFooter
          questions={[question("q1", "group-1"), question("q2", "group-2")]}
          currentQuestionId="q1"
          onNavigate={() => {}}
          answers={{ q2: "answer" }}
          onSubmit={() => {}}
        />
      );
      const row = screen.getByTestId("student-footer-row");
      const counter = within(row).getByText("1/2");
      const jump = within(row).getByRole("button", { name: /jump to part 2/i });
      const track = jump.querySelector(".bg-gray-50");

      expect(counter.parentElement).not.toHaveClass("active:scale-[0.96]");
      expect(counter.parentElement).toHaveClass("bg-gray-50");
      expect(track).not.toBeNull();
      expect(track).not.toHaveClass("active:scale-[0.96]");
    });
  });

  describe("StudentHeader", () => {
    it("shows ACT branding for an ACT exam instead of the IELTS label", () => {
      renderHeader({ examType: "ACT" });

      expect(screen.getByText("ACT")).toBeInTheDocument();
      expect(screen.queryByText("IELTS")).not.toBeInTheDocument();
    });

    it("sweeps the zoom controls, highlight tools, and chrome buttons with the recipe", () => {
      renderHeader();

      for (const name of ["Zoom out", "Zoom in", "Reset zoom"]) {
        const button = screen.getByRole("button", { name });
        expect(button).toHaveClass(pressRecipe);
        expect(button).toHaveClass("hover:border-gray-300", "hover:bg-gray-50");
      }

      expect(screen.getByRole("button", { name: "Highlighting" })).toHaveClass(pressRecipe);
      expect(screen.getByRole("button", { name: "Choose highlight color" })).toHaveClass(
        pressRecipe
      );
      expect(screen.getByRole("button", { name: "Erase highlights" })).toHaveClass(pressRecipe);
      expect(screen.getByRole("button", { name: "Open accessibility settings" })).toHaveClass(
        pressRecipe
      );
      expect(screen.getByRole("button", { name: "Open question navigator" })).toHaveClass(
        pressRecipe
      );
    });

    it("sweeps the tablet zoom trigger and overlay zoom buttons with the recipe", () => {
      renderHeader({ tabletMode: true });

      const trigger = screen.getByRole("button", { name: "Open zoom controls" });
      expect(trigger).toHaveClass(pressRecipe);
      expect(trigger).toHaveClass("hover:border-gray-300", "hover:bg-gray-100");

      fireEvent.click(trigger);
      for (const name of ["Zoom out", "Zoom in", "Reset zoom"]) {
        expect(screen.getByRole("button", { name })).toHaveClass(pressRecipe);
      }
    });

    it("sweeps the highlight palette swatches with the recipe", () => {
      renderHeader();
      fireEvent.click(screen.getByRole("button", { name: "Choose highlight color" }));

      for (const name of ["Yellow", "Pink", "Green", "Blue", "Purple"]) {
        expect(screen.getByRole("button", { name })).toHaveClass(pressRecipe);
        expect(screen.getByRole("button", { name })).toHaveClass("hover:bg-gray-100");
      }
    });

    it("attaches the urgency cue to the wide timer pill only under five minutes, without press scale", () => {
      const { unmount } = renderHeader({ timeRemaining: 299 });
      const urgentPill = screen.getByRole("timer").parentElement;

      expect(urgentPill).not.toBeNull();
      expect(urgentPill).toHaveClass("student-timer-urgent");
      expect(urgentPill).toHaveClass("transition-colors");
      expect(urgentPill).not.toHaveClass("active:scale-[0.96]");

      unmount();
      renderHeader({ timeRemaining: 300 });
      const calmPill = screen.getByRole("timer").parentElement;
      expect(calmPill).not.toHaveClass("student-timer-urgent");
      expect(calmPill).toHaveClass("transition-colors");
    });
  });

  describe("CompactStudentHeader", () => {
    it("sweeps the tools trigger, sheet actions, and swatches with the recipe", () => {
      render(
        <CompactStudentHeader
          moduleLabel="Reading"
          testTakerId="t1"
          highlightEnabled
          onToggleHighlightMode={vi.fn()}
          onSelectHighlightColor={vi.fn()}
          onSelectEraseMode={vi.fn()}
          onOpenNavigator={vi.fn()}
          onOpenAccessibility={vi.fn()}
        />
      );

      expect(screen.getByRole("button", { name: "Open exam tools" })).toHaveClass(pressRecipe);

      fireEvent.click(screen.getByRole("button", { name: "Open exam tools" }));

      for (const name of [
        "Question navigator",
        "Highlight",
        "Erase highlights",
        "Accessibility settings",
      ]) {
        expect(screen.getByRole("button", { name })).toHaveClass(pressRecipe);
        expect(screen.getByRole("button", { name })).toHaveClass("hover:bg-gray-50");
      }
      for (const name of ["Yellow", "Pink", "Green", "Blue", "Purple"]) {
        expect(screen.getByRole("button", { name })).toHaveClass(pressRecipe);
        expect(screen.getByRole("button", { name })).toHaveClass("hover:bg-gray-50");
      }
    });

    it("attaches the urgency cue and color transition to the compact timer pill only under five minutes", () => {
      const { unmount } = render(
        <CompactStudentHeader moduleLabel="Reading" testTakerId="t1" timeRemaining={299} />
      );
      const urgentPill = screen.getByTestId("student-header-timer-slot");
      expect(urgentPill).toHaveClass("student-timer-urgent");
      expect(urgentPill).toHaveClass("transition-colors");
      expect(urgentPill).not.toHaveClass("active:scale-[0.96]");

      unmount();
      render(<CompactStudentHeader moduleLabel="Reading" testTakerId="t1" timeRemaining={300} />);
      expect(screen.getByTestId("student-header-timer-slot")).not.toHaveClass(
        "student-timer-urgent"
      );
      expect(screen.getByTestId("student-header-timer-slot")).toHaveClass("transition-colors");
    });
  });

  describe("CompactQuestionNavigation", () => {
    it("sweeps previous/next, the center label, and Finish with the recipe", () => {
      render(
        <CompactQuestionNavigation
          questions={[question("q1"), question("q2")]}
          currentQuestionId="q1"
          onNavigate={() => {}}
          onSubmit={() => {}}
          showSubmitButton
        />
      );

      expect(screen.getByRole("button", { name: "Previous question" })).toHaveClass(pressRecipe);
      expect(screen.getByRole("button", { name: "Next question" })).toHaveClass(pressRecipe);
      expect(screen.getByRole("button", { name: /open question navigator/i })).toHaveClass(
        pressRecipe
      );
      expect(screen.getByRole("button", { name: "Finish" })).toHaveClass(pressRecipe);
      expect(screen.getByRole("button", { name: "Finish" })).toHaveClass("hover:bg-primary-hover");
      expect(screen.getByRole("button", { name: "Previous question" })).toHaveClass(
        "disabled:opacity-40"
      );
    });
  });

  describe("StudentMaterialWithQuestionPane compact tabs", () => {
    function renderTabs() {
      return render(
        <StudentMaterialWithQuestionPane
          isTabletMode={false}
          layoutMode="compact"
          workspaceRef={React.createRef<HTMLDivElement>()}
          splitPaneStyle={undefined}
          leftWidth={50}
          onDividerPointerDown={() => undefined}
          onDividerKeyDown={() => undefined}
          workspaceTestId="student-material-workspace"
          dividerAriaLabel="Resize panes"
          dividerTestId="pane-resizer"
          materialPane={<div />}
          questionPanel={{
            blocks: [],
            allQuestions: [],
            answers: {},
            onAnswerChange: () => undefined,
            currentQuestionId: null,
            onNavigate: () => undefined,
            flags: {},
            answerCompact: false,
            highlightEnabled: false,
            highlightColor: "yellow",
            questionContainerRef: React.createRef<HTMLDivElement>(),
            contentZoomStyle: undefined,
            panelTestId: "question-content",
            getBlockStartQuestionNumber: () => 1,
            renderBlockInstruction: () => null,
          }}
        />
      );
    }

    it("shows the pressed tab in the blue active state and keeps both tabs on the recipe", () => {
      renderTabs();

      const passage = screen.getByRole("button", { name: "Passage" });
      const questions = screen.getByRole("button", { name: "Questions" });

      expect(passage).toHaveClass(pressRecipe, "student-touch-target");
      expect(passage).toHaveClass(
        "border-blue-700",
        "bg-blue-50",
        "text-blue-900",
        "active:bg-blue-100"
      );

      expect(questions).toHaveClass(pressRecipe, "student-touch-target");
      expect(questions).toHaveClass("border-gray-300", "bg-white", "text-gray-900");

      fireEvent.click(questions);
      expect(questions).toHaveAttribute("aria-pressed", "true");
      expect(questions).toHaveClass(
        "border-blue-700",
        "bg-blue-50",
        "text-blue-900",
        "active:bg-blue-100"
      );
      expect(questions).not.toHaveClass("border-gray-300");
      expect(passage).toHaveAttribute("aria-pressed", "false");
      expect(passage).toHaveClass("border-gray-300", "bg-white", "text-gray-900");
    });
  });

  describe("QuestionNavigator", () => {
    beforeEach(() => {
      HTMLDialogElement.prototype.showModal = vi.fn(function () {
        (this as HTMLDialogElement).open = true;
      });
      HTMLDialogElement.prototype.close = vi.fn(function () {
        (this as HTMLDialogElement).open = false;
      });
    });

    it("marks the dialog for the entrance animation and sweeps its chips with the recipe and per-state press shades", () => {
      const questions = [
        question("q1"),
        { ...question("q2"), isMulti: true, correctCount: 2 },
        { ...question("q3"), isMulti: true, correctCount: 2 },
        question("q4"),
        question("q5"),
      ];
      render(
        <QuestionNavigator
          questions={questions}
          answers={{ q2: ["a"], q3: ["a", "b"] }}
          flags={{ q4: true }}
          currentQuestionId="q1"
          onNavigate={() => {}}
          onClose={() => {}}
        />
      );

      expect(screen.getByRole("dialog", { name: "Question Navigator" })).toHaveClass(
        "student-question-navigator"
      );

      const current = screen.getByRole("button", { name: "Question 1, current, not answered" });
      const answered = screen.getByRole("button", { name: "Question 2-3, answered" });
      const complete = screen.getByRole("button", { name: "Question 4-5, complete" });
      const flagged = screen.getByRole("button", { name: "Question 6, not answered, flagged" });
      const unanswered = screen.getByRole("button", { name: "Question 7, not answered" });

      for (const chip of [current, complete, flagged, answered, unanswered]) {
        expect(chip).toHaveClass(pressRecipe);
        expect(chip).not.toHaveClass("transition-colors");
      }

      expect(current).toHaveClass("bg-blue-800", "hover:bg-blue-700", "active:bg-blue-800");
      expect(complete).toHaveClass("bg-green-800", "hover:bg-green-900", "active:bg-green-900");
      expect(flagged).toHaveClass("bg-amber-100", "hover:bg-amber-200", "active:bg-amber-300");
      expect(answered).toHaveClass("bg-green-200", "hover:bg-green-300", "active:bg-green-400");
      expect(unanswered).toHaveClass("bg-gray-100", "hover:bg-gray-200", "active:bg-gray-300");
    });
  });

  describe("SubmitConfirmation", () => {
    it("marks the overlay surface for the entrance animation", () => {
      const { container } = render(
        <SubmitConfirmation
          isOpen
          onClose={() => {}}
          onConfirm={() => {}}
          answeredCount={1}
          totalQuestions={2}
          flaggedCount={0}
        />
      );

      expect(container.firstElementChild).toHaveClass("student-confirmation-surface");
      expect(screen.getByRole("heading", { name: /confirm submission/i })).toBeInTheDocument();
    });
  });

  describe("display elements never get press feedback", () => {
    it("keeps StudentQuestionNumber and the footer progress fill free of active scale", () => {
      const { container } = render(<StudentQuestionNumber number={1} isActive />);
      expect(container.firstElementChild).not.toHaveClass("active:scale-[0.96]");
      expect(container.firstElementChild).not.toHaveClass(pressRecipe);
    });
  });
});
