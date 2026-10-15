import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import type {
  AssessmentAnsweredExam,
  AssessmentDeliverySection,
  AssessmentResult,
} from "../../contracts/assessmentDelivery";
import { logWarn } from "../../../../shared/observability/errorLogger";
import { SatKnowledgeSkills } from "./score-report/SatKnowledgeSkills";
import { SatReportActions, SatReportDownload } from "./score-report/SatReportActions";
import { SatReportHeader } from "./score-report/SatReportHeader";
import { SatReportMethodology } from "./score-report/SatReportMethodology";
import { formatRange, SatScoreOverview } from "./score-report/SatScoreOverview";
import { SatSubjectPerformance } from "./score-report/SatSubjectPerformance";
import {
  buildStudentScoreReportView,
  type ScoreDisplay,
  type StudentScoreReportView,
} from "./score-report/scoreReportViewModel";

/** An estimated 200–800 section (or 400–1600 total) score; a range when low < high. */
export interface ScaledScore {
  low: number;
  high: number;
}

export interface ClassroomReport {
  rawCorrect: number;
  total: number;
  sections: {
    sectionKey: string;
    rawCorrect: number;
    total: number;
    modules?: { moduleKey: string; rawCorrect: number; total: number }[];
    /** Present only when the exam version has a converter. */
    conversionStatus?: "converted" | "unavailable";
    scaled?: ScaledScore;
  }[];
  domains?: { sectionKey: string; domain: string; correct: number; total: number }[];
  /** The converter the server scored with; absent = raw scores only. */
  conversion?: { converterVersion: string };
  /** Only when both sections converted from full two-module routes. */
  totalScaled?: ScaledScore;
}

export const SAT_SECTION_LABEL: Record<string, string> = {
  "reading-writing": "Reading and Writing",
  math: "Math",
};
const CHOICE_LETTERS = "ABCDEFGHIJ";

/** The server only releases this key when the exam's score report is on; anything else is not rendered. */
export function classroomReport(result: AssessmentResult | null): ClassroomReport | null {
  const raw = result?.releaseStatus === "released" ? result.scorePayload?.["classroomRaw"] : null;
  if (!raw || typeof raw !== "object") return null;
  const { rawCorrect, total, sections, domains, conversion, totalScaled } =
    raw as Partial<ClassroomReport>;
  if (typeof rawCorrect !== "number" || typeof total !== "number" || !Array.isArray(sections))
    return null;
  return {
    rawCorrect,
    total,
    sections,
    ...(Array.isArray(domains) ? { domains } : {}),
    ...(typeof conversion?.converterVersion === "string" ? { conversion } : {}),
    ...(isScaled(totalScaled) ? { totalScaled } : {}),
  };
}

function isScaled(value: unknown): value is ScaledScore {
  const score = value as ScaledScore | null | undefined;
  return typeof score?.low === "number" && typeof score.high === "number";
}

/** What the paper prints from the server's answered-exam projection. */
export type AnsweredExam = Pick<AssessmentAnsweredExam, "sections" | "attempt"> &
  Partial<Pick<AssessmentAnsweredExam, "examTitle" | "candidateName">>;

export interface AnsweredExamPrintSource {
  /** One authoritative read of the projection; null when it could not be loaded. */
  load: () => Promise<AnsweredExam | null>;
}

export interface AnsweredExamSource extends AnsweredExamPrintSource {
  /** The delivered sections, used only to title the report's modules. */
  sections: AssessmentDeliverySection[];
}

// offcut: readiness is polled; a paper not mounted within 30 s fails closed with a retry
const PAPER_READY_TIMEOUT_MS = 30_000;
const PAPER_READY_POLL_MS = 100;

/**
 * PDF-10: the paper may print only when every administered module is present
 * with its content. The paper prints no figures, so PDF-10's figure clause
 * holds vacuously.
 */
export function answeredPaperReady(paper: HTMLElement): boolean {
  return paper.dataset["complete"] === "true";
}

/**
 * Print orchestration shared by the student report and the staff result view:
 * load the projection, mount the paper, print only once it is complete
 * (PDF-10). Model: verification/lean/sat-result (PrintGate.print_gate_sound).
 */
