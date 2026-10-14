import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";
import type {
  AssessmentAnsweredExam,
  AssessmentDeliverySection,
  AssessmentResult,
} from "../../contracts/assessmentDelivery";
import { logWarn } from "../../../../shared/observability/errorLogger";
import { SatKnowledgeSkills } from "./score-report/SatKnowledgeSkills";
import { SatReportActions } from "./score-report/SatReportActions";
import { SatReportHeader } from "./score-report/SatReportHeader";
import { SatReportMethodology } from "./score-report/SatReportMethodology";
import { SatScoreOverview } from "./score-report/SatScoreOverview";
import { SatSubjectPerformance } from "./score-report/SatSubjectPerformance";
import { buildStudentScoreReportView } from "./score-report/scoreReportViewModel";

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
export type AnsweredExam = Pick<AssessmentAnsweredExam, "sections" | "attempt">;

export type LoadMediaUrl = (
  assetId: string,
  options?: { fresh?: boolean }
) => Promise<string | null>;

export interface AnsweredExamPrintSource {
  /** One authoritative read of the projection; null when it could not be loaded. */
  load: () => Promise<AnsweredExam | null>;
  loadMediaUrl?: LoadMediaUrl | undefined;
}

export interface AnsweredExamSource extends AnsweredExamPrintSource {
  /** The delivered sections, used only to title the report's modules. */
  sections: AssessmentDeliverySection[];
}

// offcut: readiness is polled; an exam whose figures need over 30 s fails closed with a retry
const PAPER_READY_TIMEOUT_MS = 30_000;
const PAPER_READY_POLL_MS = 100;

/**
 * PDF-10: the paper may print only when every administered module is present
 * with its content and every figure shows a decoded image. Anything else
 * would be an incomplete PDF.
 */
export function answeredPaperReady(paper: HTMLElement): boolean {
  if (paper.dataset["complete"] !== "true") return false;
  return [...paper.querySelectorAll("figure")].every((figure) => {
    const image = figure.querySelector("img");
    return image !== null && image.complete && image.naturalWidth > 0;
  });
}

/**
 * Print orchestration shared by the student report and the staff result view:
 * load the projection, mount the paper, print only once it is complete
 * (PDF-10). Model: verification/lean/sat-result (PrintGate.print_gate_sound).
 */
export function useAnsweredExamPrint(source: AnsweredExamPrintSource | null): {
  download: "idle" | "preparing" | "failed";
  print: () => Promise<void>;
  paper: ReactNode;
} {
  const [download, setDownload] = useState<"idle" | "preparing" | "failed">("idle");
  // The paper mounts on request only: it loads every figure of the exam.
  // A new generation remounts it, so a retry re-reads answers and media.
  const [loaded, setLoaded] = useState<{ exam: AnsweredExam; generation: number } | null>(null);
  const generationRef = useRef(0);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const mediaFailed = useRef(false);
  // One download in flight: a second flow would remount the paper under the
  // first one's poll and report a false failure.
  const inFlight = useRef(false);

  const print = async () => {
    if (!source || inFlight.current) return;
    inFlight.current = true;
    setDownload("preparing");
    mediaFailed.current = false;
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
        if (mediaFailed.current) break;
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
              loadMediaUrl={source.loadMediaUrl}
              generation={loaded.generation}
              paperRef={paperRef}
              onMediaFailure={() => {
                mediaFailed.current = true;
              }}
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
  const { download, print: printAnsweredExam, paper } = useAnsweredExamPrint(answered);
  const view = useMemo(
    () => buildStudentScoreReportView(report, answered?.sections),
    [report, answered?.sections]
  );
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
            <div className="mt-6">
              <SatScoreOverview view={view} />
            </div>
            <SatSubjectPerformance view={view} />
            <SatKnowledgeSkills subjects={view.subjects} />
            <SatReportMethodology methodology={view.methodology} />
            <SatReportActions
              canPrint={answered !== null}
              download={download}
              onPrint={() => void printAnsweredExam()}
              onExit={() => void onExit()}
            />
          </section>
        </main>
      </div>
      {paper}
    </>
  );
}

