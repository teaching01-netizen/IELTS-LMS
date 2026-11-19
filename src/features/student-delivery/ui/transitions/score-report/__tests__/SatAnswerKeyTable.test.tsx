import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnsweredExamPaper, type AnsweredExam } from "../../SatScoreReport";

const text = (value: string) => ({
  version: 1 as const,
  nodes: [{ type: "paragraph" as const, id: value, text: value }],
});

/** One administered Math module: q1 choice, q2 student-produced, q3 unanswered. */
function answeredExam(): AnsweredExam {
  const base = {
    isPretest: false,
    questionType: "single_choice",
    stimulus: text("stim"),
    metadata: {},
    accessibility: { longDescription: null },
  };
  const choices = {
    kind: "single_choice",
    options: [
      { id: "o1", content: text("first") },
      { id: "o2", content: text("second") },
    ],
  };
  return {
    sections: [
      {
        sectionKey: "math",
        title: "Math",
        modules: [
          {
            id: "m1",
            moduleKey: "math-1",
            title: "Module 1",
            displayOrder: 0,
            questions: [
              { ...base, examQuestionId: "q1", questionId: "q1", displayOrder: 0, prompt: text("P1"), answer: choices },
              { ...base, examQuestionId: "q2", questionId: "q2", displayOrder: 1, prompt: text("P2"), answer: { kind: "student_produced_response" } },
              { ...base, examQuestionId: "q3", questionId: "q3", displayOrder: 2, prompt: text("P3"), answer: { kind: "student_produced_response" } },
            ],
          },
        ],
      },
    ],
    attempt: {
      moduleAttempts: [{ id: "ma1", moduleId: "m1", startedAt: "2026-10-01T00:00:00Z" }],
      responses: [
        { moduleAttemptId: "ma1", examQuestionId: "q1", response: "o2" },
        { moduleAttemptId: "ma1", examQuestionId: "q2", response: "0.5" },
      ],
    },
  } as unknown as AnsweredExam;
}

const AUTHORIZED_KEY = {
  available: true,
  entries: [
    {
      moduleId: "m1",
      examQuestionId: "q1",
      correctAnswers: [{ label: "A", text: "first" }],
      result: "incorrect",
    },
    {
      moduleId: "m1",
      examQuestionId: "q2",
      correctAnswers: [
        { label: "", text: "1/2" },
        { label: "", text: "0.5" },
      ],
      result: "correct",
    },
    {
      moduleId: "m1",
      examQuestionId: "q3",
      correctAnswers: [{ label: "", text: "12" }],
      result: "unanswered",
    },
  ],
} as const;

describe("answered-exam answer key table", () => {
  it("prints the server's correct answers and result for every question", () => {
    const { container } = render(<AnsweredExamPaper exam={answeredExam()} answerKey={AUTHORIZED_KEY} />);
    const paper = container.querySelector<HTMLElement>(".sat-answered-paper")!;
    const key = paper.querySelector<HTMLElement>('[data-answer-key="true"]');

    expect(key).not.toBeNull();
    expect(key).toHaveTextContent("Answer key");
    expect(key).toHaveTextContent("QuestionYour answerCorrect answer(s)Result");
    const row = (id: string) => key!.querySelector<HTMLElement>(`[data-key-question="${id}"]`);
    expect(row("q1")).toHaveTextContent("Q1BA. firstIncorrect");
    // Multiple accepted student-produced representations are printed verbatim.
    expect(row("q2")).toHaveTextContent("Q20.51/2 or 0.5Correct");
    expect(row("q3")).toHaveTextContent("Q3Unanswered12Unanswered");
  });

  it("marks the correct answer and result on each review page from server data", () => {
    const { container } = render(<AnsweredExamPaper exam={answeredExam()} answerKey={AUTHORIZED_KEY} />);
    const review = container.querySelector<HTMLElement>("[data-review-module='m1']")!;
    const articles = [...review.querySelectorAll("article")];

    expect(review).toHaveTextContent("The correct answer for each question is shown");
    expect(articles[0]).toHaveTextContent("Your answer: B");
    expect(articles[0]).toHaveTextContent("Correct answer: A. first");
    expect(articles[0]).toHaveTextContent("Result: Incorrect");
    expect(articles[0]!.querySelector('[data-key-result="incorrect"]')).not.toBeNull();
    expect(articles[1]).toHaveTextContent("Correct answer: 1/2 or 0.5");
    expect(articles[1]).toHaveTextContent("Result: Correct");
    expect(articles[2]).toHaveTextContent("Result: Unanswered");
  });

  it("keeps the answer-only report when no key projection is supplied", () => {
    const { container } = render(<AnsweredExamPaper exam={answeredExam()} />);
    const paper = container.querySelector<HTMLElement>(".sat-answered-paper")!;
    const review = paper.querySelector<HTMLElement>("[data-review-module='m1']")!;

    expect(paper.querySelector('[data-answer-key="true"]')).toBeNull();
    expect(review).toHaveTextContent("Correct answers are not shown");
    expect(review).not.toHaveTextContent("Correct answer:");
    expect(review).not.toHaveTextContent("Result:");
  });

  it("falls back to the answer-only report when the server did not authorize keys", () => {
    const { container } = render(
      <AnsweredExamPaper
        exam={answeredExam()}
        answerKey={{ ...AUTHORIZED_KEY, available: false }}
      />
    );
    const paper = container.querySelector<HTMLElement>(".sat-answered-paper")!;

    expect(paper.querySelector('[data-answer-key="true"]')).toBeNull();
    expect(paper.querySelector("[data-review-module='m1']")).toHaveTextContent(
      "Correct answers are not shown"
    );
  });

  it("keeps the answer-only report when every key row is outside the administered modules", () => {
    const { container } = render(
      <AnsweredExamPaper
        exam={answeredExam()}
        answerKey={{
          available: true,
          entries: [{ ...AUTHORIZED_KEY.entries[0]!, moduleId: "m2" }],
        }}
      />
    );
    const paper = container.querySelector<HTMLElement>(".sat-answered-paper")!;

    expect(paper.dataset["answerKeyMode"]).toBe("answer-only");
    expect(paper.querySelector('[data-answer-key="true"]')).toBeNull();
    expect(paper.querySelector("[data-review-module='m1']")).toHaveTextContent(
      "Correct answers are not shown"
    );
  });

  it("never fabricates a result for a question the key projection omits or mis-scopes", () => {
    const { container } = render(
      <AnsweredExamPaper
        exam={answeredExam()}
        answerKey={{
          available: true,
          entries: [
            AUTHORIZED_KEY.entries[0]!,
            // Same question id under the module that was never administered.
            { ...AUTHORIZED_KEY.entries[1]!, moduleId: "m2" },
          ],
        }}
      />
    );
    const key = container.querySelector<HTMLElement>('[data-answer-key="true"]')!;
    const row = (id: string) => key.querySelector<HTMLElement>(`[data-key-question="${id}"]`);

    expect(row("q1")).toHaveTextContent("A. first");
    expect(row("q2")).toHaveTextContent("Not available");
    expect(row("q2")).toHaveTextContent("—");
    expect(row("q3")).toHaveTextContent("Not available");
    const review = container.querySelector<HTMLElement>("[data-review-module='m1']")!;
    const articles = [...review.querySelectorAll("article")];
    expect(articles[1]).not.toHaveTextContent("Correct answer:");
    expect(articles[2]).not.toHaveTextContent("Result:");
  });
});
