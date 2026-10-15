import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../../domain/satCopy";
import type { AssessmentResult } from "../../../contracts/assessmentDelivery";
import { SatCompleteScreen } from "../SatCompleteScreen";
import { AnsweredExamPaper, answeredPaperReady, type AnsweredExam, type AnsweredExamSource } from "../SatScoreReport";

const text = (value: string) => ({ version: 1 as const, nodes: [{ type: "paragraph" as const, id: value, text: value }] });

/** Math Module 1 administered (q1 choice, q2 SPR, q3 unanswered, q4 unmatched choice); Module 2 never started. */
function answeredExam(): AnsweredExam {
  const base = { isPretest: false, questionType: "single_choice", stimulus: text("stim"), metadata: {}, accessibility: { longDescription: null } };
  const choices = { kind: "single_choice", options: [{ id: "o1", content: text("first") }, { id: "o2", content: text("second") }] };
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
              { ...base, examQuestionId: "q4", questionId: "q4", displayOrder: 3, prompt: text("P4"), answer: choices },
            ],
          },
          { id: "m2", moduleKey: "math-2", title: "Module 2 skipped", displayOrder: 1, questions: [] },
        ],
      },
    ],
    attempt: {
      moduleAttempts: [
        { id: "ma1", moduleId: "m1", startedAt: "2026-10-01T00:00:00Z" },
        { id: "ma2", moduleId: "m2", startedAt: null },
      ],
      responses: [
        { moduleAttemptId: "ma1", examQuestionId: "q1", response: "o2" },
        { moduleAttemptId: "ma1", examQuestionId: "q2", response: "3/4" },
        { moduleAttemptId: "ma1", examQuestionId: "q4", response: "o9" },
      ],
    },
  } as unknown as AnsweredExam;
}

/** The report's source: delivered sections title modules; the paper comes from the server projection. */
function sourceOf(exam: AnsweredExam, extra: Partial<AnsweredExamSource> = {}): AnsweredExamSource {
  return { sections: exam.sections, load: async () => exam, ...extra };
}

function result(overrides: Partial<AssessmentResult> = {}): AssessmentResult {
  return {
    id: "result-1",
    submissionId: "attempt-1",
    attemptId: "attempt-1",
    providerKey: "sat",
    outcomeStatus: "completed",
    releaseStatus: "released",
    totalScore: 1180,
    scorePayload: {},
    scoreKind: "practice",
    sections: [
      {
        sectionKey: "reading-writing",
        route: "lower",
        rawCorrect: 20,
        operationalQuestionCount: 27,
        scaledScore: 560,
        details: {},
      },
      {
        sectionKey: "math",
        route: "higher",
        rawCorrect: 22,
        operationalQuestionCount: 27,
        scaledScore: 620,
        details: {},
      },
    ],
    ...overrides,
  };
}

const reportResult = result({ scorePayload: { classroomRaw: { rawCorrect: 1, total: 4, sections: [] } } });