/**
 * Print-only paper of the administered questions with the student's saved
 * answers: the selected choice is circled (matched by option id), a
 * student-produced response is boxed, a recorded choice that matches no listed
 * option is printed as such, and unanswered questions say so. Correct answers
 * are never shown. `data-complete` is false when an administered module is
 * missing or withheld, so the paper never prints without it.
 */
export function AnsweredExamPaper({
  exam,
  loadMediaUrl,
  onMediaFailure,
  generation,
  paperRef,
}: {
  exam: AnsweredExam;
  loadMediaUrl?: LoadMediaUrl | undefined;
  onMediaFailure?: () => void;
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
  const mediaFailure = onMediaFailure ? () => onMediaFailure() : undefined;
  return (
    <div
      ref={paperRef}
      className="sat-answered-paper hidden bg-white text-left text-black print:block"
      aria-hidden="true"
      data-complete={complete}
      data-generation={generation}
    >
      {exam.sections.map((section) =>
        [...section.modules]
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .filter((module) => printable.has(module.id))
          .map((module) => (
            <section key={module.id} className="break-before-page">
              <h2 className="border-b border-black pb-2 text-[16px] font-semibold">
                {SAT_SECTION_LABEL[section.sectionKey] ?? section.title} · {module.title}
              </h2>
              {[...module.questions]
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((question, index) => {
                  const answer = answers.get(`${module.id}:${question.examQuestionId}`) ?? null;
                  const unmatched =
                    answer !== null &&
                    question.answer.kind === "single_choice" &&
                    !question.answer.options.some((option) => option.id === answer);
                  return (
                    <article
                      key={question.examQuestionId}
                      className="break-inside-avoid border-b border-neutral-300 py-4"
                    >
                      <h3 className="text-[14px] font-semibold">Question {index + 1}</h3>
                      <StructuredContentRenderer
                        content={question.stimulus}
                        className="mt-2 text-[13px]"
                        loadMediaUrl={loadMediaUrl}
                        onMediaFailure={mediaFailure}
                        questionId={question.examQuestionId}
                        eagerMedia
                      />
                      <StructuredContentRenderer
                        content={question.prompt}
                        className="mt-2 text-[13px]"
                        loadMediaUrl={loadMediaUrl}
                        onMediaFailure={mediaFailure}
                        questionId={question.examQuestionId}
                        eagerMedia
                      />
                      {question.answer.kind === "single_choice" ? (
                        <ol className="mt-2 space-y-1.5">
                          {question.answer.options.map((option, optionIndex) => {
                            const selected = answer === option.id;
                            return (
                              <li
                                key={option.id}
                                className="flex items-start gap-2 text-[13px]"
                                data-selected={selected || undefined}
                              >
                                <span
                                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${selected ? "border-2 border-black" : "border border-transparent"}`}
                                >
                                  {CHOICE_LETTERS[optionIndex] ?? optionIndex + 1}
                                </span>
                                <StructuredContentRenderer
                                  content={option.content}
                                  loadMediaUrl={loadMediaUrl}
                                  onMediaFailure={mediaFailure}
                                  questionId={question.examQuestionId}
                                  eagerMedia
                                />
                              </li>
                            );
                          })}
                        </ol>
                      ) : (
                        <p className="mt-2 text-[13px]">
                          Your answer:{" "}
                          {answer ? (
                            <span className="inline-block min-w-16 border-2 border-black px-2 py-0.5 font-semibold">
                              {answer}
                            </span>
                          ) : null}
                        </p>
                      )}
                      {unmatched ? (
                        <p className="mt-2 text-[12px] italic">
                          Recorded answer “{answer}” matches none of the listed choices.
                        </p>
                      ) : null}
                      {answer ? null : <p className="mt-2 text-[12px] italic">Unanswered</p>}
                    </article>
                  );
                })}
            </section>
          ))
      )}
    </div>
  );
}