export function useAnsweredExamPrint(
  source: AnsweredExamPrintSource | null,
  view?: StudentScoreReportView | null
): {
  download: "idle" | "preparing" | "failed";
  print: () => Promise<void>;
  paper: ReactNode;
} {
  const [download, setDownload] = useState<"idle" | "preparing" | "failed">("idle");
  // The paper mounts on request only. A new generation remounts it, so a
  // retry re-reads the answers.
  const [loaded, setLoaded] = useState<{ exam: AnsweredExam; generation: number } | null>(null);
  const generationRef = useRef(0);
  const paperRef = useRef<HTMLDivElement | null>(null);
  // One download in flight: a second flow would remount the paper under the
  // first one's poll and report a false failure.
  const inFlight = useRef(false);

  const print = async () => {
    if (!source || inFlight.current) return;
    inFlight.current = true;
    setDownload("preparing");
    try {
      const exam = await source.load().catch(() => null);
      if (!exam) {
        setDownload("failed");
        return;
      }
      const generation = ++generationRef.current;
      setLoaded({ exam, generation });
      const deadline = Date.now() + PAPER_READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, PAPER_READY_POLL_MS));
        const paper = paperRef.current;
        if (paper?.dataset["generation"] === String(generation) && answeredPaperReady(paper)) {
          setDownload("idle");
          window.print();
          return;
        }
      }
      setDownload("failed");
    } finally {
      inFlight.current = false;
    }
  };
  // Portaled to <body>: printing then shows only the paper, whatever page
  // chrome or overflow container hosts the button (index.css).
  const paper =
    source && loaded
      ? createPortal(
          <div className="sat-answered-print">
            <AnsweredExamPaper
              key={loaded.generation}
              exam={loaded.exam}
              view={view}
              generation={loaded.generation}
              paperRef={paperRef}
            />
          </div>,
          document.body
        )
      : null;
  return { download, print, paper };
}

/**
 * Released classroom score report, laid out from the subjects actually sat
 * (see score-report/scoreReportViewModel). Also hosts the answered-exam download.
 */
export function SatScoreReport({
  report,
  answered,
  onExit,
}: {
  report: ClassroomReport;
  answered: AnsweredExamSource | null;
  onExit: () => void | Promise<void>;
}) {
  const view = useMemo(
    () => buildStudentScoreReportView(report, answered?.sections),
    [report, answered?.sections]
  );
  const { download, print: printAnsweredExam, paper } = useAnsweredExamPrint(answered, view);
  const issues = view.issues.join(",");
  useEffect(() => {
    // Codes only: nothing here identifies the student.
    if (issues) logWarn("SAT score report contained invalid data", { issues });
  }, [issues]);
  return (
    <>
      <div className="sat-ui min-h-[100dvh] bg-[var(--sat-background)] pl-[calc(1rem+var(--student-safe-left))] pr-[calc(1rem+var(--student-safe-right))] pt-[calc(2rem+var(--student-safe-top))] pb-[calc(3rem+var(--student-safe-bottom))] text-[var(--sat-text)] sm:pl-[calc(1.5rem+var(--student-safe-left))] sm:pr-[calc(1.5rem+var(--student-safe-right))] print:hidden">
        <main className="mx-auto w-full max-w-[920px]">
          <section aria-label="Score report">
            <SatReportHeader title={view.title} />
            <SatReportDownload
              canPrint={answered !== null}
              download={download}
              onPrint={() => void printAnsweredExam()}
            />
            <div className="mt-6">
              <SatScoreOverview view={view} />
            </div>
            <SatSubjectPerformance view={view} />
            <SatKnowledgeSkills subjects={view.subjects} />
            <SatReportMethodology methodology={view.methodology} />
            <SatReportActions onExit={() => void onExit()} />
          </section>
        </main>
      </div>
      {paper}
    </>
  );
}


