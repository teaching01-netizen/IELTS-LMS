import type {
  AssessmentModuleShell,
  AssessmentQuestionSummary,
  AssessmentSectionShell,
  QuestionReadinessStatus,
} from "../../contracts/assessment";

export interface ModuleOverviewStats {
  sectionId: string;
  sectionTitle: string;
  sectionKey: string;
  module: AssessmentModuleShell;
  authored: number;
  target: number;
  ready: number;
  incomplete: number;
  errors: number;
  pretest: number;
  complete: boolean;
}

export interface ExamOverviewStats {
  modules: ModuleOverviewStats[];
  authored: number;
  target: number;
  ready: number;
  incomplete: number;
  errors: number;
  pretest: number;
  /** Questions one candidate actually sees: base + one branch per section. */
  deliveredPerCandidate: number;
  progressPct: number;
}

const KNOWN_BASE_KEYS = new Set(["rw-m1", "math-m1"]);

/**
 * Six-module overview derivation (WS6): per-module authored/target +
 * readiness split + pretest count from the shell already in memory — no new
 * fetch, so the overview can never disagree with the queue rail.
 */
export function buildExamOverview(sections: AssessmentSectionShell[]): ExamOverviewStats {
  const modules: ModuleOverviewStats[] = [];
  let authored = 0;
  let target = 0;
  let ready = 0;
  let incomplete = 0;
  let errors = 0;
  let pretest = 0;
  for (const section of sections) {
    for (const module of section.modules) {
      const counts: Record<QuestionReadinessStatus, number> = {
        ready: 0,
        incomplete: 0,
        error: 0,
      };
      let modulePretest = 0;
      for (const question of module.questions) {
        counts[question.readiness.status] += 1;
        if (question.isPretest) modulePretest += 1;
      }
      const moduleAuthored = module.questions.length;
      authored += moduleAuthored;
      target += module.targetQuestionCount;
      ready += counts.ready;
      incomplete += counts.incomplete;
      errors += counts.error;
      pretest += modulePretest;
      modules.push({
        sectionId: section.id,
        sectionTitle: section.title,
        sectionKey: section.sectionKey,
        module,
        authored: moduleAuthored,
        target: module.targetQuestionCount,
        ready: counts.ready,
        incomplete: counts.incomplete,
        errors: counts.error,
        pretest: modulePretest,
        complete:
          moduleAuthored === module.targetQuestionCount &&
          counts.error === 0 &&
          counts.incomplete === 0,
      });
    }
  }
  return {
    modules,
    authored,
    target,
    ready,
    incomplete,
    errors,
    pretest,
    deliveredPerCandidate: deliveredPerCandidate(sections),
    progressPct: target > 0 ? Math.min(100, Math.round((authored / target) * 100)) : 0,
  };
}

/**
 * Delivered-per-candidate count: one candidate sees the base module plus
 * exactly one branch per section (27 RW + 27 RW-branch + 22 Math + 22
 * Math-branch = 98). Unknown module keys fall back to base + max(branch)
 * by adaptive role so a renamed module cannot silently inflate the count.
 */
function deliveredPerCandidate(sections: AssessmentSectionShell[]): number {
  let total = 0;
  for (const section of sections) {
    const base = section.modules.filter((module) => isBaseModule(module));
    const branches = section.modules.filter((module) => !isBaseModule(module));
    const baseCount = base.reduce((sum, module) => sum + module.questions.length, 0);
    const branchMax = branches.reduce((max, module) => Math.max(max, module.questions.length), 0);
    total += baseCount + branchMax;
  }
  return total;
}

function isBaseModule(module: AssessmentModuleShell): boolean {
  if (module.adaptiveRole === "base") return true;
  if (module.adaptiveRole === "lower_branch" || module.adaptiveRole === "higher_branch") {
    return false;
  }
  return KNOWN_BASE_KEYS.has(module.moduleKey);
}

export interface SelectionAfterDelete {
  examQuestionId: string | null;
  moduleId: string | null;
}

/**
 * Deterministic selection after delete (WS3): next sibling wins, else
 * previous sibling, else the first question of the module as currently
 * listed, else no selection (module stays open with the empty editor).
 * Pure over the post-delete question list so every caller converges.
 */
export function selectionAfterDelete(
  remaining: Pick<AssessmentQuestionSummary, "examQuestionId">[],
  deletedIndex: number,
): SelectionAfterDelete {
  const next = remaining[deletedIndex] ?? remaining[deletedIndex - 1] ?? remaining[0] ?? null;
  return { examQuestionId: next?.examQuestionId ?? null, moduleId: null };
}
