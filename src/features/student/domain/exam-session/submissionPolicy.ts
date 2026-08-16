import type { RuntimeStatus } from '../../../../types/domain';
import { STUDENT_EXAM_PHASE, type StudentExamPhase } from './studentExamPhase';

export interface SubmissionBarrierInput {
  readonly phase: StudentExamPhase;
  readonly pendingMutationCount: number;
  readonly durabilityReady: boolean;
  readonly runtimeBacked: boolean;
  readonly runtimeStatus: RuntimeStatus | null;
  readonly runtimeCompletionVerified: boolean;
}

export type SubmissionBarrierResult =
  | { readonly kind: 'ready' }
  | {
      readonly kind: 'blocked';
      readonly reason:
        | 'not_exam'
        | 'pending_mutations'
        | 'durability_unavailable'
        | 'runtime_unverified';
    };

export function evaluateSubmissionBarrier(input: SubmissionBarrierInput): SubmissionBarrierResult {
  if (input.phase !== STUDENT_EXAM_PHASE.EXAM) {
    return { kind: 'blocked', reason: 'not_exam' };
  }

  if (input.pendingMutationCount > 0) {
    return { kind: 'blocked', reason: 'pending_mutations' };
  }

  if (!input.durabilityReady) {
    return { kind: 'blocked', reason: 'durability_unavailable' };
  }

  if (input.runtimeBacked && input.runtimeStatus === 'completed' && !input.runtimeCompletionVerified) {
    return { kind: 'blocked', reason: 'runtime_unverified' };
  }

  return { kind: 'ready' };
}