function percent(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

function printedScore(score: ScoreDisplay): string {
  if (score.kind === "estimated") return formatRange(score.low, score.high);
  if (score.kind === "raw") return `${score.correct} of ${score.total} correct`;
  return score.display === "dash" ? "-" : score.reason;
}

/** The score report as printed: every count visible, nothing collapsed. */
function PaperScoreSummary({ view }: { view: StudentScoreReportView }) {
  const correct = view.subjects.reduce((sum, subject) => sum + subject.rawCorrect, 0);
  const total = view.subjects.reduce((sum, subject) => sum + subject.rawTotal, 0);
  return (
    <section className="mt-4">
      {view.primaryScore ? (
        <div>
          {view.primaryLabel ? <p className="text-[12px] font-semibold">{view.primaryLabel}</p> : null}
          <p className="text-[28px] font-semibold tabular-nums">{printedScore(view.primaryScore)}</p>
          {view.primaryScore.kind === "estimated" ? (
            <p className="text-[11px]">
              Score scale {view.primaryScore.scale.min}–{view.primaryScore.scale.max} · Estimated using a classroom
              score conversion table. Not an official SAT score.
            </p>
          ) : null}
        </div>
      ) : null}
      {view.notice ? <p className="mt-1 text-[11px]">{view.notice}</p> : null}
      <p className="mt-2 text-[13px] font-semibold tabular-nums">
        Total correct: {correct} of {total} · {percent(correct, total)}%
      </p>
      <div className="mt-3 grid grid-cols-2 gap-4">
        {view.subjects.map((subject) => (
          <div key={subject.key} className="break-inside-avoid border border-black p-3 text-[12px]">
            <h3 className="text-[14px] font-semibold">{subject.label}</h3>
            {view.subjects.length > 1 ? (
              <p className="tabular-nums">Score: {printedScore(subject.score)}</p>
            ) : null}
            <p className="tabular-nums">
              Correct: {subject.rawCorrect} of {subject.rawTotal} · {percent(subject.rawCorrect, subject.rawTotal)}%
            </p>
            {subject.modules.length ? (
              <dl className="mt-2 border-t border-neutral-400 pt-1">
                {subject.modules.map((module) => (
                  <div key={module.key} className="flex justify-between gap-2">
                    <dt>{module.label}</dt>
                    <dd className="tabular-nums">
                      {module.rawCorrect} of {module.rawTotal} correct
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {subject.domains.length ? (
              <dl className="mt-2 border-t border-neutral-400 pt-1">
                {subject.domains.map((domain) => (
                  <div key={domain.name} className="flex justify-between gap-2">
                    <dt>{domain.name}</dt>
                    <dd className="shrink-0 tabular-nums">
                      {domain.accuracy === null
                        ? "No scored questions"
                        : `${domain.correct} of ${domain.total} · ${domain.accuracy}%`}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Print-only answer sheet: the score report (when one is given) and, per
 * administered module, each question number with the student's saved answer —
 * a choice as its letter, a student-produced response as typed. No question
 * content and no correct answers are printed. `data-complete` is false when an
 * administered module is missing or withheld, so the paper never prints without it.
 */
export function AnsweredExamPaper({
  exam,
  view,
  generation,
  paperRef,
}: {
  exam: AnsweredExam;
  view?: StudentScoreReportView | null | undefined;
  generation?: number;
  paperRef?: Ref<HTMLDivElement>;
}) {
  const moduleIdByAttempt = new Map<string, string>();
  const administered = new Set<string>();
  for (const attempt of exam.attempt.moduleAttempts) {
    moduleIdByAttempt.set(attempt.id, attempt.moduleId);
    if (attempt.startedAt) administered.add(attempt.moduleId);
  }
  const printable = new Set<string>();
  for (const section of exam.sections) {
    for (const module of section.modules)
      if (administered.has(module.id) && module.contentWithheld !== true) printable.add(module.id);
  }
  const complete = printable.size === administered.size;
  const answers = new Map<string, string>();
  for (const response of exam.attempt.responses) {
    const moduleId = moduleIdByAttempt.get(response.moduleAttemptId);
    const value =
      typeof response.response === "string" || typeof response.response === "number"
        ? String(response.response).trim()
        : "";
    if (moduleId && value) answers.set(`${moduleId}:${response.examQuestionId}`, value);
  }
  return (
    <div
      ref={paperRef}
      className="sat-answered-paper hidden bg-white text-left text-black print:block"
      aria-hidden="true"
      data-complete={complete}
      data-generation={generation}
    >
      <header className="border-b-2 border-black pb-2">
        <p className="text-[12px] font-semibold">Digital SAT · Score report</p>
        {exam.examTitle ? <h1 className="text-[18px] font-semibold">{exam.examTitle}</h1> : null}
        {exam.candidateName ? <p className="text-[13px]">{exam.candidateName}</p> : null}
      </header>
      {view ? <PaperScoreSummary view={view} /> : null}
      {exam.sections.map((section) =>
        [...section.modules]
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .filter((module) => printable.has(module.id))
          .map((module) => (
            <section key={module.id} className="mt-5 break-inside-avoid">
              <h2 className="border-b border-black pb-1 text-[14px] font-semibold">
                {SAT_SECTION_LABEL[section.sectionKey] ?? section.title} · {module.title}
              </h2>
              <ol className="mt-2 grid grid-cols-4 gap-x-4 gap-y-1 text-[12px]">
                {[...module.questions]
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((question, index) => {
                    const answer = answers.get(`${module.id}:${question.examQuestionId}`) ?? null;
                    const choice =
                      answer !== null && question.answer.kind === "single_choice"
                        ? question.answer.options.findIndex((option) => option.id === answer)
                        : null;
                    return (
                      <li
                        key={question.examQuestionId}
                        className="flex gap-2 border-b border-neutral-300 py-0.5"
                        data-question={index + 1}
                      >
                        <span className="w-8 shrink-0 font-semibold tabular-nums">Q{index + 1}</span>
                        {answer === null ? (
                          <span className="italic">Unanswered</span>
                        ) : choice === null ? (
                          <span className="font-semibold [overflow-wrap:anywhere]">{answer}</span>
                        ) : choice >= 0 ? (
                          <span className="font-semibold">{CHOICE_LETTERS[choice] ?? choice + 1}</span>
                        ) : (
                          <span className="italic [overflow-wrap:anywhere]">{answer} (not a listed choice)</span>
                        )}
                      </li>
                    );
                  })}
              </ol>
            </section>
          ))
      )}
    </div>
  );
}
