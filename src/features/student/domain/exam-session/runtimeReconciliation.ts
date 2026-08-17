import type { ModuleType } from '../../../../types';
import type { ExamSessionRuntime } from '../../../../types/domain';
import { STUDENT_EXAM_PHASE, type StudentExamPhase } from './studentExamPhase';
import { isRuntimeStructurallyCompleted } from './terminalState';

export interface RuntimePosition {
  readonly phase: StudentExamPhase;
  readonly currentModule: ModuleType;
  readonly currentQuestionId: string | null;
  readonly timeRemaining: number;
  readonly currentSectionExtensionMinutes: number | null;
  readonly waitingForCohortAdvance: boolean;
}

export interface RuntimeReconciliationInput {
  readonly current: RuntimePosition;
  readonly incoming: ExamSessionRuntime;
  readonly nextModule: ModuleType;
  readonly firstQuestionId: string | null;
  readonly currentSectionExtensionMinutes: number | null;
  readonly preserveLocalAdvance: boolean;
}

export function reconcileRuntimeSnapshot(input: RuntimeReconciliationInput): RuntimePosition {
  const runtimeStructurallyCompleted = isRuntimeStructurallyCompleted(input.incoming);
  if (input.preserveLocalAdvance && !runtimeStructurallyCompleted) {
    return input.current;
  }

  const moduleChanged = input.nextModule !== input.current.currentModule;
  const runtimeIsActive = input.incoming.status === 'live' || input.incoming.status === 'paused';
  const nextPhase = runtimeStructurallyCompleted
    ? STUDENT_EXAM_PHASE.POST_EXAM
    : runtimeIsActive
      ? STUDENT_EXAM_PHASE.EXAM
      : input.current.phase === STUDENT_EXAM_PHASE.PRE_CHECK
        ? STUDENT_EXAM_PHASE.PRE_CHECK
        : STUDENT_EXAM_PHASE.LOBBY;
  const nextTimeRemaining = Number.isFinite(input.incoming.currentSectionRemainingSeconds)
    ? input.incoming.currentSectionRemainingSeconds
    : input.current.timeRemaining;
  const nextExtension =
    typeof input.currentSectionExtensionMinutes === 'number' &&
    Number.isFinite(input.currentSectionExtensionMinutes) &&
    input.currentSectionExtensionMinutes >= 0
      ? input.currentSectionExtensionMinutes
      : moduleChanged
        ? null
        : input.current.currentSectionExtensionMinutes;

  return {
    phase: nextPhase,
    currentModule: input.nextModule,
    currentQuestionId: moduleChanged ? input.firstQuestionId : input.current.currentQuestionId,
    timeRemaining: nextTimeRemaining,
    currentSectionExtensionMinutes: nextExtension,
    waitingForCohortAdvance:
      input.current.waitingForCohortAdvance && !moduleChanged && !runtimeStructurallyCompleted,
  };
}
