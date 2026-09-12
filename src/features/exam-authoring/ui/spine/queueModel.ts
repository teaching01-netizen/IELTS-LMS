import type {
  AssessmentModuleShell,
  AssessmentQuestionSummary,
  AssessmentSectionShell,
} from "../../contracts/assessment";

/** A single row signal, with blockers taking precedence over answer metadata. */
export function queueRowToken(question: AssessmentQuestionSummary): {kind: "issue" | "answer" | "spr"; label: string} | null {
  if (question.readiness.blockingIssueCount > 0 || question.readiness.status === "error") return {kind:"issue",label:"Needs attention"};
  if (question.questionType === "single_choice" && question.answerKeyPreview) return {kind:"answer",label:question.answerKeyPreview};
  if (question.questionType !== "single_choice") return {kind:"spr",label:"SPR"};
  return null;
}

export type SpineQueueFilter = "all" | "ready" | "incomplete" | "error";

export type SpineQueueRow =
  | { kind: "question"; question: AssessmentQuestionSummary }
  | { kind: "empty"; displayOrder: number };

export interface SpineQueueCounts {
  ready: number;
  incomplete: number;
  error: number;
}

/**
 * Shared queue derivation for the legacy QuestionListPane and the spine
 * QuestionQueueRail (plan Phases 3+8). Single source of truth for search,
 * readiness filtering, empty-slot padding, and readiness counts — readiness
 * semantics must never fork between the two surfaces.
 */
export function normalizeQueueSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function matchesQueueSearch(question: AssessmentQuestionSummary, query: string, position?: number): boolean {
  if (!query) return true;
  return [
    position === undefined ? "" : String(position),
    question.promptPreview,
    question.answerKeyPreview ?? "",
    question.domain ?? "",
    question.skill ?? "",
    question.difficulty,
    ...question.tags,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

export function buildQueueRows(
  module: AssessmentModuleShell,
  searchQuery: string,
  filter: SpineQueueFilter,
): SpineQueueRow[] {
  const query = normalizeQueueSearch(searchQuery);
  const questions = module.questions.filter((question, index) => {
    if (!matchesQueueSearch(question, query, index + 1)) return false;
    return filter === "all" || question.readiness.status === filter;
  });
  const result: SpineQueueRow[] = questions.map((question) => ({ kind: "question", question }));
  if (!query && filter === "all") {
    for (let index = module.questions.length; index < module.targetQuestionCount; index += 1) {
      result.push({ kind: "empty", displayOrder: index });
    }
  }
  return result;
}

export function moduleReadyCount(module: AssessmentModuleShell): number {
  return module.questions.filter((question) => question.readiness.status === "ready").length;
}

export function countQueueReadiness(module: AssessmentModuleShell): SpineQueueCounts {
  const counts: SpineQueueCounts = { ready: 0, incomplete: 0, error: 0 };
  for (const question of module.questions) counts[question.readiness.status] += 1;
  return counts;
}

export function findQueueModule(
  sections: AssessmentSectionShell[],
  moduleId: string,
): AssessmentModuleShell | null {
  for (const section of sections) {
    const module = section.modules.find((candidate) => candidate.id === moduleId);
    if (module) return module;
  }
  return null;
}
