import { useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { StructuredContentRenderer } from "../../../exam-rendering/api/structuredContent";
import type {
  AssessmentAnsweredExam,
  AssessmentDeliverySection,
  AssessmentResult,
} from "../../contracts/assessmentDelivery";

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

export function formatScaled(score: ScaledScore): string {
  return score.low === score.high ? String(score.low) : `${score.low}–${score.high}`;
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

function percent(correct: number, total: number) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
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

/** Released classroom score report: raw section, module and domain results plus the answered-exam download. */
export function SatScoreReport({
  report,
  answered,
}: {
  report: ClassroomReport;
  answered: AnsweredExamSource | null;
}) {
  const { download, print: printAnsweredExam, paper } = useAnsweredExamPrint(answered);
  const moduleTitles = new Map<string, string>();
  for (const section of answered?.sections ?? []) {
    for (const module of section.modules)
      moduleTitles.set(`${section.sectionKey}:${module.moduleKey}`, module.title);
  }
  return (
    <>
      <section aria-label="Score report" className="mt-8 text-left print:hidden">
        {report.conversion ? (
          <div className="mb-4 rounded-2xl border border-[var(--sat-divider)] p-5 text-center">
            <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">
              Estimated total score
            </p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">
              {report.totalScaled ? formatScaled(report.totalScaled) : "Unavailable"}
            </p>
            <p className="mt-1 text-[13px] text-[var(--sat-text-secondary)]">
              {report.totalScaled
                ? "Estimated from a classroom score table, not an official SAT score."
                : "A total needs both sections with Module 1 and Module 2."}{" "}
              Converter {report.conversion.converterVersion}.
            </p>
          </div>
        ) : null}
        <div className="rounded-2xl border border-[var(--sat-divider)] p-5 text-center">
          <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">
            Total raw score
          </p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">
            {report.rawCorrect} / {report.total}
          </p>
          <p className="mt-1 text-[13px] text-[var(--sat-text-secondary)]">
            Correct operational questions. Classroom practice result, not an official SAT score.
          </p>
        </div>
        <div className={`mt-4 grid gap-4 ${report.sections.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {report.sections.map((section) => (
            <div
              key={section.sectionKey}
              className="rounded-2xl border border-[var(--sat-divider)] p-5"
            >
              <h2 className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">
                {SAT_SECTION_LABEL[section.sectionKey] ?? section.sectionKey}
              </h2>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {section.rawCorrect} / {section.total}
              </p>
              {section.conversionStatus === "converted" && isScaled(section.scaled) ? (
                <p className="mt-1 text-[14px] text-[var(--sat-text-secondary)]">
                  Estimated score{" "}
                  <span className="font-semibold tabular-nums">{formatScaled(section.scaled)}</span>
                </p>
              ) : section.conversionStatus === "unavailable" ? (
                <p className="mt-1 text-[14px] text-[var(--sat-text-secondary)]">
                  Estimated score unavailable
                </p>
              ) : null}
              {section.modules?.length ? (
                <dl className="mt-3 space-y-1 text-[14px] text-[var(--sat-text-secondary)]">
                  {section.modules.map((module) => (
                    <div key={module.moduleKey} className="flex justify-between gap-3">
                      <dt>
                        {moduleTitles.get(`${section.sectionKey}:${module.moduleKey}`) ??
                          module.moduleKey}
                      </dt>
                      <dd className="tabular-nums">
                        {module.rawCorrect} / {module.total}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ))}
        </div>
        {report.domains?.length ? (
          <div className="mt-4 rounded-2xl border border-[var(--sat-divider)] p-5">
            <h2 className="text-[16px] font-semibold">Knowledge and skills</h2>
            <p className="text-[13px] text-[var(--sat-text-secondary)]">
              Accuracy on operational questions by domain.
            </p>
            <ul className="mt-3 space-y-3">
              {report.domains.map((domain) => {
                const value = percent(domain.correct, domain.total);
                return (
                  <li key={`${domain.sectionKey}:${domain.domain}`}>
                    <div className="flex justify-between gap-3 text-[14px]">
                      <span>{domain.domain}</span>
                      <span className="tabular-nums text-[var(--sat-text-secondary)]">
                        {domain.correct} / {domain.total} · {value}%
                      </span>
                    </div>
                    <div
                      role="meter"
                      aria-label={`${domain.domain} accuracy`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={value}
                      className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--sat-divider)]"
                    >
                      <div
                        className="h-full rounded-full bg-[var(--sat-accent)]"
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {answered ? (
          <div className="mt-4 text-center">
            <button
              type="button"
              disabled={download === "preparing"}
              onClick={() => void printAnsweredExam()}
              className="sat-touch-target sat-pressable rounded-full border border-[var(--sat-divider)] px-6 text-[14px] font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
            >
              {download === "preparing"
                ? "Preparing answered exam…"
                : "Download answered exam (PDF)"}
            </button>
            {download === "failed" ? (
              <p role="alert" className="mt-2 text-[14px] text-[var(--sat-danger)]">
                Your answered exam could not be fully loaded, so no PDF was made. Check your
                connection and try again.
              </p>
            ) : (
              <p role="status" className="mt-2 text-[13px] text-[var(--sat-text-secondary)]">
                {download === "preparing"
                  ? "Loading your answers and images."
                  : "Choose “Save as PDF” in the print dialog."}
              </p>
            )}
          </div>
        ) : null}
      </section>
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
