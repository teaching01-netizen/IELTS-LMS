/* eslint-disable jsx-a11y/control-has-associated-label -- Presentational, aria-hidden print tables use rows and cells for native page repetition. */
import { Fragment, useEffect, useMemo, type ReactNode, type Ref } from "react";
import "./score-report/sat-answered-paper.css";
import warwickWatermark from "../../../../assets/warwick-institute-logo.png";
import { SatPrintedQuestion } from "./score-report/SatPrintedQuestion";
import type {
  AssessmentAnsweredExam,
  AssessmentDeliverySection,
  AssessmentResult,
  SATRecoveryResolutionReceipt,
} from "../../contracts/assessmentDelivery";
import { pdfTargetKey, type PdfSide, type PdfTarget, type ResolvedPdfLayout } from "@shared/sat/pdfLayout";
import type { SatAttemptLearning } from "@shared/sat/learningPolicy";
import { logWarn } from "../../../../shared/observability/errorLogger";
import { SatKnowledgeSkills } from "./score-report/SatKnowledgeSkills";
import { useAnsweredExamDownload, type AnsweredExamDownloadSource } from "./score-report/useAnsweredExamDownload";
import { SatReportActions, SatReportDownload } from "./score-report/SatReportActions";
import { SatReportHeader } from "./score-report/SatReportHeader";
import { SatReportMethodology } from "./score-report/SatReportMethodology";
import { formatRange, SatScoreOverview } from "./score-report/SatScoreOverview";
import { SatSubjectPerformance } from "./score-report/SatSubjectPerformance";
import {
  answerKeyIndex,
  SatAnswerKeyTable,
} from "./score-report/SatAnswerKeyTable";
import {
  buildStudentScoreReportView,
  studyAssistanceLabels,
  type ScoreDisplay,
  type SatAttemptMode,
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
  /**
   * The admitted delivery mode from the server's attempt learning snapshot.
   * Absent metadata is a legacy Test attempt; the client never chooses a mode.
   */
  mode?: SatAttemptMode;
  /** The admitted Study capabilities exactly as the server sent them. */
  learning?: SatAttemptLearning;
}

export const SAT_SECTION_LABEL: Record<string, string> = {
  "reading-writing": "Reading and Writing",
  math: "Math",
};
const CHOICE_LETTERS = "ABCDEFGHIJ";

/**
 * Institution legal copy printed at the foot of every page of the
 * answered-exam PDF. The table footer group reserves the exact same space
 * as the running notice, including on short final pages.
 */
export const ANSWERED_EXAM_LEGAL_FOOTER =
  'LEGAL DISCLAIMER: All contents contained herein (the "Materials") is the exclusive property of Warwick Institute and has been protected by all applicable intellectual property or copyright laws. The Materials are provided strictly and solely for the use of students who are duly enrolled at Warwick Institute for the specific academic cycle in which such Materials are issued. Under no circumstances may the Materials be reproduced, copied, distributed, transmitted, published, disclosed, or otherwise disseminated, in whole or in part, to any individual not enrolled in the same course or academic level, or to any external party outside Warwick Institute, without any prior written consent. Any student who violates these terms and conditions shall be subject to immediate and irrevocable termination of enrollment at Warwick Institute. The student\u2019s W code shall be revoked without delay, and all tuition fees and related expenses paid to Warwick Institute shall be forfeited in full, without refund under any circumstances. Furthermore, any such breaching individual shall be liable to pay compensation at the amount no less than THB 540,000, in addition to any further damages, legal actions, or remedies to which Warwick Institute is entitled under applicable laws.';

