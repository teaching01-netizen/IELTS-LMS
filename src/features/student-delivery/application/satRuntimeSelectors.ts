import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentDeliverySection,
  AssessmentModuleAttemptSnapshot,
} from '../contracts/assessmentDelivery';

export function moduleForAttempt(
  data: AssessmentDeliveryBootstrap,
  attempt: AssessmentModuleAttemptSnapshot | undefined,
): AssessmentDeliveryModule | null {
  if (!attempt) return null;
  return data.sections
    .flatMap((section) => section.modules)
    .find((module) => module.id === attempt.moduleId) ?? null;
}

export function findActiveAttempt(data: AssessmentDeliveryBootstrap) {
  return data.attempt.moduleAttempts.find((module) => module.state === 'active');
}

export function findPendingAttempt(data: AssessmentDeliveryBootstrap) {
  return findActiveAttempt(data)
    ?? data.attempt.moduleAttempts.find((module) => module.state === 'not_started');
}

export function findCurrentModule(data: AssessmentDeliveryBootstrap) {
  return moduleForAttempt(data, findPendingAttempt(data));
}
export function findAttemptForModule(data: AssessmentDeliveryBootstrap, moduleId: string) {
  return data.attempt.moduleAttempts.find((candidate) => candidate.moduleId === moduleId);
}

export function sectionForModule(data: AssessmentDeliveryBootstrap, moduleId: string) {
  return data.sections.find((section) => section.modules.some((module) => module.id === moduleId));
}

export function studentModuleTitle(module: AssessmentDeliveryModule): string {
  return module.adaptiveRole === 'lower_branch' || module.adaptiveRole === 'higher_branch'
    ? 'Module 2'
    : 'Module 1';
}

export function matchesFinalModuleState(state: string): boolean {
  return state === 'submitted' || state === 'locked';
}

export interface LegacyModuleSnapshot {
  moduleKey: string;
  questionIds: string[];
}

export type LegacyMigrationCandidate = Pick<AssessmentDeliveryModule, 'id' | 'moduleKey' | 'questions'>;

/**
 * Compatibility resolver for runner snapshots written before `moduleId`
 * existed (P6 migration only — never a runtime lookup).
 *
 * Safe order, fail closed:
 *  1. candidates that match BOTH the business key AND the exact question
 *     set (order-independent) are the only migration sources — a key alone
 *     can be duplicated across adaptive branches;
 *  2. exactly one match migrates to its id;
 *  3. zero or multiple matches return null: the caller must fall back to
 *     the authoritative bootstrap/directions recovery instead of guessing.
 *     Wrong-module delivery is worse than one extra bootstrap.
 */
export function resolveLegacyModuleIdentity(
  snapshot: LegacyModuleSnapshot,
  candidates: LegacyMigrationCandidate[],
): string | null {
  const wanted = new Set(snapshot.questionIds);
  const matches = candidates.filter((candidate) => {
    if (candidate.moduleKey !== snapshot.moduleKey) return false;
    if (candidate.questions.length !== wanted.size) return false;
    return candidate.questions.every((question) => wanted.has(question.examQuestionId));
  });
  if (matches.length !== 1) return null;
  return matches[0]?.id ?? null;
}

/**
 * Every module of the exam in the order a candidate meets them: sections by
 * display order, then modules by display order inside a section.
 *
 * Exam order is what makes "is this module the first of a section?" answerable
 * without reading display-order numbers across two different levels — the two
 * levels number independently, so `section.displayOrder > 0` says nothing about
 * whether the module itself begins a new section (it wrongly made Math Module 2
 * look like a section boundary).
 */
export function modulesInExamOrder(data: AssessmentDeliveryBootstrap): AssessmentDeliveryModule[] {
  return [...data.sections]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .flatMap((section) =>
      [...section.modules].sort((left, right) => left.displayOrder - right.displayOrder),
    );
}

/**
 * The module a candidate meets immediately before `moduleId`, or null when
 * `moduleId` is the first module of the exam (or unknown to this payload).
 */
export function previousModuleInExamOrder(
  data: AssessmentDeliveryBootstrap,
  moduleId: string,
): AssessmentDeliveryModule | null {
  const ordered = modulesInExamOrder(data);
  const index = ordered.findIndex((module) => module.id === moduleId);
  return index > 0 ? ordered[index - 1] ?? null : null;
}

/**
 * Whether opening `moduleId` crosses from one section into the next: its
 * predecessor in exam order lives in a different section.
 *
 * This is the one boundary fact the student surfaces read. It is structural, so
 * it answers identically for the live session, a poll, and a page reloaded in
 * the middle of a break — and it is false for Module 1 → Module 2 inside one
 * section, whatever the section's own display order is.
 */
export function moduleStartsNewSection(
  data: AssessmentDeliveryBootstrap,
  moduleId: string,
): boolean {
  return sectionBoundaryBefore(data, moduleId) !== null;
}

/** The two sections a module boundary joins, or null when there is none. */
function sectionBoundaryBefore(
  data: AssessmentDeliveryBootstrap,
  moduleId: string,
): { previousSection: AssessmentDeliverySection; section: AssessmentDeliverySection } | null {
  const previous = previousModuleInExamOrder(data, moduleId);
  if (!previous) return null;
  const previousSection = sectionForModule(data, previous.id);
  const section = sectionForModule(data, moduleId);
  if (!previousSection || !section || previousSection.id === section.id) return null;
  return { previousSection, section };
}

export interface SatPendingAuthoredBreak {
  /** The section whose authored break precedes `moduleId`. */
  readonly sectionId: string;
  readonly seconds: number;
}

/**
 * The scheduled break authored between the module before `moduleId` and
 * `moduleId`, but only while this attempt has no break row for that boundary.
 *
 * Null for a same-section handoff, for a first or last module, and once the row
 * exists — at that point the row's own state is the truth and re-deriving from
 * authored metadata would let a completed break re-enter `preparing` and block
 * the next module forever.
 */
export function satPendingAuthoredBreak(
  data: AssessmentDeliveryBootstrap,
  moduleId: string,
): SatPendingAuthoredBreak | null {
  const boundary = sectionBoundaryBefore(data, moduleId);
  if (!boundary) return null;
  const { previousSection } = boundary;
  if (!(previousSection.breakAfterSeconds > 0)) return null;
  const hasRow = data.attempt.personalBreaks?.some(
    (candidate) => candidate.afterSectionId === previousSection.id,
  ) ?? false;
  return hasRow ? null : { sectionId: previousSection.id, seconds: previousSection.breakAfterSeconds };
}

/** Convenience for the break-window input; 0 when there is nothing authored. */
export function satPendingAuthoredBreakSeconds(
  data: AssessmentDeliveryBootstrap,
  moduleId: string,
): number {
  return satPendingAuthoredBreak(data, moduleId)?.seconds ?? 0;
}

