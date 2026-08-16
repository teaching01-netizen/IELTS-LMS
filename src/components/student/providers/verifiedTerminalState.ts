import type { ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';
import {
  getVerifiedTerminalState,
  isRuntimeStructurallyCompleted,
} from '@student/domain/exam-session/terminalState';

export type VerifiedTerminalState = 'not_terminal' | 'completed' | 'terminated';

export { isRuntimeStructurallyCompleted };

export function isVerifiedTerminalStudentState(params: {
  attempt: StudentAttempt | null;
  runtimeSnapshot: ExamSessionRuntime | null;
}): VerifiedTerminalState {
  return getVerifiedTerminalState({
    attempt: params.attempt,
    runtime: params.runtimeSnapshot,
  });
}

// Backwards-compatible alias (older call sites)
export const getVerifiedTerminalStudentState = isVerifiedTerminalStudentState;