/** The server only releases this key when the exam's score report is on; anything else is not rendered. */
export function classroomReport(result: AssessmentResult | null): ClassroomReport | null {
  const raw = result?.releaseStatus === "released" ? result.scorePayload?.["classroomRaw"] : null;
  return classroomReportFromRaw(raw);
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalize a server `classroomRaw` payload. The admitted mode is
 * read only when the server sent one; every other shape stays a legacy Test.
 * Capabilities are never inferred: they are true only when the server sent the
 * literal `true`, and a Test attempt always binds none.
 */
export function readSatAttemptLearning(value: unknown): SatAttemptLearning | null {
  if (!isRecordValue(value)) return null;
  const mode = value["mode"];
  if (mode !== "test" && mode !== "study") return null;
  const revision = value["policyRevision"];
  const policyRevision =
    typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  const capabilities = isRecordValue(value["capabilities"]) ? value["capabilities"] : {};
  return {
    mode,
    policyRevision,
    capabilities: {
      revealAnswers: mode === "study" && capabilities["revealAnswers"] === true,
      untimed: mode === "study" && capabilities["untimed"] === true,
    },
  };
}

/** A flattened `{ mode, capabilities }` payload next to the raw score fields. */
function flattenedLearning(raw: Record<string, unknown>): SatAttemptLearning | null {
  if (raw["mode"] !== "test" && raw["mode"] !== "study") return null;
  return readSatAttemptLearning({
    mode: raw["mode"],
    policyRevision: raw["policyRevision"],
    capabilities: raw["capabilities"],
  });
}

export function classroomReportFromRaw(raw: unknown): ClassroomReport | null {
  if (!isRecordValue(raw)) return null;
  const { rawCorrect, total, sections, domains, conversion, totalScaled } =
    raw as Partial<ClassroomReport>;
  if (typeof rawCorrect !== "number" || typeof total !== "number" || !Array.isArray(sections))
    return null;
  const learning = readSatAttemptLearning(raw["learning"]) ?? flattenedLearning(raw);
  return {
    rawCorrect,
    total,
    sections,
    ...(Array.isArray(domains) ? { domains } : {}),
    ...(typeof conversion?.converterVersion === "string" ? { conversion } : {}),
    ...(isScaled(totalScaled) ? { totalScaled } : {}),
    ...(learning ? { mode: learning.mode, learning } : {}),
  };
}

function isScaled(value: unknown): value is ScaledScore {
  const score = value as ScaledScore | null | undefined;
  return typeof score?.low === "number" && typeof score.high === "number";
}

/** What the paper prints from the server's answered-exam projection. */
export type AnsweredExam = Pick<AssessmentAnsweredExam, "sections" | "attempt" | "answerKey"> &
  Partial<Pick<AssessmentAnsweredExam, "examTitle" | "candidateName">>;

export type LoadMediaUrl = (
  assetId: string,
  options?: { fresh?: boolean }
) => Promise<string | null>;

export interface AnsweredExamSource extends AnsweredExamDownloadSource {
  /** The delivered sections, used only to title the report's modules. */
  sections: AssessmentDeliverySection[];
}

/** One server-admitted correct answer, with its delivered choice letter when it has one. */
export interface AnsweredExamKeyAnswer {
  label: string;
  text: string;
}

/**
 * One row of the separately authorized answer-key projection. `result` is the
 * server's verdict against the accepted response; the client never grades.
 */
export interface AnsweredExamKeyEntry {
  moduleId: string;
  examQuestionId: string;
  correctAnswers: readonly AnsweredExamKeyAnswer[];
  result: "correct" | "incorrect" | "unanswered";
}

/**
 * A server-supplied keyed export. `available` false keeps the existing
 * answer-only report; the client cannot authorize a keyed export itself.
 */
export interface AnsweredExamAnswerKey {
  available: boolean;
  entries: readonly AnsweredExamKeyEntry[];
}

// offcut: readiness is polled; an exam whose figures need over 30 s fails closed with a retry
export const PAPER_READY_TIMEOUT_MS = 30_000;

/**
 * PDF-10: the paper may print only when every administered module is present
 * with its content and every figure shows a decoded image. Anything else
 * would be an incomplete PDF.
 */
export function answeredPaperReady(paper: HTMLElement): boolean {
  if (paper.dataset["complete"] !== "true") return false;
  const ready = [...paper.querySelectorAll("figure")].every((figure) => {
    const image = figure.querySelector("img");
    return image !== null && image.complete && image.naturalWidth > 0;
  });
  return ready && [...paper.querySelectorAll<HTMLImageElement>("[data-pdf-design-image]")]
    .every((image) => image.complete && image.naturalWidth > 0);
}

/**
 * Released classroom score report, laid out from the subjects actually sat
 * (see score-report/scoreReportViewModel). Also hosts the answered-exam download.
 */
export function SatScoreReport({
  report,
  answered,
  onExit,
  recoveryExceptions = [],
  retakeActions,
  eva = null,
}: {
  report: ClassroomReport;
  answered: AnsweredExamSource | null;
  onExit: () => void | Promise<void>;
  recoveryExceptions?: readonly { moduleTitle: string; receipt: SATRecoveryResolutionReceipt }[];
  retakeActions?: ReactNode;
  /** The shared Eva SIM status group (see SatCompleteScreen). */
  eva?: ReactNode;
}) {
  const view = useMemo(
    () => buildStudentScoreReportView(report, answered?.sections),
    [report, answered?.sections]
  );
  const { download, ready, prepare } = useAnsweredExamDownload(answered, view);
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
            <SatReportHeader title={view.title} mode={view.mode} />
            {recoveryExceptions.length ? (
              <aside role="status" className="mt-5 rounded-xl border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-4 print:hidden">
                <h2 className="text-[16px] font-semibold">Submission confirmed with a recovery exception</h2>
                <p className="mt-1 text-[14px] leading-5 text-[var(--sat-text-secondary)]">
                  Some answers saved only on the original device were not confirmed by the exam and were excluded from scoring and routing.
                </p>
                <ul className="mt-3 space-y-2 text-[14px] leading-5 text-[var(--sat-text-secondary)]" aria-label="Recovery decisions recorded">
                  {recoveryExceptions.map(({ moduleTitle, receipt }) => (
                    <li key={receipt.receiptId}>
                      <span className="font-semibold text-[var(--sat-text)]">{moduleTitle}</span>
                      <span className="ml-2">Recovery record {receipt.receiptId}</span>
                    </li>
                  ))}
                </ul>
              </aside>
            ) : null}
            <div className="mt-4 flex flex-wrap items-start gap-4">
              {retakeActions}
              <SatReportDownload
              canPrint={answered !== null}
              download={download}
              ready={ready}
                onPrint={() => void prepare()}
              />
            </div>
            <div className="mt-6">
              <SatScoreOverview view={view} />
            </div>
            {view.mode === "study" ? (
              <p
                data-sat-assistance="true"
                className="mt-3 text-[14px] leading-5 text-[var(--sat-text-secondary)]"
              >
                {studyAssistanceLabels(view.assistance).length
                  ? `Study assistance: ${studyAssistanceLabels(view.assistance).join(" · ")}`
                  : "No Study assistance was recorded for this attempt."}
              </p>
            ) : null}
            <SatSubjectPerformance view={view} />
            <SatKnowledgeSkills subjects={view.subjects} />
            <SatReportMethodology methodology={view.methodology} mode={view.mode} />
            {eva ? <div className="print:hidden">{eva}</div> : null}
            <SatReportActions onExit={() => void onExit()} />
          </section>
        </main>
      </div>
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

/**
 * Compact wayfinding for the answer summary.
 */
function PaperModuleHeading({
  sectionNo,
  sectionLabel,
  moduleTitle,
}: {
  sectionNo: number;
  sectionLabel: string;
  moduleTitle: string;
}) {
  return (
    <div className="sat-paper-module-heading">
      <h2>
        Section {sectionNo}: {sectionLabel}
      </h2>
      <p>{moduleTitle}</p>
    </div>
  );
}

/** Stack the symbol and wordmark from the supplied, bundled colour logo.
 * Clipping reuses the same PNG without CSS filters or extra raster assets. */
function PaperWatermarkBrand({ large = false, source }: { large?: boolean; source?: string | undefined }) {
  if (source) {
    return (
      <div className="sat-paper-watermark-brand" data-watermark={large ? "large" : "small"}>
        <img data-pdf-design-image className="sat-paper-custom-watermark" src={source} alt="" loading="eager" />
      </div>
    );
  }
  return (
    <div className="sat-paper-watermark-brand" data-watermark={large ? "large" : "small"}>
      <span className="sat-paper-watermark-symbol">
        <img src={warwickWatermark} alt="" draggable={false} loading="eager" />
      </span>
      <span className="sat-paper-watermark-wordmark">
        <img src={warwickWatermark} alt="" draggable={false} loading="eager" />
      </span>
    </div>
  );
}

/** Reference layout: staggered small marks on the left, one large mark on
 * the right. Fixed positioning repeats the composition on printed pages. */
function PaperWatermark({ left, right }: { left?: string | undefined; right?: string | undefined }) {
  const slots = [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3], [2, 4], [1, 5], [3, 5]];
  return (
    <div aria-hidden="true" className="sat-paper-watermark">
      <div className="sat-paper-watermark-pattern">
        {slots.map(([column, row], index) => (
          <div key={index} style={{ gridColumn: column, gridRow: row }}>
            <PaperWatermarkBrand source={left} />
          </div>
        ))}
      </div>
      <div className="sat-paper-watermark-feature">
        <PaperWatermarkBrand large source={right} />
      </div>
    </div>
  );
}

function PaperLegalNotice() {
  return (
    <div className="sat-paper-footer">
      <p>{ANSWERED_EXAM_LEGAL_FOOTER}</p>
    </div>
  );
}

function PaperFooter() {
  return (
    <tfoot>
      <tr>
        <td><PaperLegalNotice /></td>
      </tr>
    </tfoot>
  );
}

function PaperTitlePage({
  exam,
  hasScoreReport,
  hasAnswerKey,
  mode,
  subjects,
  moduleCount,
  logo,
}: {
  exam: AnsweredExam;
  hasScoreReport: boolean;
  hasAnswerKey: boolean;
  mode: SatAttemptMode;
  subjects: string[];
  moduleCount: number;
  logo?: { source: string; description: string } | undefined;
}) {
  const reportTitle = mode === "study" ? "Study result & exam review" : "Score report & exam review";
  return (
    <table className="sat-paper-table sat-paper-title-sheet" role="presentation" data-cover-page="true">
      <tbody>
        <tr>
          <td>
            <header className="sat-paper-title-page">
              <div className="sat-paper-title-brand">
                {logo ? (
                  <img data-pdf-design-image className="sat-paper-custom-cover" src={logo.source} alt={logo.description} loading="eager" />
                ) : <img src={warwickWatermark} alt="Warwick Institute" loading="eager" />}
                <p>Digital SAT<span>Personal study copy</span></p>
              </div>
              <div className="sat-paper-title-main">
                <div className="sat-paper-title-exam">
                  <h1>{exam.examTitle?.trim() || "Digital SAT"}</h1>
                  <p>{hasScoreReport ? reportTitle : "Answer summary & exam review"}</p>
                </div>
                <div className="sat-paper-title-student">
                  {exam.candidateName?.trim() ? (
                    <>
                      <p className="sat-paper-title-label">Prepared for</p>
                      <p className="sat-paper-title-name">{exam.candidateName}</p>
                    </>
                  ) : null}
                  <dl>
                    <div><dt>Subjects included</dt><dd>{subjects.join(" · ") || "Digital SAT"}</dd></div>
                    <div><dt>Modules included</dt><dd>{moduleCount}</dd></div>
                  </dl>
                </div>
              </div>
              <div className="sat-paper-title-contents">
                {hasScoreReport ? (
                  <div>
                    <h2>{mode === "study" ? "Study result" : "Score report"}</h2>
                    <p>{mode === "study" ? "Your raw results, with Study assistance noted" : "Your results and subject breakdowns"}</p>
                  </div>
                ) : null}
                <div><h2>Answer summary</h2><p>Your saved responses at a glance</p></div>
                {hasAnswerKey ? (
                  <div><h2>Answer key</h2><p>Correct answers released by your teacher</p></div>
                ) : null}
                <div><h2>Exam review</h2><p>Every question, with your answers marked</p></div>
              </div>
            </header>
          </td>
        </tr>
      </tbody>
      <PaperFooter />
    </table>
  );
}

/** The score report as printed: every count visible, nothing collapsed. */
function PaperScoreSummary({ view }: { view: StudentScoreReportView }) {
  const correct = view.subjects.reduce((sum, subject) => sum + subject.rawCorrect, 0);
  const total = view.subjects.reduce((sum, subject) => sum + subject.rawTotal, 0);
  const assistance = studyAssistanceLabels(view.assistance);
  return (
    <section className="sat-paper-score-summary">
      <div className="sat-paper-score-lead">
      {view.mode === "study" ? (
        <p className="sat-paper-score-label">Study result</p>
      ) : null}
      {view.primaryScore ? (
        <div>
          {view.primaryLabel ? <p className="sat-paper-score-label">{view.primaryLabel}</p> : null}
          <p className="sat-paper-score-value" data-score-kind={view.primaryScore.kind}>{printedScore(view.primaryScore)}</p>
          {view.primaryScore.kind === "estimated" ? (
            <p className="sat-paper-score-note">
              Score scale {view.primaryScore.scale.min}–{view.primaryScore.scale.max} · Estimated using a classroom
              score conversion table. Not an official SAT score.
            </p>
          ) : null}
        </div>
      ) : null}
      {view.notice ? <p className="sat-paper-score-note">{view.notice}</p> : null}
      {view.mode === "study" ? (
        <p className="sat-paper-score-note" data-paper-assistance="true">
          {assistance.length
            ? `Study assistance: ${assistance.join(" · ")}`
            : "No Study assistance was recorded for this attempt."}
        </p>
      ) : null}
      <p className="sat-paper-total">
        Total correct: {correct} of {total} · {percent(correct, total)}%
      </p>
      </div>
      <div className="sat-paper-subjects">
        {view.subjects.map((subject) => (
          <div key={subject.key} className="sat-paper-subject">
            <h3>{subject.label}</h3>
            {view.subjects.length > 1 && subject.score.kind !== "raw" ? (
              <p className="tabular-nums">Score: {printedScore(subject.score)}</p>
            ) : null}
            <p className="tabular-nums">
              Correct: {subject.rawCorrect} of {subject.rawTotal} · {percent(subject.rawCorrect, subject.rawTotal)}%
            </p>
            {subject.modules.length ? (
              <dl className="sat-paper-breakdown">
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
              <dl className="sat-paper-breakdown">
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

function PaperFrontMatter({ children }: { children: ReactNode }) {
  return (
    <table className="sat-paper-table" role="presentation">
      <tbody><tr><td>{children}</td></tr></tbody>
      <PaperFooter />
    </table>
  );
}

function PaperSlide({ source, description }: { source: string | undefined; description: string }) {
  return (
    <table className="sat-paper-table sat-paper-slide" role="presentation">
      <tbody><tr><td>
        <div className="sat-paper-slide-image">
          <img data-pdf-design-image src={source} alt={description} loading="eager" />
        </div>
      </td></tr></tbody>
      <PaperFooter />
    </table>
  );
}

/**
 * Print-only paper: a branded cover, the score report (when one is given), a compact per-module
 * answer sheet, an authorized answer-key table (only from a server key projection), then — on
 * following pages — the full exam review, so the student can study from their own sitting later.
 * In the review every choice is shown with the student's selected one circled (matched by option
 * id), a student-produced response is boxed as typed, a recorded choice that matches no listed
 * option is printed as such, and unanswered questions say so. Correct answers appear only from
 * `answerKey`; without it the original answer-only report and copy are unchanged. `data-complete`
 * is false when an administered module is missing or withheld, so the paper never prints without it.
 */
export function AnsweredExamPaper({
  exam,
  view,
  answerKey = null,
  loadMediaUrl,
  onMediaFailure,
  generation,
  layout,
  paperRef,
}: {
  exam: AnsweredExam;
  view?: StudentScoreReportView | null | undefined;
  /** The separately authorized server key projection; never derived from client grading. */
  answerKey?: AnsweredExamAnswerKey | null | undefined;
  loadMediaUrl?: LoadMediaUrl | undefined;
  onMediaFailure?: (() => void) | undefined;
  generation?: number;
  layout?: ResolvedPdfLayout | undefined;
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
  const markedForReview = new Set<string>();
  for (const response of exam.attempt.responses) {
    const moduleId = moduleIdByAttempt.get(response.moduleAttemptId);
    const value =
      typeof response.response === "string" || typeof response.response === "number"
        ? String(response.response).trim()
        : "";
    if (moduleId && value) answers.set(`${moduleId}:${response.examQuestionId}`, value);
    if (moduleId && response.markedForReview) markedForReview.add(`${moduleId}:${response.examQuestionId}`);
  }
  const printableModules: { section: (typeof exam.sections)[number]; sectionNo: number; module: AssessmentDeliverySection["modules"][number] }[] = [];
  exam.sections.forEach((section, sectionIndex) => {
    for (const module of [...section.modules].sort((a, b) => a.displayOrder - b.displayOrder)) {
      if (printable.has(module.id))
        printableModules.push({ section, sectionNo: sectionIndex + 1, module });
    }
  });
  const keyEntries = answerKeyIndex(answerKey);
  // A keyed export needs at least one usable row for a module this paper prints.
  const keyed = [...keyEntries.values()].some((entry) => printable.has(entry.moduleId));
  const keyModules = printableModules.map(({ section, sectionNo, module }) => ({
    sectionNo,
    sectionLabel: SAT_SECTION_LABEL[section.sectionKey] ?? section.title,
    module,
  }));
  const paperMode: SatAttemptMode = view?.mode === "study" ? "study" : "test";
  const mediaFailure = onMediaFailure ? () => onMediaFailure() : undefined;
  const slides = (target: PdfTarget, side: PdfSide) => {
    const targetKey = pdfTargetKey(target);
    return (layout?.layout.slides ?? [])
      .filter((slide) => slide.side === side && pdfTargetKey(slide.target) === targetKey)
      .map((slide) => <PaperSlide key={slide.id} source={layout?.images[slide.assetId]} description={slide.description} />);
  };
  const logoSource = (assetId: string | undefined) => assetId ? layout?.images[assetId] : undefined;
  const cover = layout?.layout.logos.cover;
  const coverSource = logoSource(cover?.assetId);
  const designReady = Object.values(layout?.layout.logos ?? {}).every((logo) => !logo || Boolean(logoSource(logo.assetId)));
  const frontHeader = (
    <header className="sat-paper-cover">
        <div>
          <h1>{exam.examTitle?.trim() || "Digital SAT"}</h1>
          <p>
            {view
              ? paperMode === "study"
                ? "Study result & exam review"
                : "Score report & exam review"
              : "Answer summary & exam review"}
          </p>
        </div>
        <div className="sat-paper-candidate">
          {exam.candidateName ? <p>{exam.candidateName}</p> : null}
          <span>Personal study copy</span>
        </div>
      </header>
  );
  const summary = (
    <>
      <div className="sat-paper-summary-heading">
        <h2>Answer summary</h2>
        <p>Your saved responses, in exam order</p>
      </div>
      {printableModules.map(({ section, sectionNo, module }) => {
        return (
          <section key={module.id} className="sat-paper-answer-summary">
            <PaperModuleHeading
              sectionNo={sectionNo}
              sectionLabel={SAT_SECTION_LABEL[section.sectionKey] ?? section.title}
              moduleTitle={module.title}
            />
              <ol className="sat-paper-answer-grid">
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
                      className="sat-paper-answer-cell"
                      data-question={index + 1}
                    >
                      <span className="sat-paper-answer-number">Q{index + 1}</span>
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
        );
      })}
    </>
  );
  const frontSections: { kind: "scoreReport" | "answerSummary" | "answerKey"; content: ReactNode }[] = [];
  if (view) frontSections.push({ kind: "scoreReport", content: <PaperScoreSummary view={view} /> });
  frontSections.push({ kind: "answerSummary", content: summary });
  if (keyed) frontSections.push({
    kind: "answerKey",
    content: <SatAnswerKeyTable modules={keyModules} answers={answers} entries={keyEntries} />,
  });
  const frontMatter: ReactNode[] = [];
  let group: ReactNode[] = [];
  const appendSlides = (pages: ReactNode[]) => {
    if (!pages.length) return;
    if (group.length) frontMatter.push(<PaperFrontMatter key={frontMatter.length}>{group}</PaperFrontMatter>);
    frontMatter.push(...pages);
    group = [];
  };
  frontSections.forEach(({ kind, content }, index) => {
    appendSlides(slides({ kind }, "before"));
    group.push(<Fragment key={kind}>{index === 0 ? frontHeader : null}{content}</Fragment>);
    appendSlides(slides({ kind }, "after"));
  });
  if (group.length) frontMatter.push(<PaperFrontMatter key={frontMatter.length}>{group}</PaperFrontMatter>);

  return (
    <div
      ref={paperRef}
      className="sat-answered-paper hidden bg-white text-left text-black print:block"
      aria-hidden={layout ? undefined : true}
      data-complete={complete && designReady}
      data-generation={generation}
      data-answer-key-mode={keyed ? "keyed" : "answer-only"}
    >
      <PaperWatermark
        left={logoSource(layout?.layout.logos.leftWatermark?.assetId)}
        right={logoSource(layout?.layout.logos.rightWatermark?.assetId)}
      />
      {slides({ kind: "cover" }, "before")}
      <PaperTitlePage
        exam={exam}
        hasScoreReport={Boolean(view)}
        hasAnswerKey={keyed}
        mode={paperMode}
        subjects={[...new Set(printableModules.map(({ section }) => SAT_SECTION_LABEL[section.sectionKey] ?? section.title))]}
        moduleCount={printableModules.length}
        logo={cover && coverSource ? { source: coverSource, description: cover.description ?? "" } : undefined}
      />
      {slides({ kind: "cover" }, "after")}
      {frontMatter}
      {printableModules.length ? slides({ kind: "examReview" }, "before") : null}
      {printableModules.map(({ section, sectionNo, module }, index) => {
        const subject: PdfTarget = { kind: "reviewSubject", sectionKey: section.sectionKey };
        const moduleTarget: PdfTarget = { kind: "reviewModule", sectionKey: section.sectionKey, moduleKey: module.moduleKey };
        const firstInSubject = printableModules[index - 1]?.section.id !== section.id;
        const lastInSubject = printableModules[index + 1]?.section.id !== section.id;
        const sectionLabel = SAT_SECTION_LABEL[section.sectionKey] ?? section.title;
        return (
          <Fragment key={module.id}>
          {firstInSubject ? slides(subject, "before") : null}
          {slides(moduleTarget, "before")}
          <table className="sat-paper-table sat-paper-review" role="presentation" data-review-module={module.id}>
            <thead>
              <tr>
                <td>
                  <div className="sat-paper-runhead" data-runhead-module={module.id}>
                    <div className="sat-paper-runhead-title">
                      <strong>{exam.examTitle?.trim() || "Digital SAT"}</strong>
                      {exam.candidateName ? <span>{exam.candidateName} · Exam review</span> : <span>Exam review</span>}
                    </div>
                    <div className="sat-paper-runhead-context">
                      <h2>Section {sectionNo}: {sectionLabel}</h2>
                      <p>{module.title}</p>
                    </div>
                  </div>
                  <p className="sat-paper-review-note">
                    {keyed
                      ? "Your selected choice is circled; written answers appear in the answer box. The correct answer for each question is shown."
                      : "Your selected choice is circled; written answers appear in the answer box. Correct answers are not shown."}
                  </p>
                </td>
              </tr>
            </thead>
            <tbody>
            {[...module.questions]
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((question, index) => {
                const answer = answers.get(`${module.id}:${question.examQuestionId}`) ?? null;
                const marked = markedForReview.has(`${module.id}:${question.examQuestionId}`);
                const keyEntry = keyEntries.get(`${module.id}:${question.examQuestionId}`);
                return (
                  <tr key={question.examQuestionId} className="sat-paper-question-row">
                    <td>
                      <SatPrintedQuestion
                        question={question}
                        questionNumber={index + 1}
                        moduleId={module.id}
                        sectionKey={section.sectionKey}
                        answer={answer}
                        markedForReview={marked}
                        correctAnswers={keyEntry?.correctAnswers}
                        result={keyEntry?.result}
                        loadMediaUrl={loadMediaUrl}
                        onMediaFailure={mediaFailure}
                      />
                    </td>
                  </tr>
                );
              })}

            </tbody>
            <PaperFooter />
          </table>
          {slides(moduleTarget, "after")}
          {lastInSubject ? slides(subject, "after") : null}
          </Fragment>
        );
      })}
      {printableModules.length ? slides({ kind: "examReview" }, "after") : null}
    </div>
  );
}
