import type { AssessmentDeliverySection } from "../../../contracts/assessmentDelivery";
import type { ClassroomReport } from "../SatScoreReport";

/**
 * Presentation model for the student score report. A pure function of the
 * server's `classroomRaw` payload: it validates and arranges what the server
 * released and never computes a score. Conversion stays the server's call.
 */

export type SatSubject = "reading-writing" | "math";

export interface ScoreScale {
  min: number;
  max: number;
}

export type ScoreDisplay =
  | { kind: "estimated"; low: number; high: number; scale: ScoreScale }
  | { kind: "raw"; correct: number; total: number }
  | { kind: "unavailable"; reason: string; display?: "dash" };

export type ReportLayout = "full-sat" | "single-subject" | "partial-results" | "unavailable";

export interface ModuleReportView {
  key: string;
  label: string;
  rawCorrect: number;
  rawTotal: number;
}

export interface DomainReportView {
  name: string;
  correct: number;
  total: number;
  /** Whole percent; null when no scored question backs it. */
  accuracy: number | null;
}

export interface SubjectReportView {
  key: SatSubject;
  label: string;
  score: ScoreDisplay;
  rawCorrect: number;
  rawTotal: number;
  modules: ModuleReportView[];
  domains: DomainReportView[];
}

export interface StudentScoreReportView {
  layout: ReportLayout;
  title: string;
  primaryLabel: string | null;
  primaryScore: ScoreDisplay | null;
  subjects: SubjectReportView[];
  showCombinedScore: boolean;
  /** Why an estimate is absent, shown beside the primary result. */
  notice: string | null;
  methodology: {
    isEstimated: boolean;
    converterVersion: string | null;
  };
  /** Data problems found while building the view; codes only, no student data. */
  issues: string[];
}

export const SUBJECT_LABEL: Record<SatSubject, string> = {
  "reading-writing": "Reading & Writing",
  math: "Math",
};

const SECTION_SCALE: ScoreScale = { min: 200, max: 800 };
const TOTAL_SCALE: ScoreScale = { min: 400, max: 1600 };

