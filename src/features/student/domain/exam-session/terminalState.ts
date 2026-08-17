import type { ExamSessionRuntime } from '../../../../types/domain';
import type { StudentAttempt } from '../../../../types/studentAttempt';

export type VerifiedTerminalState = 'not_terminal' | 'completed' | 'terminated';

export function isRuntimeStructurallyCompleted(runtime: ExamSessionRuntime | null): boolean {
  if (!runtime || runtime.status !== 'completed') {
    return false;
  }

  if (runtime.actualEndAt) {
    return true;
  }

  if (runtime.currentSectionKey === null) {
    return true;
  }

  return runtime.sections.every((section) => section.status === 'completed');
}

export function getVerifiedTerminalState(input: {
  readonly attempt: StudentAttempt | null;
  readonly runtime: ExamSessionRuntime | null;
}): VerifiedTerminalState {
  if (input.attempt?.proctorStatus === 'terminated') {
    return 'terminated';
  }

  if (input.attempt?.submittedAt) {
    return 'completed';
  }

  return 'not_terminal';
}
