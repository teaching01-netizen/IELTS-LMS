import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StudentPostExamView } from "../StudentPostExamView";

describe("StudentPostExamView", () => {
  it("shows the ACT Science raw score and percentage after submission", () => {
    render(
      <StudentPostExamView
        examType="ACT"
        isProctorTerminated={false}
        proctorNote={null}
        studentInfo={[]}
        score={{
          section: "science",
          correctCount: 8,
          totalQuestions: 10,
          percentage: 80,
        }}
        onExit={() => undefined}
        finalSubmitOverlay={null}
      />
    );

    expect(screen.getByText("Science Score")).toBeInTheDocument();
    expect(screen.getByText("8/10")).toBeInTheDocument();
    expect(screen.getByText("80.00%")).toBeInTheDocument();
  });

  it("does not show an ACT score panel for IELTS", () => {
    render(
      <StudentPostExamView
        examType="Academic"
        isProctorTerminated={false}
        proctorNote={null}
        studentInfo={[]}
        onExit={() => undefined}
        finalSubmitOverlay={null}
      />
    );

    expect(screen.queryByText("Science Score")).not.toBeInTheDocument();
  });
});
