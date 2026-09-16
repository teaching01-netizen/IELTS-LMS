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