function isSubject(key: string): key is SatSubject {
  return key === "reading-writing" || key === "math";
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validRaw(correct: unknown, total: unknown): boolean {
  return isCount(correct) && isCount(total) && correct <= total;
}

function estimate(value: unknown, scale: ScoreScale): ScoreDisplay | null {
  const score = value as { low?: unknown; high?: unknown } | null | undefined;
  const { low, high } = score ?? {};
  if (typeof low !== "number" || typeof high !== "number") return null;
  if (!Number.isInteger(low) || !Number.isInteger(high) || low > high) return null;
  if (low < scale.min || high > scale.max) return null;
  if (low % 10 !== 0 || high % 10 !== 0) return null;
  return { kind: "estimated", low, high, scale };
}

function unavailableEstimate(reason: string): ScoreDisplay {
  return { kind: "unavailable", reason, display: "dash" };
}

/** Readable fallback when the delivered assessment does not title a module. */
export function fallbackModuleLabel(moduleKey: string): string {
  const numbered = /(?:^|[-_\s])(\d+)$/.exec(moduleKey);
  if (numbered) return `Module ${numbered[1]}`;
  const spaced = moduleKey.replace(/[-_]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "Module";
}

interface ModuleMeta {
  title: string;
  displayOrder: number;
}

function moduleMeta(sections: AssessmentDeliverySection[] | undefined): Map<string, ModuleMeta> {
  const meta = new Map<string, ModuleMeta>();
  for (const section of sections ?? []) {
    for (const module of section.modules) {
      meta.set(`${section.sectionKey}:${module.moduleKey}`, {
        title: module.title,
        displayOrder: module.displayOrder,
      });
    }
  }
  return meta;
}

type ReportSection = ClassroomReport["sections"][number];

function buildModules(
  section: ReportSection,
  meta: Map<string, ModuleMeta>,
  issues: string[]
): ModuleReportView[] {
  const seen = new Set<string>();
  const entries: { view: ModuleReportView; order: number | null }[] = [];
  for (const module of Array.isArray(section.modules) ? section.modules : []) {
    if (
      typeof module?.moduleKey !== "string" ||
      seen.has(module.moduleKey) ||
      !validRaw(module.rawCorrect, module.total)
    ) {
      issues.push("module-invalid");
      continue;
    }
    seen.add(module.moduleKey);
    const known = meta.get(`${section.sectionKey}:${module.moduleKey}`);
    entries.push({
      view: {
        key: module.moduleKey,
        label: known?.title || fallbackModuleLabel(module.moduleKey),
        rawCorrect: module.rawCorrect,
        rawTotal: module.total,
      },
      order: known && Number.isFinite(known.displayOrder) ? known.displayOrder : null,
    });
  }
  // Array position alone is not module order; sort only when every module has a delivered order.
  if (entries.length > 1 && entries.every((entry) => entry.order !== null))
    entries.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return entries.map((entry) => entry.view);
}

function buildDomains(
  report: ClassroomReport,
  subject: SatSubject,
  issues: string[]
): DomainReportView[] {
  const seen = new Set<string>();
  const domains: DomainReportView[] = [];
  for (const domain of report.domains ?? []) {
    if (domain?.sectionKey !== subject) continue;
    if (
      typeof domain.domain !== "string" ||
      !domain.domain ||
      seen.has(domain.domain) ||
      !validRaw(domain.correct, domain.total)
    ) {
      issues.push("domain-invalid");
      continue;
    }
    seen.add(domain.domain);
    domains.push({
      name: domain.domain,
      correct: domain.correct,
      total: domain.total,
      accuracy: domain.total > 0 ? Math.round((domain.correct / domain.total) * 100) : null,
    });
  }
  return domains;
}

function unavailableView(issues: string[], converterVersion: string | null): StudentScoreReportView {
  return {
    layout: "unavailable",
    title: "Your SAT practice results",
    primaryLabel: null,
    primaryScore: {
      kind: "unavailable",
      reason: "Score details are not available for this sitting.",
    },
    subjects: [],
    showCombinedScore: false,
    notice: null,
    methodology: { isEstimated: false, converterVersion },
    issues,
  };
}

export function buildStudentScoreReportView(
  report: ClassroomReport,
  delivered?: AssessmentDeliverySection[]
): StudentScoreReportView {
  const issues: string[] = [];
  const converterVersion =
    typeof report.conversion?.converterVersion === "string"
      ? report.conversion.converterVersion.trim() || null
      : null;
  const hasConverter = converterVersion !== null;
  const meta = moduleMeta(delivered);

  const bySubject = new Map<SatSubject, ReportSection>();
  for (const section of report.sections) {
    const key = section?.sectionKey;
    if (typeof key !== "string" || !isSubject(key)) {
      issues.push("section-unknown");
      continue;
    }
    if (bySubject.has(key) || !validRaw(section.rawCorrect, section.total)) {
      // Showing one of two conflicting or broken sections would misstate which subjects were sat.
      issues.push(bySubject.has(key) ? "section-duplicate" : "section-invalid");
      return unavailableView(issues, converterVersion);
    }
    bySubject.set(key, section);
  }
  if (bySubject.size === 0) return unavailableView(issues, converterVersion);

  const subjects: SubjectReportView[] = [];
  for (const key of ["reading-writing", "math"] as const) {
    const section = bySubject.get(key);
    if (!section) continue;
    const converted =
      section.conversionStatus === "converted" ? estimate(section.scaled, SECTION_SCALE) : null;
    if (section.conversionStatus === "converted" && !converted) issues.push("scaled-invalid");
    const score = converted ?? (hasConverter
      ? unavailableEstimate(`Estimated ${SUBJECT_LABEL[key]} score is unavailable.`)
      : { kind: "raw" as const, correct: section.rawCorrect, total: section.total });
    subjects.push({
      key,
      label: SUBJECT_LABEL[key],
      score,
      rawCorrect: section.rawCorrect,
      rawTotal: section.total,
      modules: buildModules(section, meta, issues),
      domains: buildDomains(report, key, issues),
    });
  }

  const convertedCount = subjects.filter((subject) => subject.score.kind === "estimated").length;
  const methodology = { isEstimated: convertedCount > 0, converterVersion };
  const rawSum = subjects.reduce(
    (sum, subject) => ({
      correct: sum.correct + subject.rawCorrect,
      total: sum.total + subject.rawTotal,
    }),
    { correct: 0, total: 0 }
  );

  const [only] = subjects;
  if (subjects.length === 1 && only) {
    // A stray totalScaled never applies to one subject.
    const estimated = only.score.kind === "estimated";
    const unavailable = only.score.kind === "unavailable" && only.score.display === "dash";
    return {
      layout: "single-subject",
      title: `Your ${only.label} results`,
      primaryLabel: estimated || unavailable ? `Estimated ${only.label} score` : "Scored practice questions",
      primaryScore: only.score,
      subjects,
      showCombinedScore: false,
      notice: estimated ? null : "An estimated SAT score is not available for this sitting.",
      methodology,
      issues,
    };
  }

  // The combined score is the server's; it counts only when both sections converted.
  const total = convertedCount === subjects.length ? estimate(report.totalScaled, TOTAL_SCALE) : null;
  if (convertedCount === subjects.length && report.totalScaled !== undefined && !total)
    issues.push("total-scaled-invalid");
  if (total) {
    return {
      layout: "full-sat",
      title: "Your SAT practice results",
      primaryLabel: "Estimated total SAT score",
      primaryScore: total,
      subjects,
      showCombinedScore: true,
      notice: null,
      methodology,
      issues,
    };
  }

  if (hasConverter) {
    return {
      layout: "partial-results",
      title: "Your SAT practice results",
      primaryLabel: "Estimated total SAT score",
      primaryScore: unavailableEstimate("Estimated combined SAT score is unavailable."),
      subjects,
      showCombinedScore: false,
      notice: "An estimated combined score is unavailable.",
      methodology,
      issues,
    };
  }

  const noneConverted = convertedCount === 0;
  return {
    layout: "partial-results",
    title: "Your SAT practice results",
    primaryLabel: noneConverted ? "Total correct answers" : null,
    primaryScore: noneConverted ? { kind: "raw", ...rawSum } : null,
    subjects,
    showCombinedScore: false,
    notice: noneConverted
      ? "Estimated SAT scores are not available for this sitting."
      : "An estimated combined score is unavailable.",
    methodology,
    issues,
  };
}
