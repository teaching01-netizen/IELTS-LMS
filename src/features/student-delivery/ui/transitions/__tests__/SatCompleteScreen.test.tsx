import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAT_COPY } from "../../../domain/satCopy";
import type { AssessmentResult } from "../../../contracts/assessmentDelivery";
import { SatCompleteScreen } from "../SatCompleteScreen";
import { AnsweredExamPaper, answeredPaperReady, type AnsweredExam, type AnsweredExamSource } from "../SatScoreReport";
import type { PreparedAnsweredExamPdf } from "../../../api/answeredExamPdf";

const downloadBlob = vi.hoisted(() => vi.fn());
vi.mock("../../../../../utils/downloadBlob", () => ({ downloadBlob }));
beforeEach(() => {
  downloadBlob.mockClear();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});
const prepared = (): PreparedAnsweredExamPdf => ({ downloadUrl: '/api/v1/sat-answered-pdf/downloads/0123456789abcdef0123456789abcdef', filename: 'มินา - Answered exam.pdf', sizeBytes: 100, expiresAt: new Date(Date.now()+300_000).toISOString() });

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
  return { key: "student:attempt", sections: exam.sections, preparePdf: async () => prepared(), ...extra };
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

  it("prints the answer sheet and, after it, the full exam review with the student's answers marked", () => {
    const { container } = render(<AnsweredExamPaper exam={answeredExam()} generation={1} />);
    const paper = container.querySelector<HTMLElement>(".sat-answered-paper")!;
    expect(paper.dataset["complete"]).toBe("true");
    expect(paper.dataset["generation"]).toBe("1");
    const cover = paper.querySelector("[data-cover-page]");
    expect(cover).toHaveTextContent("Personal study copy");
    expect(cover?.querySelector('img[alt="Warwick Institute"]')).toBeInTheDocument();
    expect(cover).toHaveTextContent("Modules included1");
    expect(paper).toHaveTextContent("Module 1");
    expect(paper).not.toHaveTextContent("Module 2 skipped");
    // Numbered section mastheads and module labels keep the summary scannable.
    expect(paper).toHaveTextContent("Section 1: Math");
    // Every review module carries a repeating runhead: exam · section · module.
    const runheads = [...paper.querySelectorAll("[data-runhead-module]")];
    expect(runheads).toHaveLength(1);
    expect(runheads[0]).toHaveTextContent("Section 1: Math");
    expect(runheads[0]).toHaveTextContent("Module 1");
    // No exam title on the fixture: the runhead falls back to the product name.
    expect(runheads[0]).toHaveTextContent("Digital SAT");
    // The legal footer and the watermark ride every page.
    expect(paper).toHaveTextContent("LEGAL DISCLAIMER");
    expect(paper).toHaveTextContent("THB 540,000");
    expect(paper.querySelectorAll('[data-watermark="small"]')).toHaveLength(8);
    expect(paper.querySelectorAll('[data-watermark="large"]')).toHaveLength(1);
    const rows = [...paper.querySelectorAll("[data-question]")].map((row) => row.textContent);
    // A recorded choice that matches no option is reported, not silently dropped.
    expect(rows).toEqual(["Q1B", "Q23/4", "Q3Unanswered", "Q4o9 (not a listed choice)"]);

    const review = paper.querySelector<HTMLElement>("[data-review-module='m1']")!;
    expect(review).toHaveTextContent("Exam review");
    expect(review).toHaveTextContent("Correct answers are not shown");
    const articles = [...review.querySelectorAll("article")];
    expect(articles).toHaveLength(4);
    // All choices are shown; the student's choice is circled and labelled.
    const first = articles[0]!;
    expect(first).toHaveTextContent("P1");
    expect(first).toHaveTextContent("first");
    expect(first).toHaveTextContent("second");
    const selected = first.querySelector("[data-selected]");
    expect(selected?.textContent).toMatch(/B/);
    expect(selected?.querySelector('input[type="radio"]')).toBeChecked();
    expect(first.querySelectorAll("[data-selected]")).toHaveLength(1);
    // A student-produced response sits in the answer box as typed.
    expect(articles[1]).toHaveTextContent("Your answer");
    expect(articles[1]).toHaveTextContent("3/4");
    // Unanswered questions say so, in both the sheet and the review.
    expect(articles[2]).toHaveTextContent("Unanswered");
    // An unmatched recorded choice is reported, not silently dropped.
    expect(articles[3]).toHaveTextContent("matches none of the listed choices");
    // Skipped modules are not reviewed.
    expect(paper.querySelector("[data-review-module='m2']")).toBeNull();
    // No answer keys leak: the projection carries none.
    expect(paper).not.toHaveTextContent(/correct answer is/i);
    expect(answeredPaperReady(paper)).toBe(true);
  });

  it("is ready only when every review figure shows a decoded image", () => {
    const { container } = render(<AnsweredExamPaper exam={answeredExam()} />);
    const paper = container.querySelector<HTMLElement>(".sat-answered-paper")!;
    paper.dataset["complete"] = "true";
    // No figures: ready.
    expect(answeredPaperReady(paper)).toBe(true);
    const figure = paper.appendChild(document.createElement("figure"));
    expect(answeredPaperReady(paper)).toBe(false);
    const image = figure.appendChild(document.createElement("img"));
    Object.defineProperty(image, "complete", { value: true });
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 0 });
    expect(answeredPaperReady(paper)).toBe(false);
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1 });
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

  it("says the PDF carries the score report, the answers and the exam review", () => {
    render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(answeredExam())} />);
    expect(screen.getByRole("status")).toHaveTextContent("It includes your score report, answer summary, and the exam questions");
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

  it("prepares on the server without mounting another exam or downloading a Blob", async () => {
    const preparePdf = vi.fn(async () => prepared());
    render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(answeredExam(), { preparePdf })} />);
    fireEvent.click(screen.getByRole("button", { name: /answered exam/ }));
    const link = await screen.findByRole("link", { name: "Download PDF again" });
    expect(link).toHaveAttribute('href', prepared().downloadUrl);
    expect(link).toHaveAttribute('download', prepared().filename);
    expect(preparePdf).toHaveBeenCalledWith({ view: expect.any(Object) }, expect.any(AbortSignal));
    expect(document.querySelector('.sat-answered-paper')).toBeNull();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("keeps preparation failures and retry on the report", async () => {
    const preparePdf = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce(prepared());
    render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(answeredExam(), { preparePdf })} />);
    fireEvent.click(screen.getByRole("button", { name: /answered exam/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no PDF was made');
    fireEvent.click(screen.getByRole("button", { name: /answered exam/ }));
    expect(await screen.findByRole('link', { name: 'Download PDF again' })).toBeInTheDocument();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("runs one preparation at a time", async () => {
    const preparePdf = vi.fn(async () => prepared());
    render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(answeredExam(), { preparePdf })} />);
    const button = screen.getByRole("button", { name: /answered exam/ });
    act(() => { button.click(); button.click(); });
    await screen.findByRole('link', { name: 'Download PDF again' });
    expect(preparePdf).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it("cancels preparation on unmount and ignores its late response", async () => {
    let resolve!: (value: PreparedAnsweredExamPdf) => void;
    let signal: AbortSignal | undefined;
    const preparePdf: AnsweredExamSource['preparePdf'] = (_body, inputSignal) => { signal = inputSignal; return new Promise(r => { resolve = r; }); };
    const { unmount } = render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(answeredExam(), { preparePdf })} />);
    fireEvent.click(screen.getByRole("button", { name: /answered exam/ }));
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(prepared()); });
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("cancels a previous student's preparation when the report identity changes", async () => {
    let resolve!: (value: PreparedAnsweredExamPdf) => void;
    let signal: AbortSignal | undefined;
    const preparePdf: AnsweredExamSource['preparePdf'] = (_body, inputSignal) => { signal = inputSignal; return new Promise(r => { resolve = r; }); };
    const { rerender } = render(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(answeredExam(), { preparePdf })} />);
    fireEvent.click(screen.getByRole("button", { name: /answered exam/ }));
    rerender(<SatCompleteScreen result={reportResult} onExit={vi.fn()} answered={sourceOf(answeredExam(), { key: 'student:another-attempt' })} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(prepared()); });
    expect(screen.queryByRole('link', { name: 'Download PDF again' })).not.toBeInTheDocument();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /answered exam/ })).toBeEnabled();
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

  it("shows no alert region on the completed screen", () => {
    // The unsynced-draft warning used to live here; quarantined drafts are
    // routine during finalization, so the terminal surface stays free of alert
    // regions rather than decorating a clean sitting with one.
    render(<SatCompleteScreen result={result()} onExit={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
