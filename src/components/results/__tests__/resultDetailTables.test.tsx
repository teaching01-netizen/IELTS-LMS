import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModuleRawTable } from "../ModuleRawTable";
import { QuestionRawTable } from "../QuestionRawTable";

describe("ModuleRawTable", () => {
  it("renders raw counts with percent bars and never divides by zero", () => {
    render(
      <ModuleRawTable
        rows={[
          { key: "a", label: "Base module", correct: 8, total: 10, status: "submitted" },
          { key: "b", label: "Empty module", correct: null, total: null, status: "pending", badges: ["Not administered"] },
        ]}
      />,
    );
    expect(screen.getByText("8 / 10")).toBeInTheDocument();
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("Not administered")).toBeInTheDocument();
  });
});

describe("QuestionRawTable", () => {
  const rows = [
    { key: "q1", index: 1, question: "Q1", studentAnswer: "A", correctAnswer: "A", isCorrect: true as const },
    { key: "q2", index: 2, question: "Q2", studentAnswer: "B", correctAnswer: "C", isCorrect: false as const, hasOverride: true },
    { key: "q3", index: 3, question: "Q3", studentAnswer: "", correctAnswer: "D", isCorrect: null, badges: ["Unanswered"] },
  ];
  it("renders verdicts and filters without mislabeling null verdicts", () => {
    render(<QuestionRawTable rows={rows} />);
    expect(screen.getByText("Correct")).toBeInTheDocument();
    expect(screen.getByText("Incorrect")).toBeInTheDocument();
    expect(screen.getByText("Not scored")).toBeInTheDocument();
    expect(screen.getByText("Unanswered")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Only incorrect"));
    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.queryByText("Q1")).not.toBeInTheDocument();
    expect(screen.queryByText("Q3")).not.toBeInTheDocument();
  });
});
