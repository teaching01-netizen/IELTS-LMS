import type { ExamSessionRuntime } from '../../../../types/domain';
import type { StudentAttempt } from '../../../../types/studentAttempt';
import { STUDENT_EXAM_PHASE, type StudentExamPhase } from './studentExamPhase';

export interface DeriveStudentPhaseInput {
  readonly attempt: StudentAttempt | null;
  readonly runtime: ExamSessionRuntime | null;
  readonly runtimeBacked: boolean;
}

export function deriveStudentPhase(input: DeriveStudentPhaseInput): StudentExamPhase {
  const verifiedTerminal =
    input.attempt?.proctorStatus === 'terminated' || Boolean(input.attempt?.submittedAt);

  if (verifiedTerminal) {
    return STUDENT_EXAM_PHASE.POST_EXAM;
  }

  if (!input.attempt) {
    return STUDENT_EXAM_PHASE.PRE_CHECK;
  }

  if (input.runtimeBacked && !input.attempt.integrity.preCheck?.completedAt) {
    return STUDENT_EXAM_PHASE.PRE_CHECK;
  }

  if (input.runtimeBacked && input.attempt.integrity.preCheck?.completedAt) {
    const runtimeIsActive = input.runtime?.status === 'live' || input.runtime?.status === 'paused';
    return runtimeIsActive ? STUDENT_EXAM_PHASE.EXAM : STUDENT_EXAM_PHASE.LOBBY;
  }

  if (!input.runtimeBacked && input.attempt.phase === STUDENT_EXAM_PHASE.POST_EXAM) {
    return STUDENT_EXAM_PHASE.POST_EXAM;
  }

  if (input.attempt.phase === STUDENT_EXAM_PHASE.POST_EXAM) {
    return STUDENT_EXAM_PHASE.EXAM;
  }

  return input.attempt.phase;
}