describe("SatCompleteScreen", () => {
  it("shows completion messaging without scores for a full sitting", () => {
    render(<SatCompleteScreen result={result()} onExit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: SAT_COPY.transitions.completeTitle })).toBeInTheDocument();
    expect(screen.getByText(SAT_COPY.transitions.completeSubtitle)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SAT_COPY.transitions.backToDashboard })).toBeInTheDocument();
    expect(screen.queryByText("1180")).not.toBeInTheDocument();
    expect(screen.queryByText("560")).not.toBeInTheDocument();
    expect(screen.queryByText("620")).not.toBeInTheDocument();
  });

  it("shows completion messaging without a score for a one-section Student Link", () => {
    render(
      <SatCompleteScreen
        result={result({
          totalScore: null,
          sections: [
            {
              sectionKey: "reading-writing",
              route: "lower",
              rawCorrect: 20,
              operationalQuestionCount: 27,
              scaledScore: 560,
              details: {},
            },
          ],
        })}
        onExit={vi.fn()}
      />,
    );

    expect(screen.getByText(SAT_COPY.transitions.completeSubtitle)).toBeInTheDocument();
    expect(screen.queryByText("560")).not.toBeInTheDocument();
    expect(screen.queryByText(/section score|practice result/i)).not.toBeInTheDocument();
  });

  it("shows completion messaging without scores when no result is available", () => {
    render(
      <SatCompleteScreen result={null} onExit={vi.fn()} />,
    );
    expect(screen.getByText(SAT_COPY.transitions.completeTitle)).toBeInTheDocument();
    expect(screen.getByText(SAT_COPY.transitions.completeSubtitle)).toBeInTheDocument();
    expect(screen.queryByText(/score/i)).not.toBeInTheDocument();
  });

  it("shows the score report only when a released classroom summary is present", () => {
    render(
      <SatCompleteScreen
        result={result({
          totalScore: null,
          sections: null,
          scorePayload: {
            classroomRaw: {
              rawCorrect: 35,
              total: 49,
              sections: [
                { sectionKey: "reading-writing", rawCorrect: 20, total: 27 },
                { sectionKey: "math", rawCorrect: 15, total: 22, modules: [{ moduleKey: "math-1", rawCorrect: 8, total: 11 }] },
              ],
              domains: [{ sectionKey: "math", domain: "Algebra", correct: 3, total: 4 }],
            },
          },
        })}
        onExit={vi.fn()}
      />,
    );
    const report = screen.getByRole("region", { name: "Score report" });
    expect(report).toHaveTextContent("35 of 49");
    expect(report).toHaveTextContent("15 of 22 scored questions correct");
    expect(report).toHaveTextContent("Module 1");
    expect(report).toHaveTextContent("Estimated SAT scores are not available for this sitting.");
    expect(screen.getByRole("meter", { name: "Algebra accuracy" })).toHaveAttribute("aria-valuenow", "75");
    expect(screen.queryByRole("button", { name: /answered exam/ })).not.toBeInTheDocument();
  });

  it("shows estimated scores from the pinned converter, a range as low–high and a total only when present", () => {
    render(
      <SatCompleteScreen
        result={result({
          scorePayload: {
            classroomRaw: {
              rawCorrect: 35,
              total: 98,
              conversion: { converterVersion: "classroom-v1", scoreType: "estimated_sat" },
              totalScaled: { low: 1100, high: 1120 },
              sections: [
                { sectionKey: "reading-writing", rawCorrect: 20, total: 54, conversionStatus: "converted", scaled: { low: 600, high: 600 } },
                { sectionKey: "math", rawCorrect: 15, total: 44, conversionStatus: "converted", scaled: { low: 500, high: 520 } },
              ],
            },
          },
        })}
        onExit={vi.fn()}
      />,
    );
    const report = screen.getByRole("region", { name: "Score report" });
    expect(report).toHaveTextContent("Estimated total SAT score1100–1120");
    expect(report).toHaveTextContent("Score scale 400–1600");
    expect(report).toHaveTextContent("Reading & Writing600");
    expect(report).toHaveTextContent("Math500–520");
    expect(report).toHaveTextContent("Conversion table version: classroom-v1");
  });

  it("never invents a number when a section's conversion is unavailable", () => {
    render(
      <SatCompleteScreen
        result={result({
          scorePayload: {
            classroomRaw: {
              rawCorrect: 9,
              total: 22,
              conversion: { converterVersion: "classroom-v1" },
              sections: [{ sectionKey: "math", rawCorrect: 9, total: 22, conversionStatus: "unavailable", topology: "m2_lower_only" }],
            },
          },
        })}
        onExit={vi.fn()}
      />,
    );
    const report = screen.getByRole("region", { name: "Score report" });
    expect(report).toHaveTextContent("An estimated SAT score is not available for this sitting.");
    expect(report).toHaveTextContent("9 of 22 scored questions correct");
    expect(report).not.toHaveTextContent(/Estimated total/);
    expect(report).not.toHaveTextContent(/\b[2-8]\d0\b/);
  });

  it("shows raw correctness, not an estimate, for a single subject without a converter", () => {
    render(
      <SatCompleteScreen
        result={result({
          scorePayload: { classroomRaw: { rawCorrect: 18, total: 22, sections: [{ sectionKey: "math", rawCorrect: 18, total: 22 }] } },
        })}
        onExit={vi.fn()}
      />,
    );
    const report = screen.getByRole("region", { name: "Score report" });
    expect(screen.getByRole("heading", { level: 1, name: "Your Math results" })).toBeInTheDocument();
    expect(report).toHaveTextContent("18 of 22 correct");
    expect(report).toHaveTextContent("An estimated SAT score is not available for this sitting.");
    expect(report).not.toHaveTextContent(/Estimated (total|Math|score)/);
    expect(report).not.toHaveTextContent(/Reading|400–1600/);
  });

  it("makes the section estimate primary for a Math-only sitting, hiding a stray total", () => {
    render(
      <SatCompleteScreen
        result={result({
          scorePayload: {
            classroomRaw: {
              rawCorrect: 34,
              total: 44,
              conversion: { converterVersion: "classroom-v1" },
              totalScaled: { low: 1200, high: 1200 },
              sections: [{ sectionKey: "math", rawCorrect: 34, total: 44, conversionStatus: "converted", scaled: { low: 620, high: 620 } }],
            },
          },
        })}
        onExit={vi.fn()}
      />,
    );
    const report = screen.getByRole("region", { name: "Score report" });
    expect(report).toHaveTextContent("Estimated Math score");
    expect(report).toHaveTextContent("620");
    expect(report).toHaveTextContent("Score scale 200–800");
    expect(report).toHaveTextContent("34 of 44 scored questions correct");
    expect(report).not.toHaveTextContent(/1200|Estimated total|400–1600/);
  });

  it("shows no estimated score without a converter", () => {
    render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Score report" })).not.toHaveTextContent(/Estimated/);
  });

  it("prints each question number with the answer only: choice letter, SPR as typed, unmatched and unanswered labelled", () => {
    const { container } = render(<AnsweredExamPaper exam={answeredExam()} generation={1} />);
    const paper = container.querySelector<HTMLElement>(".sat-answered-paper")!;
    expect(paper.dataset["complete"]).toBe("true");
    expect(paper.dataset["generation"]).toBe("1");
    expect(paper).toHaveTextContent("Module 1");
    expect(paper).not.toHaveTextContent("Module 2 skipped");
    const rows = [...paper.querySelectorAll("[data-question]")].map((row) => row.textContent);
    // A recorded choice that matches no option is reported, not silently dropped.
    expect(rows).toEqual(["Q1B", "Q23/4", "Q3Unanswered", "Q4o9 (not a listed choice)"]);
    // No question content or choices.
    expect(paper).not.toHaveTextContent(/stim|P1|first|second/);
    expect(answeredPaperReady(paper)).toBe(true);
  });

  it("prints the score report with module, total and domain counts, nothing collapsed", () => {
    render(
      <SatCompleteScreen
        result={result({
          scorePayload: {
            classroomRaw: {
              rawCorrect: 15,
              total: 22,
              sections: [{ sectionKey: "math", rawCorrect: 15, total: 22, modules: [
                { moduleKey: "math-1", rawCorrect: 8, total: 11 },
                { moduleKey: "math-2", rawCorrect: 7, total: 11 },
              ] }],
              domains: [{ sectionKey: "math", domain: "Algebra", correct: 3, total: 4 }],
            },
          },
        })}
        onExit={vi.fn()}
        answered={sourceOf(answeredExam())}
      />,
    );
    const report = screen.getByRole("region", { name: "Score report" });
    // Module counts show without expanding anything.
    expect(report.querySelector("details summary")?.textContent ?? "").not.toMatch(/Module/);
    expect(report).toHaveTextContent("8 of 11 correct");
    // The PDF download comes before the score.
    const download = screen.getByRole("button", { name: /answered exam/ });
    const score = report.querySelector("#sat-report-primary")!;
    expect(download.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const { container } = render(
      <AnsweredExamPaper
        exam={answeredExam()}
        view={{
          layout: "single-subject",
          title: "Math",
          primaryLabel: "Math",
          primaryScore: { kind: "estimated", low: 610, high: 610, scale: { min: 200, max: 800 } },
          showCombinedScore: false,
          notice: null,
          methodology: { converterVersion: "v1" },
          issues: [],
          subjects: [{
            key: "math",
            label: "Math",
            score: { kind: "estimated", low: 610, high: 610, scale: { min: 200, max: 800 } },
            rawCorrect: 15,
            rawTotal: 22,
            modules: [
              { key: "math-1", label: "Module 1", rawCorrect: 8, rawTotal: 11 },
              { key: "math-2", label: "Module 2", rawCorrect: 7, rawTotal: 11 },
            ],
            domains: [{ name: "Algebra", correct: 3, total: 4, accuracy: 75 }],
          }],
        } as never}
      />,
    );
    const paper = container.querySelector<HTMLElement>(".sat-answered-paper")!;
    expect(paper).toHaveTextContent("610");
    expect(paper).toHaveTextContent("Total correct: 15 of 22 · 68%");
    expect(paper).toHaveTextContent("Module 18 of 11 correct");
    expect(paper).toHaveTextContent("Module 27 of 11 correct");
    expect(paper).toHaveTextContent("Algebra3 of 4 · 75%");
  });

  it("says the PDF carries the score report and the answers", () => {
    render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(answeredExam())} />);
    expect(screen.getByRole("status")).toHaveTextContent("It includes your score report and answers.");
  });

  // PDF-06, Model: verification/lean/sat-result (Paper.answer_unique).
  it("keys answers by module, so a question reused across modules shows each module's own answer", () => {
    const source = answeredExam();
    const reused = source.sections[0]!.modules[0]!.questions[0]!;
    source.sections[0]!.modules[1] = { ...source.sections[0]!.modules[1]!, title: "Module 2", questions: [reused] };
    source.attempt.moduleAttempts[1] = { ...source.attempt.moduleAttempts[1]!, startedAt: "2026-10-01T00:40:00Z" };
    source.attempt.responses.push({ moduleAttemptId: "ma2", examQuestionId: "q1", response: "o1" } as never);
    const { container } = render(<AnsweredExamPaper exam={source} />);
    const [first, second] = container.querySelectorAll<HTMLElement>(".sat-answered-paper section");
    expect(first!.querySelector("[data-question='1']")).toHaveTextContent("Q1B");
    expect(second!.querySelector("[data-question='1']")).toHaveTextContent("Q1A");
  });

  it("marks the paper incomplete when an administered module is withheld or missing", () => {
    const withheld = answeredExam();
    withheld.sections[0]!.modules[1] = { ...withheld.sections[0]!.modules[1]!, contentWithheld: true };
    withheld.attempt.moduleAttempts[1] = { ...withheld.attempt.moduleAttempts[1]!, startedAt: "2026-10-01T00:40:00Z" };
    const missing = answeredExam();
    missing.sections[0]!.modules.pop();
    missing.attempt.moduleAttempts[1] = { ...missing.attempt.moduleAttempts[1]!, startedAt: "2026-10-01T00:40:00Z" };
    for (const source of [withheld, missing]) {
      const { container, unmount } = render(<AnsweredExamPaper exam={source} />);
      const paper = container.querySelector<HTMLElement>(".sat-answered-paper")!;
      expect(paper.dataset["complete"]).toBe("false");
      expect(answeredPaperReady(paper)).toBe(false);
      unmount();
    }
  });

  it("prints the server's answered-exam projection, alone, not the delivered snapshot", async () => {
    // The delivered snapshot predates the last answer (a close ack keeps old
    // responses); the projection read at download time carries it.
    const delivered = answeredExam();
    const projection = answeredExam();
    projection.attempt.responses.push({ moduleAttemptId: "ma1", examQuestionId: "q3", response: "12" } as never);
    let printedText = "";
    let isolated = false;
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      printedText = document.querySelector(".sat-answered-paper")?.textContent ?? "";
      // Portaled to <body>, where the print rule hides every other subtree.
      isolated = document.querySelector("body > .sat-answered-print > .sat-answered-paper") !== null;
    });
    render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(delivered, { load: async () => projection })} />);
    expect(document.querySelector(".sat-answered-paper")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /answered exam/ }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(printedText).toContain("12");
    expect(isolated).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    print.mockRestore();
  });

  it("runs one download at a time", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const exam = answeredExam();
    const load = vi.fn(async () => exam);
    render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(exam, { load })} />);
    const button = screen.getByRole("button", { name: /answered exam/ });
    // Two clicks in one task, before React can disable the button.
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    print.mockRestore();
  });

  it("titles each module within its own section", () => {
    const source = answeredExam();
    source.sections.unshift({
      ...source.sections[0]!,
      sectionKey: "reading-writing",
      title: "Reading and Writing",
      modules: [{ ...source.sections[0]!.modules[0]!, id: "rw1", moduleKey: "module-1", title: "RW Module 1" }],
    });
    source.sections[1]!.modules[0] = { ...source.sections[1]!.modules[0]!, moduleKey: "module-1", title: "Math Module 1" };
    render(
      <SatCompleteScreen
        result={result({
          scorePayload: {
            classroomRaw: {
              rawCorrect: 2,
              total: 4,
              sections: [
                { sectionKey: "reading-writing", rawCorrect: 1, total: 2, modules: [{ moduleKey: "module-1", rawCorrect: 1, total: 2 }] },
                { sectionKey: "math", rawCorrect: 1, total: 2, modules: [{ moduleKey: "module-1", rawCorrect: 1, total: 2 }] },
              ],
            },
          },
        })}
        onExit={vi.fn()}
        answered={sourceOf(source)}
      />,
    );
    const report = screen.getByRole("region", { name: "Score report" });
    expect(report).toHaveTextContent("RW Module 1");
    expect(report).toHaveTextContent("Math Module 1");
  });

  it("never prints when the projection cannot be read", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    // A refusal (409 not terminal, 403 report closed, 429 busy) or no projection at all.
    for (const load of [async () => Promise.reject(new Error("409")), async () => null]) {
      const { unmount } = render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(answeredExam(), { load })} />);
      fireEvent.click(screen.getByRole("button", { name: /answered exam/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent("no PDF was made");
      expect(screen.getByRole("button", { name: /answered exam/ })).toBeEnabled();
      unmount();
    }
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });

  it("shows no alert region on the completed screen", () => {
    // The unsynced-draft warning used to live here; quarantined drafts are
    // routine during finalization, so the terminal surface stays free of alert
    // regions rather than decorating a clean sitting with one.
    render(<SatCompleteScreen result={result()} onExit={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
