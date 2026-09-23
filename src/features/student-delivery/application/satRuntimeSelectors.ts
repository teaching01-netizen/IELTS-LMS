import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
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
function modulesInExamOrder(data: AssessmentDeliveryBootstrap): AssessmentDeliveryModule[] {
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
  const previous = previousModuleInExamOrder(data, moduleId);
  if (!previous) return false;
  const previousSection = sectionForModule(data, previous.id);
  const section = sectionForModule(data, moduleId);
  return Boolean(previousSection && section && previousSection.id !== section.id);
}

