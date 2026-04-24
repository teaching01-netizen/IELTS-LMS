import type { ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';

export type VerifiedTerminalState = 'not_terminal' | 'completed' | 'terminated';

export function isRuntimeStructurallyCompleted(runtimeSnapshot: ExamSessionRuntime | null): boolean {
  if (!runtimeSnapshot) {
    return false;
  }

  if (runtimeSnapshot.status !== 'completed') {
    return false;
  }

  if (runtimeSnapshot.actualEndAt) {
    return true;
  }

  if (runtimeSnapshot.currentSectionKey == null) {
    return true;
  }

  return runtimeSnapshot.sections.every((section) => section.status === 'completed');
}

export function isVerifiedTerminalStudentState(params: {
  attempt: StudentAttempt | null;
  runtimeSnapshot: ExamSessionRuntime | null;
}): VerifiedTerminalState {
  const { attempt, runtimeSnapshot } = params;

  if (attempt?.proctorStatus === 'terminated') {
    return 'terminated';
  }

  if (attempt?.submittedAt) {
    return 'completed';
  }

  if (isRuntimeStructurallyCompleted(runtimeSnapshot)) {
    return 'completed';
  }

  return 'not_terminal';
}

// Backwards-compatible alias (older call sites)
export const getVerifiedTerminalStudentState = isVerifiedTerminalStudentState;
